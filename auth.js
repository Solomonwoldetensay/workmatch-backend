// ─────────────────────────────────────────────
// WorkMatch — Authentication Routes
// POST /api/auth/signup  — create new account
// POST /api/auth/login   — login and get token
// GET  /api/auth/me      — get current user
// PUT  /api/auth/profile — update profile
// ─────────────────────────────────────────────

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── Helper: generate JWT token ────────────────
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// ── POST /api/auth/signup ─────────────────────
router.post('/signup', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
], async (req, res) => {
  try {
    // Validate inputs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password, full_name, location, skills } = req.body;

    // Check if email already registered
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }

    // Hash password (10 rounds = good balance of security and speed)
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, location, skills)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, location, skills, created_at`,
      [email, password_hash, full_name, location || null, skills || []]
    );

    const user = result.rows[0];
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: {
        id:         user.id,
        email:      user.email,
        full_name:  user.full_name,
        location:   user.location,
        skills:     user.skills,
        created_at: user.created_at,
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Failed to create account. Please try again.' });
  }
});

// ── POST /api/auth/login ──────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Valid email and password required.' });
    }

    const { email, password } = req.body;

    // Find user
    const result = await query(
      'SELECT id, email, password_hash, full_name, bio, location, skills, avatar_url, role FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }

    const user = result.rows[0];

    // Compare passwords
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Logged in successfully!',
      token,
      user: {
        id:         user.id,
        email:      user.email,
        full_name:  user.full_name,
        bio:        user.bio,
        location:   user.location,
        skills:     user.skills,
        avatar_url: user.avatar_url,
        role:       user.role,
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// ── GET /api/auth/me — get current user ────────
router.get('/me', protect, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, bio, location, skills, avatar_url, 
              investor_profile, is_verified, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Also get user's project count and match count
    const stats = await query(
      `SELECT 
         (SELECT COUNT(*) FROM projects WHERE creator_id = $1 AND is_active = true) AS project_count,
         (SELECT COUNT(*) FROM matches WHERE (creator_id = $1 OR discoverer_id = $1) AND status = 'accepted') AS match_count`,
      [req.user.id]
    );

    res.json({
      success: true,
      user: {
        ...result.rows[0],
        stats: {
          projects: parseInt(stats.rows[0].project_count),
          matches:  parseInt(stats.rows[0].match_count),
        }
      }
    });

  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user data.' });
  }
});

// ── PUT /api/auth/profile — update profile ─────
router.put('/profile', protect, [
  body('full_name').optional().trim().notEmpty(),
  body('bio').optional().trim(),
  body('location').optional().trim(),
  body('skills').optional().isArray(),
], async (req, res) => {
  try {
    const { full_name, bio, location, skills, investor_profile } = req.body;

    const result = await query(
      `UPDATE users
       SET full_name        = COALESCE($1, full_name),
           bio              = COALESCE($2, bio),
           location         = COALESCE($3, location),
           skills           = COALESCE($4, skills),
           investor_profile = COALESCE($5, investor_profile)
       WHERE id = $6
       RETURNING id, email, full_name, bio, location, skills, avatar_url, investor_profile`,
      [full_name, bio, location, skills, investor_profile, req.user.id]
    );

    res.json({
      success: true,
      message: 'Profile updated!',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

module.exports = router;
