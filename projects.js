// ─────────────────────────────────────────────
// WorkMatch — Projects Routes
// GET    /api/projects          — get feed (with filters)
// POST   /api/projects          — create new project
// GET    /api/projects/:id      — get single project
// PUT    /api/projects/:id      — update project
// DELETE /api/projects/:id      — delete project
// GET    /api/projects/mine     — get my projects
// POST   /api/projects/:id/view — increment view count
// ─────────────────────────────────────────────

const express = require('express');
const { body, query: queryValidator, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { protect, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/projects — scrollable feed ────────
// Supports: ?category=tech&mode=collab&page=1&limit=10
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      category,
      mode,
      page     = 1,
      limit    = 10,
      search,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = ['p.is_active = true'];

    // Filter by category
    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`LOWER(p.category) = LOWER($${params.length})`);
    }

    // Filter by mode (collab / invest / both)
    if (mode && mode !== 'all') {
      params.push(mode);
      conditions.push(`(p.mode = $${params.length} OR p.mode = 'both')`);
    }

    // Search by title or description
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }

    // Exclude projects already swiped by this user
    if (req.user) {
      params.push(req.user.id);
      conditions.push(`p.id NOT IN (
        SELECT project_id FROM swipes WHERE swiper_id = $${params.length}
      )`);
      // Also exclude the user's own projects
      conditions.push(`p.creator_id != $${params.length}`);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Get total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) FROM projects p ${whereClause}`,
      params
    );

    // Get projects with creator info
    params.push(parseInt(limit));
    params.push(offset);

    const result = await query(
      `SELECT 
         p.id, p.title, p.description, p.category, p.tags,
         p.required_skills, p.mode, p.stage,
         p.investment_target, p.equity_offered,
         p.image_url, p.video_url, p.views,
         p.created_at,
         u.id        AS creator_id,
         u.full_name AS creator_name,
         u.bio       AS creator_bio,
         u.location  AS creator_location,
         u.skills    AS creator_skills,
         u.avatar_url AS creator_avatar,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS match_count
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
        total,
        page:        parseInt(page),
        limit:       parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit)),
        has_more:    offset + result.rows.length < total,
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
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'pending' AND match_type = 'collab') AS pending_collab,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'pending' AND match_type = 'invest') AS pending_invest,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS total_matches
       FROM projects p
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

// ── GET /api/projects/:id — single project ──────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT 
         p.*, 
         u.id AS creator_id, u.full_name AS creator_name,
         u.bio AS creator_bio, u.location AS creator_location,
         u.skills AS creator_skills, u.avatar_url AS creator_avatar,
         (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS match_count
       FROM projects p
       JOIN users u ON p.creator_id = u.id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    res.json({ success: true, project: result.rows[0] });

  } catch (error) {
    console.error('Get project error:', error);
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
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const {
      title, description, category, tags, required_skills,
      mode, stage, investment_target, equity_offered,
      image_url, video_url
    } = req.body;

    const result = await query(
      `INSERT INTO projects (
         creator_id, title, description, category, tags, required_skills,
         mode, stage, investment_target, equity_offered, image_url, video_url
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.user.id, title, description, category,
        tags || [], required_skills || [],
        mode, stage || null,
        investment_target || null, equity_offered || null,
        image_url || null, video_url || null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Project posted! People can now discover it.',
      project: result.rows[0]
    });

  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ success: false, message: 'Failed to create project.' });
  }
});

// ── PUT /api/projects/:id — update project ──────
router.put('/:id', protect, async (req, res) => {
  try {
    // Make sure the user owns this project
    const existing = await query(
      'SELECT id, creator_id FROM projects WHERE id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    if (existing.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this project.' });
    }

    const {
      title, description, category, tags, required_skills,
      mode, stage, investment_target, equity_offered, is_active
    } = req.body;

    const result = await query(
      `UPDATE projects SET
         title              = COALESCE($1, title),
         description        = COALESCE($2, description),
         category           = COALESCE($3, category),
         tags               = COALESCE($4, tags),
         required_skills    = COALESCE($5, required_skills),
         mode               = COALESCE($6, mode),
         stage              = COALESCE($7, stage),
         investment_target  = COALESCE($8, investment_target),
         equity_offered     = COALESCE($9, equity_offered),
         is_active          = COALESCE($10, is_active)
       WHERE id = $11
       RETURNING *`,
      [title, description, category, tags, required_skills,
       mode, stage, investment_target, equity_offered, is_active, req.params.id]
    );

    res.json({ success: true, message: 'Project updated!', project: result.rows[0] });

  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ success: false, message: 'Failed to update project.' });
  }
});

// ── DELETE /api/projects/:id ────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const existing = await query(
      'SELECT id, creator_id FROM projects WHERE id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    if (existing.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this project.' });
    }

    await query('DELETE FROM projects WHERE id = $1', [req.params.id]);

    res.json({ success: true, message: 'Project deleted.' });

  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete project.' });
  }
});

// ── POST /api/projects/:id/view — increment views ──
router.post('/:id/view', async (req, res) => {
  try {
    await query('UPDATE projects SET views = views + 1 WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
