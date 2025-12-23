const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/reports/stats - Dashboard stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { branch_id, date } = req.query;
    const today = date || new Date().toISOString().split('T')[0];
    
    // Get counts from different tables
    const branches = await query('SELECT COUNT(*) as count FROM branches WHERE is_active = 1');
    const users = await query('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
    const counters = await query('SELECT COUNT(*) as count FROM counters WHERE is_active = 1');
    const services = await query('SELECT COUNT(*) as count FROM services WHERE is_active = 1');
    
    // Get today's tickets
    const ticketsToday = await query(
      `SELECT COUNT(*) as count FROM tickets WHERE DATE(created_at) = ?`,
      [today]
    );
    
    // Get average wait time (in seconds)
    const avgWait = await query(
      `SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, started_at)) as avg_time 
       FROM tickets 
       WHERE DATE(created_at) = ? AND started_at IS NOT NULL`,
      [today]
    );
    
    res.json({
      branches: branches[0]?.count || 0,
      users: users[0]?.count || 0,
      counters: counters[0]?.count || 0,
      services: services[0]?.count || 0,
      tickets_today: ticketsToday[0]?.count || 0,
      avg_wait_time: avgWait[0]?.avg_time || 0
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
});

// GET /api/reports/daily-summary - Daily ticket summary
router.get('/daily-summary', authenticateToken, async (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    
    if (!branch_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'branch_id, start_date, and end_date are required' });
    }

    const dailySummary = await query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_tickets,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
        SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
        SUM(CASE WHEN status = 'serving' THEN 1 ELSE 0 END) as serving,
        AVG(CASE 
          WHEN status = 'done' AND started_at IS NOT NULL AND ended_at IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, started_at, ended_at) 
          ELSE NULL 
        END) as avg_service_time,
        AVG(CASE 
          WHEN started_at IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, created_at, started_at) 
          ELSE NULL 
        END) as avg_wait_time
      FROM tickets
      WHERE branch_id = ?
        AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at)
      ORDER BY date ASC`,
      [branch_id, start_date, end_date]
    );

    res.json({ daily_summary: dailySummary });
  } catch (error) {
    console.error('Daily summary error:', error);
    res.status(500).json({ error: 'Failed to fetch daily summary', details: error.message });
  }
});

// GET /api/reports/staff-performance - Staff performance metrics
router.get('/staff-performance', authenticateToken, async (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    
    if (!branch_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'branch_id, start_date, and end_date are required' });
    }

    const staffPerformance = await query(
      `SELECT 
        t.served_by as staff_id,
        u.name as staff_name,
        c.name as counter_name,
        DATE(t.created_at) as date,
        COUNT(*) as tickets_served,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed,
        AVG(CASE 
          WHEN t.status = 'done' AND t.started_at IS NOT NULL AND t.ended_at IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, t.started_at, t.ended_at) 
          ELSE NULL 
        END) as avg_service_time,
        SUM(CASE WHEN t.transferred_from_counter_id IS NOT NULL THEN 1 ELSE 0 END) as tickets_transferred_in,
        (SELECT COUNT(*) 
         FROM tickets t2 
         WHERE t2.transferred_by = t.served_by 
           AND t2.branch_id = ?
           AND DATE(t2.created_at) BETWEEN ? AND ?
        ) as tickets_transferred_out
      FROM tickets t
      LEFT JOIN users u ON t.served_by = u.id
      LEFT JOIN counters c ON t.counter_id = c.id
      WHERE t.branch_id = ?
        AND t.served_by IS NOT NULL
        AND DATE(t.created_at) BETWEEN ? AND ?
      GROUP BY t.served_by, u.name, c.name, DATE(t.created_at)
      ORDER BY date DESC, tickets_served DESC`,
      [branch_id, start_date, end_date, branch_id, start_date, end_date]
    );

    res.json({ staff_performance: staffPerformance });
  } catch (error) {
    console.error('Staff performance error:', error);
    res.status(500).json({ error: 'Failed to fetch staff performance', details: error.message });
  }
});

// GET /api/reports/hourly-traffic - Hourly traffic patterns
router.get('/hourly-traffic', authenticateToken, async (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    
    if (!branch_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'branch_id, start_date, and end_date are required' });
    }

    const hourlyTraffic = await query(
      `SELECT 
        DAYOFWEEK(created_at) - 1 as day_of_week,
        HOUR(created_at) as hour,
        COUNT(*) as ticket_count,
        AVG(CASE 
          WHEN started_at IS NOT NULL 
          THEN TIMESTAMPDIFF(SECOND, created_at, started_at) 
          ELSE NULL 
        END) as avg_wait_time
      FROM tickets
      WHERE branch_id = ?
        AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour`,
      [branch_id, start_date, end_date]
    );

    res.json({ hourly_traffic: hourlyTraffic });
  } catch (error) {
    console.error('Hourly traffic error:', error);
    res.status(500).json({ error: 'Failed to fetch hourly traffic', details: error.message });
  }
});

module.exports = router;
