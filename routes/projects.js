// ─────────────────────────────────────────────
// WorkMatch — Projects Routes
// ─────────────────────────────────────────────

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { protect, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/projects — scrollable feed ────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, mode, page = 1, limit = 10, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = ['p.is_active = true'];

    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`LOWER(p.category) = LOWER($${params.length})`);
    }
    if (mode && mode !== 'all') {
      params.push(mode);
      conditions.push(`(p.mode = $${params.length} OR p.mode = 'both')`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }
    if (req.user) {
      params.push(req.user.id);
      conditions.push(`p.id NOT IN (SELECT project_id FROM swipes WHERE swiper_id = $${params.length})`);
      conditions.push(`p.creator_id != $${params.length}`);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countResult = await query(`SELECT COUNT(*) FROM projects p ${whereClause}`, params);

    params.push(parseInt(limit));
    params.push(offset);

    const result = await query(
      `SELECT 
         p.id, p.title, p.description, p.category, p.tags,
         p.required_skills, p.mode, p.stage,
         p.investment_target, p.equity_offered,
         p.image_url, p.video_url, p.views, p.created_at,
         u.id AS creator_id, u.full_name AS creator_name,
         u.bio AS creator_bio, u.location AS creator_location,
         u.skills AS creator_skills, u.avatar_url AS creator_avatar,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted' AND match_type = 'invest') AS invest_count,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted' AND match_type = 'collab') AS collab_count,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS match_count,
         (SELECT COUNT(*) FROM comments WHERE project_id = p.id) AS comment_count,
         (SELECT COUNT(*) FROM likes WHERE project_id = p.id) AS like_count
       FROM projects p
       JOIN users u ON p.creator_id = u.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = parseInt(countResult.rows[0].count);
    res.json({
      success: true,
      projects: result.rows,
      pagination: {
        total, page: parseInt(page), limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit)),
        has_more: offset + result.rows.length < total,
      }
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ success: false, message: 'Failed to load projects.' });
  }
});

// ── GET /api/projects/mine — my projects ────────
router.get('/mine', protect, async (req, res) => {
  try {
    const result = await query(
      `SELECT 
         p.*,
         u.full_name AS creator_name,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted' AND match_type = 'invest') AS invest_count,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted' AND match_type = 'collab') AS collab_count,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS total_matches,
         (SELECT COUNT(*) FROM comments WHERE project_id = p.id) AS comment_count,
         (SELECT COUNT(*) FROM likes WHERE project_id = p.id) AS like_count
       FROM projects p
       JOIN users u ON p.creator_id = u.id
       WHERE p.creator_id = $1
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, projects: result.rows });
  } catch (error) {
    console.error('Get my projects error:', error);
    res.status(500).json({ success: false, message: 'Failed to load your projects.' });
  }
});

// ── GET /api/projects/:id/requests — pending requests for a project ──
router.get('/:id/requests', protect, async (req, res) => {
  try {
    const project = await query('SELECT creator_id FROM projects WHERE id = $1', [req.params.id]);
    if (!project.rows.length) return res.status(404).json({ success: false, message: 'Project not found.' });
    if (project.rows[0].creator_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });

    const result = await query(
      `SELECT m.id, m.match_type, m.status, m.created_at,
              u.full_name AS requester_name, u.id AS requester_id, u.location AS requester_location
       FROM matches m
       JOIN users u ON m.discoverer_id = u.id
       WHERE m.project_id = $1 AND m.status = 'pending'
       ORDER BY m.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load requests.' });
  }
});

// ── GET /api/projects/:id/comments ──────────────
router.get('/:id/comments', async (req, res) => {
  try {
    const result = await query(
      `SELECT c.id, c.content, c.created_at, c.parent_id,
              u.full_name AS user_name, u.id AS user_id
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.project_id = $1
       ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, comments: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load comments.' });
  }
});

