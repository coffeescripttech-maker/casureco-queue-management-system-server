/**
 * Ticket Routes
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { query, callProcedure, pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const {
  emitTicketCreated,
  emitTicketUpdated,
  emitTicketCalled,
  emitTicketDeleted
} = require('../socket/socketHandler');

/**
 * GET /api/tickets
 * Get all tickets with filters
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { branch_id, status, service_id, counter_id, date, start_date, served_by, sort, limit } = req.query;

    let sql = `
      SELECT t.*, 
             s.name as service_name, s.prefix as service_prefix,
             c.name as counter_name,
             b.name as branch_name
      FROM tickets t
      LEFT JOIN services s ON t.service_id = s.id
      LEFT JOIN counters c ON t.counter_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (branch_id) {
      sql += ' AND t.branch_id = ?';
      params.push(branch_id);
    }

    // Support multiple statuses (comma-separated)
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      const placeholders = statuses.map(() => '?').join(',');
      sql += ` AND t.status IN (${placeholders})`;
      params.push(...statuses);
    }

    if (service_id) {
      sql += ' AND t.service_id = ?';
      params.push(service_id);
    }

    if (counter_id) {
      sql += ' AND t.counter_id = ?';
      params.push(counter_id);
    }

    if (served_by) {
      sql += ' AND t.served_by = ?';
      params.push(served_by);
    }

    // Exact date match
    if (date) {
      sql += ' AND DATE(t.created_at) = ?';
      params.push(date);
    }

    // Date range (from start_date onwards)
    if (start_date) {
      sql += ' AND t.created_at >= ?';
      params.push(start_date);
    }

    // Custom sorting
    if (sort) {
      const [field, direction] = sort.split(':');
      const validFields = ['created_at', 'ended_at', 'called_at', 'ticket_number', 'priority_level'];
      const validDirection = direction?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      if (validFields.includes(field)) {
        sql += ` ORDER BY t.${field} ${validDirection}`;
      } else {
        sql += ' ORDER BY t.created_at DESC';
      }
    } else {
      sql += ' ORDER BY t.created_at DESC';
    }

    // Limit results
    const maxLimit = parseInt(limit) || 1000;
    sql += ` LIMIT ${Math.min(maxLimit, 1000)}`;

    const rawTickets = await query(sql, params);
    
    // Transform tickets to include nested service/counter/branch objects
    const tickets = rawTickets.map(ticket => ({
      ...ticket,
      service: ticket.service_name ? {
        name: ticket.service_name,
        prefix: ticket.service_prefix
      } : null,
      counter: ticket.counter_name ? {
        name: ticket.counter_name
      } : null,
      branch: ticket.branch_name ? {
        name: ticket.branch_name
      } : null
    }));
    
    res.json({ tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

/**
 * GET /api/tickets/:id
 * Get single ticket by ID
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const sql = `
      SELECT t.*, 
             s.name as service_name, s.prefix as service_prefix,
             c.name as counter_name,
             b.name as branch_name
      FROM tickets t
      LEFT JOIN services s ON t.service_id = s.id
      LEFT JOIN counters c ON t.counter_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE t.id = ?
    `;
    
    const tickets = await query(sql, [req.params.id]);
    
    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({ ticket: tickets[0] });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

/**
 * POST /api/tickets
 * Create new ticket
 */
router.post('/', optionalAuth, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const {
      service_id,
      branch_id,
      priority_level = 0,
      customer_name,
      customer_phone,
      notes
    } = req.body;

    if (!service_id || !branch_id) {
      return res.status(400).json({ error: 'service_id and branch_id are required' });
    }

    // Start transaction for atomic ticket number generation
    await connection.beginTransaction();
    
    const today = new Date().toISOString().split('T')[0];
    
    console.log('🎫 Creating ticket for service_id:', service_id);
    
    // Get service prefix
    const [services] = await connection.execute(
      'SELECT prefix FROM services WHERE id = ?', 
      [service_id]
    );
    const prefix = services[0]?.prefix || 'TKT';
    console.log('🏷️ Using prefix:', prefix);
    
    // Lock and get/create sequence row (prevents race conditions)
    await connection.execute(
      `INSERT INTO ticket_sequences (service_id, branch_id, current_number, date)
       VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE current_number = current_number`,
      [service_id, branch_id, today]
    );
    
    // Lock the row and increment atomically
    const [sequences] = await connection.execute(
      `SELECT current_number FROM ticket_sequences
       WHERE service_id = ? AND branch_id = ? AND date = ?
       FOR UPDATE`,
      [service_id, branch_id, today]
    );
    
    const currentNumber = (sequences[0]?.current_number || 0) + 1;
    
    // Update the sequence
    await connection.execute(
      `UPDATE ticket_sequences 
       SET current_number = ?
       WHERE service_id = ? AND branch_id = ? AND date = ?`,
      [currentNumber, service_id, branch_id, today]
    );
    
    const ticketNumber = `${prefix}-${String(currentNumber).padStart(3, '0')}`;
    console.log('🔢 Generated ticket number:', ticketNumber);

    // Create ticket
    const ticketId = uuidv4();
    await connection.execute(
      `INSERT INTO tickets (
        id, ticket_number, service_id, branch_id, priority_level,
        customer_name, customer_phone, notes, issued_by, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`,
      [
        ticketId,
        ticketNumber,
        service_id,
        branch_id,
        priority_level,
        customer_name || null,
        customer_phone || null,
        notes || null,
        req.user?.id || null
      ]
    );
    
    // Commit transaction
    await connection.commit();

    // Fetch created ticket with relations
    const tickets = await query(`
      SELECT t.*, 
             s.name as service_name, s.prefix as service_prefix,
             c.name as counter_name,
             b.name as branch_name
      FROM tickets t
      LEFT JOIN services s ON t.service_id = s.id
      LEFT JOIN counters c ON t.counter_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE t.id = ?
    `, [ticketId]);

    const ticket = tickets[0];

    // Emit real-time event
    const io = req.app.get('io');
    emitTicketCreated(io, ticket);

    res.status(201).json({ ticket });
  } catch (error) {
    // Rollback transaction on error
    if (connection) {
      await connection.rollback();
    }
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: 'Failed to create ticket' });
  } finally {
    // Always release connection back to pool
    if (connection) {
      connection.release();
    }
  }
});

