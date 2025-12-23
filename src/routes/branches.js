const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, requireRole, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', optionalAuth, async (req, res) => {
  try {
    const branches = await query('SELECT * FROM branches ORDER BY name ASC');
    res.json({ branches });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, mode, settings } = req.body;
    const id = uuidv4();
    
    await query(
      'INSERT INTO branches (id, name, mode, settings) VALUES (?, ?, ?, ?)',
      [id, name, mode || 'hybrid', JSON.stringify(settings || {})]
    );

    const branches = await query('SELECT * FROM branches WHERE id = ?', [id]);
    res.status(201).json({ branch: branches[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create branch' });
  }
});

router.patch('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const updates = [];
    const params = [];

    ['name', 'mode', 'is_active'].forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    });

    if (req.body.settings) {
      updates.push('settings = ?');
      params.push(JSON.stringify(req.body.settings));
    }

    params.push(req.params.id);
    await query(`UPDATE branches SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);

    const branches = await query('SELECT * FROM branches WHERE id = ?', [req.params.id]);
    res.json({ branch: branches[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update branch' });
  }
});

module.exports = router;
