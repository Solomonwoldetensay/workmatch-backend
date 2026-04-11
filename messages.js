// ─────────────────────────────────────────────
// WorkMatch — Messages Routes
// GET  /api/messages/conversations       — get all my conversations
// GET  /api/messages/:conversation_id    — get messages in a conversation
// POST /api/messages/:conversation_id    — send a message
// PUT  /api/messages/:conversation_id/read — mark messages as read
// ─────────────────────────────────────────────

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/messages/conversations ────────────
router.get('/conversations', protect, async (req, res) => {
  try {
    const result = await query(
      `SELECT 
         c.id AS conversation_id,
         c.last_message,
         c.last_message_at,
         m.match_type,
         p.id AS project_id,
         p.title AS project_title,
         -- Unread count for current user
         (SELECT COUNT(*) FROM messages msg
          WHERE msg.conversation_id = c.id
            AND msg.sender_id != $1
            AND msg.is_read = false) AS unread_count,
         -- The other person
         CASE WHEN c.user1_id = $1 THEN u2.id       ELSE u1.id       END AS other_user_id,
         CASE WHEN c.user1_id = $1 THEN u2.full_name ELSE u1.full_name END AS other_user_name,
         CASE WHEN c.user1_id = $1 THEN u2.avatar_url ELSE u1.avatar_url END AS other_user_avatar
       FROM conversations c
       JOIN matches m ON c.match_id = m.id
       JOIN projects p ON m.project_id = p.id
       JOIN users u1 ON c.user1_id = u1.id
       JOIN users u2 ON c.user2_id = u2.id
       WHERE c.user1_id = $1 OR c.user2_id = $1
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      [req.user.id]
    );

    res.json({ success: true, conversations: result.rows });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Failed to load conversations.' });
  }
});

// ── GET /api/messages/:conversation_id ─────────
router.get('/:conversation_id', protect, async (req, res) => {
  try {
    // Verify user is part of this conversation
    const convoCheck = await query(
      'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [req.params.conversation_id, req.user.id]
    );

    if (convoCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this conversation.' });
    }

    // Get messages with pagination
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT 
         msg.id, msg.content, msg.is_read, msg.created_at,
         u.id AS sender_id, u.full_name AS sender_name, u.avatar_url AS sender_avatar
       FROM messages msg
       JOIN users u ON msg.sender_id = u.id
       WHERE msg.conversation_id = $1
       ORDER BY msg.created_at ASC
       LIMIT $2 OFFSET $3`,
      [req.params.conversation_id, limit, offset]
    );

    res.json({ success: true, messages: result.rows });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: 'Failed to load messages.' });
  }
});

// ── POST /api/messages/:conversation_id — send message ──
router.post('/:conversation_id', protect, [
  body('content').trim().notEmpty().withMessage('Message cannot be empty'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // Verify user is part of this conversation
    const convoCheck = await query(
      'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [req.params.conversation_id, req.user.id]
    );

    if (convoCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Not authorized to send to this conversation.' });
    }

    const { content } = req.body;

    // Insert the message
    const msgResult = await query(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, is_read, created_at`,
      [req.params.conversation_id, req.user.id, content]
    );

    // Update conversation's last_message
    await query(
      `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2`,
      [content.length > 60 ? content.slice(0, 60) + '...' : content, req.params.conversation_id]
    );

    const message = msgResult.rows[0];

    res.status(201).json({
      success: true,
      message: {
        ...message,
        sender_id:     req.user.id,
        sender_name:   req.user.full_name,
      }
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// ── PUT /api/messages/:conversation_id/read ─────
router.put('/:conversation_id/read', protect, async (req, res) => {
  try {
    await query(
      `UPDATE messages SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [req.params.conversation_id, req.user.id]
    );

    res.json({ success: true, message: 'Messages marked as read.' });

  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark messages as read.' });
  }
});

module.exports = router;