/**
 * PATCH /api/tickets/:id
 * Update ticket status
 */
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { status, counter_id, notes } = req.body;
    const ticketId = req.params.id;

    const updates = [];
    const params = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);

      if (status === 'serving') {
        updates.push('started_at = NOW()');
      } else if (['done', 'cancelled', 'skipped'].includes(status)) {
        updates.push('ended_at = NOW()');
        updates.push('served_by = ?');
        params.push(req.user.id);
      }
    }

    if (counter_id) {
      updates.push('counter_id = ?');
      params.push(counter_id);
    }

    if (notes) {
      updates.push('notes = ?');
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(ticketId);

    await query(
      `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Fetch updated ticket
    const tickets = await query(`
      SELECT t.*, 
             s.name as service_name, s.prefix as service_prefix,
             c.name as counter_name,
             b.name as branch_name
      FROM tickets t
      LEFT JOIN services s ON t.service_id = s.id
      LEFT JOIN counters c ON t.counter_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE t.id = ?
    `, [ticketId]);

    const ticket = tickets[0];

    // Emit real-time event
    const io = req.app.get('io');
    emitTicketUpdated(io, ticket);

    res.json({ ticket });
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

/**
 * POST /api/tickets/call-next
 * Call next ticket in queue
 */
router.post('/call-next', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { service_id, counter_id } = req.body;

    if (!counter_id) {
      return res.status(400).json({ error: 'counter_id is required' });
    }

    // Start transaction for atomic operation
    await connection.beginTransaction();

    // Get next waiting ticket with row lock (prevents race conditions)
    let [tickets] = await connection.execute(
      `SELECT id FROM tickets 
       WHERE status = 'waiting' 
       AND branch_id = (SELECT branch_id FROM counters WHERE id = ?)
       ${service_id ? 'AND service_id = ?' : ''}
       ORDER BY 
         priority_level DESC,
         created_at ASC
       LIMIT 1
       FOR UPDATE`,
      service_id ? [counter_id, service_id] : [counter_id]
    );

    if (!tickets || tickets.length === 0) {
      await connection.commit();
      return res.json({ ticket: null, message: 'No tickets in queue' });
    }

    const ticketId = tickets[0].id;
    const now = new Date();

    // Update ticket status atomically
    await connection.execute(
      `UPDATE tickets 
       SET status = 'serving',
           counter_id = ?,
           called_at = ?,
           started_at = ?
       WHERE id = ?`,
      [counter_id, now, now, ticketId]
    );

    // Commit transaction
    await connection.commit();

    // Fetch updated ticket with relations (outside transaction)
    const [ticketData] = await connection.execute(`
      SELECT t.*, 
             s.name as service_name, s.prefix as service_prefix,
             c.name as counter_name,
             b.name as branch_name
      FROM tickets t
      LEFT JOIN services s ON t.service_id = s.id
      LEFT JOIN counters c ON t.counter_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      WHERE t.id = ?
    `, [ticketId]);

    const rawTicket = ticketData[0];
    
    // Transform to include nested objects
    const ticket = {
      ...rawTicket,
      service: rawTicket.service_name ? {
        name: rawTicket.service_name,
        prefix: rawTicket.service_prefix
      } : null,
      counter: rawTicket.counter_name ? {
        name: rawTicket.counter_name
      } : null,
      branch: rawTicket.branch_name ? {
        name: rawTicket.branch_name
      } : null
    };

    // Emit real-time events
    const io = req.app.get('io');
    emitTicketUpdated(io, ticket);
    emitTicketCalled(io, ticket);

    res.json({ ticket });
  } catch (error) {
    // Rollback on error
    if (connection) {
      await connection.rollback();
    }
    console.error('Error calling next ticket:', error);
    res.status(500).json({ error: 'Failed to call next ticket' });
  } finally {
    // Always release connection
    if (connection) {
      connection.release();
    }
  }
});

/**
 * DELETE /api/tickets/:id
 * Cancel/delete ticket
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const ticketId = req.params.id;

    // Get ticket info before deletion
    const tickets = await query('SELECT branch_id FROM tickets WHERE id = ?', [ticketId]);
    
    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const branchId = tickets[0].branch_id;

    // Soft delete (update status to cancelled)
    await query(
      'UPDATE tickets SET status = ?, ended_at = NOW() WHERE id = ?',
      ['cancelled', ticketId]
    );

    // Emit real-time event
    const io = req.app.get('io');
    emitTicketDeleted(io, ticketId, branchId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

module.exports = router;
