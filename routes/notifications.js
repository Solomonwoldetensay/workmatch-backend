// ─────────────────────────────────────────────
// WE-NEED-U — Notifications Routes
// POST /api/notifications/token     — save device token
// GET  /api/notifications            — get my notifications
// PUT  /api/notifications/read-all   — mark all as read
// PUT  /api/notifications/:id/read   — mark one as read
// GET  /api/notifications/unread-count — badge count
// ─────────────────────────────────────────────

const express = require('express');
const https   = require('https');
const { query } = require('../config/database');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── Helper: create in-app notification ────────
async function createNotification(userId, type, title, body, data = {}) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, body, JSON.stringify(data)]
    );
  } catch (err) {
    console.error('Create notification error:', err.message);
  }
}

// ── Helper: send push notification via APNs ───
async function sendPushNotification(userId, title, body, data = {}) {
  try {
    // Get all device tokens for this user
    const result = await query(
      'SELECT token FROM device_tokens WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) return;

    const apnsKey      = process.env.APNS_PRIVATE_KEY;
    const apnsKeyId    = process.env.APNS_KEY_ID;
    const apnsTeamId   = process.env.APNS_TEAM_ID;
    const bundleId     = process.env.APNS_BUNDLE_ID || 'com.weneedu.app';

    // Skip if APNs not configured yet
    if (!apnsKey || !apnsKeyId || !apnsTeamId) {
      console.log('APNs not configured yet — skipping push, in-app only');
      return;
    }

    // Send to each device token
    for (const row of result.rows) {
      const payload = JSON.stringify({
        aps: {
          alert: { title, body },
          badge: 1,
          sound: 'default',
        },
        data,
      });

      // APNs HTTP/2 request
      const options = {
        hostname: 'api.push.apple.com',
        path: `/3/device/${row.token}`,
        method: 'POST',
        headers: {
          'apns-topic': bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      };

      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          console.error('APNs error:', res.statusCode);
          // Remove invalid token
          if (res.statusCode === 410) {
            query('DELETE FROM device_tokens WHERE token = $1', [row.token]);
          }
        }
      });
      req.on('error', (e) => console.error('APNs request error:', e.message));
      req.write(payload);
      req.end();
    }
  } catch (err) {
    console.error('Send push error:', err.message);
  }
}

// ── POST /api/notifications/token ─────────────
// Called when app starts — saves device token for push
router.post('/token', protect, async (req, res) => {
  try {
    const { token, platform = 'ios' } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required.' });

    await query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO NOTHING`,
      [req.user.id, token, platform]
    );

    res.json({ success: true, message: 'Device token saved.' });
  } catch (error) {
    console.error('Save token error:', error);
    res.status(500).json({ success: false, message: 'Failed to save token.' });
  }
});

// ── GET /api/notifications ─────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, type, title, body, data, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load notifications.' });
  }
});

// ── GET /api/notifications/unread-count ────────
router.get('/unread-count', protect, async (req, res) => {
  try {
    const result = await query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get count.' });
  }
});

// ── PUT /api/notifications/read-all ───────────
router.put('/read-all', protect, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to mark as read.' });
  }
});

// ── PUT /api/notifications/:id/read ───────────
router.put('/:id/read', protect, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to mark as read.' });
  }
});

module.exports = { router, createNotification, sendPushNotification };
