const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, requireRole, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { emitAnnouncementCreated, emitAnnouncementUpdated, emitAnnouncementDeleted } = require('../socket/socketHandler');

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { branch_id, is_active, include_global } = req.query;
    const now = new Date();
    
    let sql = `
      SELECT 
        a.*,
        b.name as branch_name,
        u.name as creator_name
      FROM announcements a
      LEFT JOIN branches b ON a.branch_id = b.id
      LEFT JOIN users u ON a.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    // Filter by branch or include global announcements
    if (branch_id) {
      if (include_global === 'true') {
        sql += ' AND (a.branch_id = ? OR a.branch_id IS NULL)';
        params.push(branch_id);
      } else {
        sql += ' AND a.branch_id = ?';
        params.push(branch_id);
      }
    }

    // Filter by active status
    if (is_active !== undefined) {
      sql += ' AND a.is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    // Filter by date range (only show announcements that are currently valid)
    if (is_active === 'true') {
      sql += ' AND (a.start_date IS NULL OR a.start_date <= ?)';
      params.push(now);
      sql += ' AND (a.end_date IS NULL OR a.end_date >= ?)';
      params.push(now);
    }

    sql += ' ORDER BY a.priority DESC, a.created_at DESC';
    const results = await query(sql, params);
    
    // Transform results to include nested objects and convert TINYINT to boolean
    const announcements = results.map(row => ({
      ...row,
      // Convert TINYINT(1) to boolean
      enable_tts: Boolean(row.enable_tts),
      play_audio_on_display: Boolean(row.play_audio_on_display),
      loop_media: Boolean(row.loop_media),
      is_active: Boolean(row.is_active),
      // Parse JSON fields
      media_urls: row.media_urls ? JSON.parse(row.media_urls) : null,
      // Nested objects
      branch: row.branch_name ? { name: row.branch_name } : null,
      creator: row.creator_name ? { name: row.creator_name } : null,
      // Remove the flat fields
      branch_name: undefined,
      creator_name: undefined
    }));
    
    res.json({ announcements });
  } catch (error) {
    console.error('Fetch announcements error:', error);
    res.status(500).json({ error: 'Failed to fetch announcements', details: error.message });
  }
});

router.post('/', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { branch_id, title, message, type, content_type, media_url, media_urls, thumbnail_url, audio_url, 
            enable_tts, tts_voice, tts_speed, play_audio_on_display, loop_media, transition_duration,
            display_duration, priority, start_date, end_date, is_active } = req.body;
    const id = uuidv4();
    
    await query(
      `INSERT INTO announcements (
        id, branch_id, title, message, type, content_type, media_url, media_urls, thumbnail_url, audio_url,
        enable_tts, tts_voice, tts_speed, play_audio_on_display, loop_media, transition_duration,
        display_duration, priority, start_date, end_date, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, branch_id, title, message, type || 'info', content_type || 'text', media_url, 
        media_urls ? JSON.stringify(media_urls) : null, thumbnail_url, audio_url,
        enable_tts ? 1 : 0, tts_voice || 'default', parseFloat(tts_speed) || 1.0, 
        play_audio_on_display ? 1 : 0, loop_media !== undefined ? (loop_media ? 1 : 0) : 1, 
        parseInt(transition_duration) || 5, parseInt(display_duration) || 10, parseInt(priority) || 0, 
        start_date, end_date, is_active !== undefined ? (is_active ? 1 : 0) : 1,
        req.user.id
      ]
    );

    const announcements = await query('SELECT * FROM announcements WHERE id = ?', [id]);
    const announcement = announcements[0];
    
    // Convert TINYINT to boolean for response
    if (announcement) {
      announcement.enable_tts = Boolean(announcement.enable_tts);
      announcement.play_audio_on_display = Boolean(announcement.play_audio_on_display);
      announcement.loop_media = Boolean(announcement.loop_media);
      announcement.is_active = Boolean(announcement.is_active);
      announcement.media_urls = announcement.media_urls ? JSON.parse(announcement.media_urls) : null;
    }

    // Emit real-time event
    const io = req.app.get('io');
    emitAnnouncementCreated(io, announcement);

    res.status(201).json({ announcement });
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ error: 'Failed to create announcement', details: error.message });
  }
});

// PATCH /api/announcements/:id - Update announcement
router.patch('/:id', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_id, title, message, type, content_type, media_url, media_urls, thumbnail_url, audio_url,
            enable_tts, tts_voice, tts_speed, play_audio_on_display, loop_media, transition_duration,
            display_duration, priority, start_date, end_date, is_active } = req.body;
    
    await query(
      `UPDATE announcements SET
        branch_id = ?, title = ?, message = ?, type = ?, content_type = ?, media_url = ?, media_urls = ?,
        thumbnail_url = ?, audio_url = ?, enable_tts = ?, tts_voice = ?, tts_speed = ?,
        play_audio_on_display = ?, loop_media = ?, transition_duration = ?, display_duration = ?,
        priority = ?, start_date = ?, end_date = ?, is_active = ?, updated_at = NOW()
      WHERE id = ?`,
      [
        branch_id, title, message, type, content_type, media_url,
        media_urls ? JSON.stringify(media_urls) : null, thumbnail_url, audio_url,
        enable_tts ? 1 : 0, tts_voice, parseFloat(tts_speed), play_audio_on_display ? 1 : 0, 
        loop_media ? 1 : 0, parseInt(transition_duration),
        parseInt(display_duration), parseInt(priority), start_date, end_date, is_active ? 1 : 0, id
      ]
    );

    const announcements = await query('SELECT * FROM announcements WHERE id = ?', [id]);
    const announcement = announcements[0];
    
    // Convert TINYINT to boolean for response
    if (announcement) {
      announcement.enable_tts = Boolean(announcement.enable_tts);
      announcement.play_audio_on_display = Boolean(announcement.play_audio_on_display);
      announcement.loop_media = Boolean(announcement.loop_media);
      announcement.is_active = Boolean(announcement.is_active);
      announcement.media_urls = announcement.media_urls ? JSON.parse(announcement.media_urls) : null;
    }

    // Emit real-time event
    const io = req.app.get('io');
    emitAnnouncementUpdated(io, announcement);

    res.json({ announcement });
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ error: 'Failed to update announcement', details: error.message });
  }
});

// DELETE /api/announcements/:id - Delete announcement
router.delete('/:id', authenticateToken, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get announcement before deleting to know the branch_id
    const announcements = await query('SELECT branch_id FROM announcements WHERE id = ?', [id]);
    const branchId = announcements[0]?.branch_id;
    
    await query('DELETE FROM announcements WHERE id = ?', [id]);
    
    // Emit real-time event
    const io = req.app.get('io');
    emitAnnouncementDeleted(io, id, branchId);
    
    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ error: 'Failed to delete announcement', details: error.message });
  }
});

module.exports = router;