// ── POST /api/projects/:id/comments ─────────────
router.post('/:id/comments', protect, async (req, res) => {
  try {
    const { content, parent_id } = req.body;
    if (!content) return res.status(400).json({ success: false, message: 'Comment content required.' });
    const result = await query(
      `INSERT INTO comments (project_id, user_id, content, parent_id)
       VALUES ($1, $2, $3, $4) RETURNING id, content, created_at, parent_id`,
      [req.params.id, req.user.id, content, parent_id || null]
    );
    res.status(201).json({ success: true, comment: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to post comment.' });
  }
});

// ── POST /api/projects/:id/like — toggle like ───
router.post('/:id/like', protect, async (req, res) => {
  try {
    const existing = await query('SELECT id FROM likes WHERE project_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (existing.rows.length) {
      await query('DELETE FROM likes WHERE project_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      res.json({ success: true, liked: false });
    } else {
      await query('INSERT INTO likes (project_id, user_id) VALUES ($1, $2)', [req.params.id, req.user.id]);
      res.json({ success: true, liked: true });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to toggle like.' });
  }
});

// ── GET /api/projects/:id/likes — who liked ─────
router.get('/:id/likes', protect, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.location FROM likes l
       JOIN users u ON l.user_id = u.id
       WHERE l.project_id = $1 ORDER BY l.created_at DESC`,
      [req.params.id]
    );
    const myLike = await query('SELECT id FROM likes WHERE project_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true, likes: result.rows, liked: myLike.rows.length > 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get likes.' });
  }
});

// ── GET /api/projects/:id — single project ──────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, u.id AS creator_id, u.full_name AS creator_name,
              u.bio AS creator_bio, u.location AS creator_location,
              u.skills AS creator_skills, u.avatar_url AS creator_avatar,
              (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS match_count
       FROM projects p
       JOIN users u ON p.creator_id = u.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Project not found.' });
    res.json({ success: true, project: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load project.' });
  }
});

// ── POST /api/projects — create project ─────────
router.post('/', protect, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('mode').isIn(['collab','invest','both']).withMessage('Mode must be collab, invest, or both'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { title, description, category, tags, required_skills, mode, stage, investment_target, equity_offered, image_url, video_url } = req.body;

    const result = await query(
      `INSERT INTO projects (creator_id, title, description, category, tags, required_skills, mode, stage, investment_target, equity_offered, image_url, video_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.id, title, description, category, tags || [], required_skills || [], mode, stage || null, investment_target || null, equity_offered || null, image_url || null, video_url || null]
    );

    res.status(201).json({ success: true, message: 'Project posted!', project: result.rows[0] });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ success: false, message: 'Failed to create project.' });
  }
});

// ── PUT /api/projects/:id — update project ──────
router.put('/:id', protect, async (req, res) => {
  try {
    const existing = await query('SELECT id, creator_id FROM projects WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Project not found.' });
    if (existing.rows[0].creator_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });

    const { title, description, category, tags, required_skills, mode, stage, investment_target, equity_offered, is_active } = req.body;
    const result = await query(
      `UPDATE projects SET
         title = COALESCE($1, title), description = COALESCE($2, description),
         category = COALESCE($3, category), tags = COALESCE($4, tags),
         required_skills = COALESCE($5, required_skills), mode = COALESCE($6, mode),
         stage = COALESCE($7, stage), investment_target = COALESCE($8, investment_target),
         equity_offered = COALESCE($9, equity_offered), is_active = COALESCE($10, is_active)
       WHERE id = $11 RETURNING *`,
      [title, description, category, tags, required_skills, mode, stage, investment_target, equity_offered, is_active, req.params.id]
    );
    res.json({ success: true, message: 'Project updated!', project: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update project.' });
  }
});

// ── DELETE /api/projects/:id ────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const existing = await query('SELECT id, creator_id FROM projects WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Project not found.' });
    if (existing.rows[0].creator_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });
    await query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Project deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete project.' });
  }
});

// ── POST /api/projects/:id/view ─────────────────
router.post('/:id/view', async (req, res) => {
  try {
    await query('UPDATE projects SET views = views + 1 WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
