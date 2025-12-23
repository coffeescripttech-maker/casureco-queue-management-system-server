const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, requireRole, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET all services
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { branch_id, is_active } = req.query;
    let sql = 'SELECT * FROM services WHERE 1=1';
    const params = [];

    if (branch_id) {
      sql += ' AND branch_id = ?';
      params.push(branch_id);
    }

    if (is_active !== undefined) {
      sql += ' AND is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    sql += ' ORDER BY name ASC';
    const services = await query(sql, params);
    res.json({ services });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// POST create service
router.post('/', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { name, prefix, description, avg_service_time, branch_id, color, icon } = req.body;
    
    // Validation
    if (!name || !prefix) {
      return res.status(400).json({ error: 'Name and prefix are required' });
    }

    // Validate branch_id if provided (allow null for global services)
    if (branch_id && branch_id !== '') {
      const branches = await query('SELECT id FROM branches WHERE id = ?', [branch_id]);
      if (branches.length === 0) {
        return res.status(400).json({ 
          error: 'Invalid branch_id - branch does not exist',
          hint: 'Leave branch_id empty for global services or create the branch first'
        });
      }
    }

    const id = uuidv4();
    
    await query(
      `INSERT INTO services (id, name, prefix, description, avg_service_time, branch_id, color, icon)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, prefix, description || null, avg_service_time || 300, branch_id || null, color || '#3b82f6', icon || 'briefcase']
    );

    const services = await query('SELECT * FROM services WHERE id = ?', [id]);
    res.status(201).json({ service: services[0] });
  } catch (error) {
    console.error('Error creating service:', error);
    
    // Handle duplicate prefix error
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Service prefix already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create service', details: error.message });
  }
});

// PATCH update service
router.patch('/:id', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    // Check if service exists
    const existing = await query('SELECT id FROM services WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const updates = [];
    const params = [];

    ['name', 'prefix', 'description', 'avg_service_time', 'color', 'icon', 'is_active'].forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(req.params.id);
    await query(`UPDATE services SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);

    const services = await query('SELECT * FROM services WHERE id = ?', [req.params.id]);
    res.json({ service: services[0] });
  } catch (error) {
    console.error('Error updating service:', error);
    
    // Handle duplicate prefix error
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Service prefix already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update service', details: error.message });
  }
});

// DELETE service
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    // Check if service exists
    const existing = await query('SELECT id FROM services WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Check if service is being used by any tickets
    const tickets = await query('SELECT COUNT(*) as count FROM tickets WHERE service_id = ?', [req.params.id]);
    if (tickets[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete service',
        details: `This service is used by ${tickets[0].count} ticket(s). Please deactivate instead of deleting.`
      });
    }

    await query('DELETE FROM services WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ error: 'Failed to delete service', details: error.message });
  }
});

module.exports = router;
