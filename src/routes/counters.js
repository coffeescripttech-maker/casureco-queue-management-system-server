const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, requireRole, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { emitCounterUpdated } = require('../socket/socketHandler');

// GET all counters
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { branch_id, is_active, staff_id } = req.query;

    let sql = `
      SELECT 
        c.*,
        u.name AS staff_name,
        u.email AS staff_email,
        b.name AS branch_name
      FROM counters c
      LEFT JOIN users u ON c.staff_id = u.id
      LEFT JOIN branches b ON c.branch_id = b.id
      WHERE 1=1
    `;

    const params = [];

    // filter by branch
    if (branch_id) {
      sql += ' AND c.branch_id = ?';
      params.push(branch_id);
    }

    // filter by active status (true/false)
    if (is_active !== undefined) {
      sql += ' AND c.is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    // filter by staff_id
    if (staff_id) {
      sql += ' AND c.staff_id = ?';
      params.push(staff_id);
    }

    sql += ' ORDER BY c.name ASC';

    const counters = await query(sql, params);
    
    // Format response to match frontend expectations
    const formattedCounters = counters.map(counter => ({
      ...counter,
      staff: counter.staff_name ? {
        name: counter.staff_name,
        email: counter.staff_email
      } : null,
      branch: counter.branch_name ? {
        name: counter.branch_name
      } : null
    }));
    
    res.json({ counters: formattedCounters });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch counters' });
  }
});


// POST create counter
router.post('/', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { name, branch_id, staff_id, settings } = req.body;
    const id = uuidv4();
    
    await query(
      `INSERT INTO counters (id, name, branch_id, staff_id, settings)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, branch_id, staff_id || null, JSON.stringify(settings || {})]
    );

    const counters = await query('SELECT * FROM counters WHERE id = ?', [id]);
    res.status(201).json({ counter: counters[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create counter' });
  }
});

// PATCH update counter
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const updates = [];
    const params = [];

    ['name', 'staff_id', 'is_active', 'is_paused'].forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    });

    if (req.body.settings) {
      updates.push('settings = ?');
      params.push(JSON.stringify(req.body.settings));
    }

    updates.push('last_ping = NOW()');

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(req.params.id);
    await query(`UPDATE counters SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);

    const counters = await query('SELECT * FROM counters WHERE id = ?', [req.params.id]);
    const counter = counters[0];

    // Emit real-time update
    const io = req.app.get('io');
    emitCounterUpdated(io, counter);

    res.json({ counter });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update counter' });
  }
});

// POST assign staff to counter
router.post('/:id/assign', authenticateToken, async (req, res) => {
  try {
    const { staff_id } = req.body;
    
    await query(
      'UPDATE counters SET staff_id = ?, is_active = 1, updated_at = NOW() WHERE id = ?',
      [staff_id, req.params.id]
    );

    const counters = await query('SELECT * FROM counters WHERE id = ?', [req.params.id]);
    res.json({ counter: counters[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign staff' });
  }
});

// DELETE counter
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM counters WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete counter' });
  }
});

module.exports = router;
