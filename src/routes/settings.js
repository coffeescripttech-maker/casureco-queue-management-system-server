const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, requireRole, optionalAuth } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Get branding settings (public endpoint)
router.get('/branding', async (req, res) => {
  try {
    const branding = await query('SELECT * FROM branding_settings LIMIT 1');
    
    if (branding.length === 0) {
      // Return default branding
      return res.json({
        branding: {
          id: 'default',
          company_name: process.env.APP_NAME || 'NAGA Queue System',
          primary_color: '#2563EB',
          secondary_color: '#1E40AF',
          ticket_header_text: 'Please keep your ticket',
          ticket_footer_text: 'Thank you for your patience',
          show_qr_code: true,
          show_logo_on_ticket: true,
          ticket_border_color: '#2563EB'
        }
      });
    }
    
    // Convert TINYINT to boolean
    const brandingData = {
      ...branding[0],
      show_qr_code: Boolean(branding[0].show_qr_code),
      show_logo_on_ticket: Boolean(branding[0].show_logo_on_ticket)
    };
    
    res.json({ branding: brandingData });
  } catch (error) {
    console.error('Branding error:', error);
    res.status(500).json({ error: 'Failed to fetch branding' });
  }
});

// Update branding settings (admin only)
router.post('/branding', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const {
      company_name,
      logo_url,
      primary_color,
      secondary_color,
      ticket_header_text,
      ticket_footer_text,
      show_qr_code,
      show_logo_on_ticket,
      ticket_border_color
    } = req.body;
    
    // Check if branding exists
    const existing = await query('SELECT id FROM branding_settings LIMIT 1');
    
    if (existing.length > 0) {
      // Update existing
      await query(
        `UPDATE branding_settings SET
          company_name = ?,
          logo_url = ?,
          primary_color = ?,
          secondary_color = ?,
          ticket_header_text = ?,
          ticket_footer_text = ?,
          show_qr_code = ?,
          show_logo_on_ticket = ?,
          ticket_border_color = ?,
          updated_at = NOW()
         WHERE id = ?`,
        [
          company_name,
          logo_url,
          primary_color,
          secondary_color,
          ticket_header_text,
          ticket_footer_text,
          show_qr_code ? 1 : 0,
          show_logo_on_ticket ? 1 : 0,
          ticket_border_color,
          existing[0].id
        ]
      );
      
      // Fetch and return updated branding
      const updated = await query('SELECT * FROM branding_settings WHERE id = ?', [existing[0].id]);
      const brandingData = {
        ...updated[0],
        show_qr_code: Boolean(updated[0].show_qr_code),
        show_logo_on_ticket: Boolean(updated[0].show_logo_on_ticket)
      };
      
      res.json({ branding: brandingData });
    } else {
      // Insert new
      const id = uuidv4();
      await query(
        `INSERT INTO branding_settings (
          id, company_name, logo_url, primary_color, secondary_color,
          ticket_header_text, ticket_footer_text, show_qr_code,
          show_logo_on_ticket, ticket_border_color
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          company_name,
          logo_url,
          primary_color,
          secondary_color,
          ticket_header_text,
          ticket_footer_text,
          show_qr_code ? 1 : 0,
          show_logo_on_ticket ? 1 : 0,
          ticket_border_color
        ]
      );
      
      // Fetch and return new branding
      const newBranding = await query('SELECT * FROM branding_settings WHERE id = ?', [id]);
      const brandingData = {
        ...newBranding[0],
        show_qr_code: Boolean(newBranding[0].show_qr_code),
        show_logo_on_ticket: Boolean(newBranding[0].show_logo_on_ticket)
      };
      
      res.json({ branding: brandingData });
    }
  } catch (error) {
    console.error('Update branding error:', error);
    res.status(500).json({ error: 'Failed to update branding', details: error.message });
  }
});

// Get system settings
router.get('/system', optionalAuth, async (req, res) => {
  try {
    const systemSettings = await query('SELECT * FROM system_settings WHERE setting_key = ?', ['system_config']);
    
    if (systemSettings.length === 0) {
      // Return default settings
      return res.json({
        settings: {
          max_queue_size: 100,
          auto_call_next: true,
          display_refresh_interval: 5,
          show_wait_times: true,
          language: 'en',
          monday_open: '08:00',
          monday_close: '17:00',
          tuesday_open: '08:00',
          tuesday_close: '17:00',
          wednesday_open: '08:00',
          wednesday_close: '17:00',
          thursday_open: '08:00',
          thursday_close: '17:00',
          friday_open: '08:00',
          friday_close: '17:00',
          saturday_open: '08:00',
          saturday_close: '12:00',
          sunday_open: '08:00',
          sunday_close: '12:00',
          is_monday_open: true,
          is_tuesday_open: true,
          is_wednesday_open: true,
          is_thursday_open: true,
          is_friday_open: true,
          is_saturday_open: false,
          is_sunday_open: false,
          maintenance_mode: false,
          maintenance_message: 'System is currently under maintenance. Please check back later.',
          organization_name: 'NAGA Queue System',
          support_email: 'support@example.com',
          support_phone: '+1234567890',
        }
      });
    }
    
    const settingsValue = JSON.parse(systemSettings[0].setting_value);
    
    // Convert TINYINT to boolean for boolean fields
    const booleanFields = ['auto_call_next', 'show_wait_times', 'is_monday_open', 'is_tuesday_open', 
                           'is_wednesday_open', 'is_thursday_open', 'is_friday_open', 'is_saturday_open', 
                           'is_sunday_open', 'maintenance_mode'];
    
    booleanFields.forEach(field => {
      if (settingsValue[field] !== undefined) {
        settingsValue[field] = Boolean(settingsValue[field]);
      }
    });
    
    res.json({ settings: settingsValue });
  } catch (error) {
    console.error('System settings error:', error);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

// Update system settings (admin only)
router.post('/system', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const settings = req.body;
    
    // Convert boolean to TINYINT for storage
    const booleanFields = ['auto_call_next', 'show_wait_times', 'is_monday_open', 'is_tuesday_open', 
                           'is_wednesday_open', 'is_thursday_open', 'is_friday_open', 'is_saturday_open', 
                           'is_sunday_open', 'maintenance_mode'];
    
    const settingsToStore = { ...settings };
    booleanFields.forEach(field => {
      if (settingsToStore[field] !== undefined) {
        settingsToStore[field] = settingsToStore[field] ? 1 : 0;
      }
    });
    
    // Check if settings exist
    const existing = await query('SELECT id FROM system_settings WHERE setting_key = ?', ['system_config']);
    
    if (existing.length > 0) {
      // Update existing
      await query(
        `UPDATE system_settings SET setting_value = ?, updated_at = NOW() WHERE id = ?`,
        [JSON.stringify(settingsToStore), existing[0].id]
      );
    } else {
      // Insert new
      const id = uuidv4();
      await query(
        `INSERT INTO system_settings (id, setting_key, setting_value, description) VALUES (?, ?, ?, ?)`,
        [id, 'system_config', JSON.stringify(settingsToStore), 'System configuration settings']
      );
    }
    
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({ error: 'Failed to update system settings', details: error.message });
  }
});

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { branch_id } = req.query;
    const settings = await query(
      'SELECT * FROM system_settings WHERE branch_id = ? OR branch_id IS NULL',
      [branch_id]
    );
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { branch_id, setting_key, setting_value, description } = req.body;
    const id = uuidv4();
    
    await query(
      `INSERT INTO system_settings (id, branch_id, setting_key, setting_value, description)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
      [id, branch_id, setting_key, JSON.stringify(setting_value), description, JSON.stringify(setting_value)]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

module.exports = router;
