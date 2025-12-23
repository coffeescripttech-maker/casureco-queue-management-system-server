const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// GET all users
router.get('/', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { branch_id, role } = req.query;
    let sql = `
      SELECT u.id, u.name, u.email, u.role, u.branch_id, u.is_active, 
             u.avatar_url, u.created_at, u.updated_at,
             b.name as branch_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (branch_id) {
      sql += ' AND u.branch_id = ?';
      params.push(branch_id);
    }

    if (role) {
      sql += ' AND u.role = ?';
      params.push(role);
    }

    sql += ' ORDER BY u.name ASC';
    const usersData = await query(sql, params);
    
    // Format response to match frontend expectations
    const users = usersData.map(user => ({
      ...user,
      branch: user.branch_name ? {
        name: user.branch_name
      } : null
    }));
    
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST create user
router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, role, branch_id } = req.body;
    
    const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, branch_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, email, passwordHash, role, branch_id]
    );

    const users = await query('SELECT id, name, email, role, branch_id, is_active FROM users WHERE id = ?', [id]);
    res.status(201).json({ user: users[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH update user
router.patch('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const updates = [];
    const params = [];

    ['name', 'email', 'role', 'branch_id', 'is_active', 'avatar_url'].forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    });

    if (req.body.password) {
      const passwordHash = await bcrypt.hash(req.body.password, 10);
      updates.push('password_hash = ?');
      params.push(passwordHash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(req.params.id);
    await query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);

    const users = await query('SELECT id, name, email, role, branch_id, is_active FROM users WHERE id = ?', [req.params.id]);
    res.json({ user: users[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE user
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
