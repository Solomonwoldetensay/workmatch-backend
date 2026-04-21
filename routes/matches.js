// ─────────────────────────────────────────────
// WorkMatch — Matches Routes
// ─────────────────────────────────────────────

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/matches/swipe ─────────────────────
router.post('/swipe', protect, [
  body('project_id').notEmpty().withMessage('Project ID required'),
  body('action').isIn(['skip','collab','invest','super']).withMessage('Invalid action'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { project_id, action, message, investment_amount } = req.body;

    const projectResult = await query(
      'SELECT id, creator_id, mode, title FROM projects WHERE id = $1 AND is_active = true',
      [project_id]
    );
    if (projectResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Project not found.' });

    const project = projectResult.rows[0];
    if (project.creator_id === req.user.id) return res.status(400).json({ success: false, message: 'Cannot swipe on your own project.' });

    await query(
      `INSERT INTO swipes (swiper_id, project_id, action) VALUES ($1, $2, $3) ON CONFLICT (swiper_id, project_id, action) DO NOTHING`,
      [req.user.id, project_id, action]
    );

    if (action === 'skip') return res.json({ success: true, result: 'skipped' });

    const matchTypes = [];
    if (action === 'collab' || action === 'super') {
      if (project.mode === 'collab' || project.mode === 'both') matchTypes.push('collab');
    }
    if (action === 'invest' || action === 'super') {
      if (project.mode === 'invest' || project.mode === 'both') matchTypes.push('invest');
    }

    if (matchTypes.length === 0) return res.json({ success: true, result: 'not_applicable' });

    const createdMatches = [];
    for (const matchType of matchTypes) {
      const matchResult = await query(
        `INSERT INTO matches (project_id, creator_id, discoverer_id, match_type, message, investment_amount)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, discoverer_id, match_type) DO NOTHING
         RETURNING *`,
        [project_id, project.creator_id, req.user.id, matchType, message || null, matchType === 'invest' ? (investment_amount || null) : null]
      );
      if (matchResult.rows.length > 0) createdMatches.push(matchResult.rows[0]);
    }

    res.json({
      success: true,
      result: 'request_sent',
      message: `Your ${action} request has been sent!`,
      matches: createdMatches
    });
  } catch (error) {
    console.error('Swipe error:', error);
    res.status(500).json({ success: false, message: 'Failed to process your action.' });
  }
});

// ── GET /api/matches/my-matches — all my matches (pending + accepted + denied) ──
router.get('/my-matches', protect, async (req, res) => {
  try {
    const result = await query(
      `SELECT 
         m.id, m.match_type, m.status, m.created_at,
         p.id AS project_id, p.title AS project_title,
         c.id AS conversation_id,
         CASE WHEN m.creator_id = $1 THEN u2.id ELSE u1.id END AS other_user_id,
         CASE WHEN m.creator_id = $1 THEN u2.full_name ELSE u1.full_name END AS other_user_name,
         CASE WHEN m.creator_id = $1 THEN u2.avatar_url ELSE u1.avatar_url END AS other_user_avatar,
         CASE WHEN m.creator_id = $1 THEN 'received' ELSE 'sent' END AS direction,
         c.last_message, c.last_message_at
       FROM matches m
       JOIN projects p ON m.project_id = p.id
       JOIN users u1 ON m.creator_id = u1.id
       JOIN users u2 ON m.discoverer_id = u2.id
       LEFT JOIN conversations c ON c.match_id = m.id
       WHERE (m.creator_id = $1 OR m.discoverer_id = $1)
         AND m.status IN ('pending', 'accepted', 'denied', 'declined')
       ORDER BY m.status ASC, COALESCE(c.last_message_at, m.created_at) DESC`,
      [req.user.id]
    );
    res.json({ success: true, matches: result.rows });
  } catch (error) {
    console.error('Get my matches error:', error);
    res.status(500).json({ success: false, message: 'Failed to load matches.' });
  }
});

// ── GET /api/matches/requests — incoming requests ──
router.get('/requests', protect, async (req, res) => {
  try {
    const { match_type, project_id, status = 'pending' } = req.query;
    const params = [req.user.id, status];
    const conditions = ['m.creator_id = $1', 'm.status = $2'];

    if (match_type) { params.push(match_type); conditions.push(`m.match_type = $${params.length}`); }
    if (project_id) { params.push(project_id); conditions.push(`m.project_id = $${params.length}`); }

    const result = await query(
      `SELECT m.id, m.match_type, m.status, m.message, m.investment_amount, m.created_at,
              p.id AS project_id, p.title AS project_title, p.mode AS project_mode,
              u.id AS discoverer_id, u.full_name AS discoverer_name,
              u.bio AS discoverer_bio, u.location AS discoverer_location,
              u.skills AS discoverer_skills, u.avatar_url AS discoverer_avatar
       FROM matches m
       JOIN projects p ON m.project_id = p.id
       JOIN users u ON m.discoverer_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at DESC`,
      params
    );

    res.json({
      success: true,
      requests: result.rows,
      grouped: {
        collab: result.rows.filter(r => r.match_type === 'collab'),
        invest: result.rows.filter(r => r.match_type === 'invest'),
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to load requests.' });
  }
});

// ── PUT /api/matches/:id/accept ─────────────────
router.put('/:id/accept', protect, async (req, res) => {
  try {
    const matchResult = await query('SELECT * FROM matches WHERE id = $1 AND creator_id = $2', [req.params.id, req.user.id]);
    if (matchResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Match request not found.' });

    const match = matchResult.rows[0];
    if (match.status !== 'pending') return res.status(400).json({ success: false, message: `Already ${match.status}.` });

    await query('UPDATE matches SET status = $1 WHERE id = $2', ['accepted', req.params.id]);

    const existingConvo = await query('SELECT id FROM conversations WHERE match_id = $1', [req.params.id]);
    let conversationId;
    if (existingConvo.rows.length === 0) {
      const convoResult = await query(
        `INSERT INTO conversations (match_id, user1_id, user2_id) VALUES ($1, $2, $3) RETURNING id`,
        [req.params.id, match.creator_id, match.discoverer_id]
      );
      conversationId = convoResult.rows[0].id;
    } else {
      conversationId = existingConvo.rows[0].id;
    }

    res.json({ success: true, message: 'Match accepted!', conversation_id: conversationId });
  } catch (error) {
    console.error('Accept match error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept match.' });
  }
});

// ── POST /api/matches/:id/accept — alias for frontend ──
router.post('/:id/accept', protect, async (req, res) => {
  req.method = 'PUT';
  router.handle(req, res, () => {});
});

// ── PUT /api/matches/:id/decline ───────────────
router.put('/:id/decline', protect, async (req, res) => {
  try {
    const matchResult = await query('SELECT * FROM matches WHERE id = $1 AND creator_id = $2', [req.params.id, req.user.id]);
    if (matchResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Match request not found.' });
    await query('UPDATE matches SET status = $1 WHERE id = $2', ['declined', req.params.id]);
    res.json({ success: true, message: 'Request declined.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to decline match.' });
  }
});

// ── POST /api/matches/:id/deny — alias used by frontend ──
router.post('/:id/deny', protect, async (req, res) => {
  try {
    const matchResult = await query('SELECT * FROM matches WHERE id = $1 AND creator_id = $2', [req.params.id, req.user.id]);
    if (matchResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Match request not found.' });
    await query('UPDATE matches SET status = $1 WHERE id = $2', ['denied', req.params.id]);
    res.json({ success: true, message: 'Check back later.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update match.' });
  }
});

module.exports = router;
