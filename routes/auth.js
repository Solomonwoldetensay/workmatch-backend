// ─────────────────────────────────────────────
// WE-NEED-U — Authentication Routes
// POST /api/auth/signup   — email signup
// POST /api/auth/login    — email login
// POST /api/auth/google   — Google Sign In ← NEW
// GET  /api/auth/me       — get current user
// PUT  /api/auth/profile  — update profile + avatar
// ─────────────────────────────────────────────

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const https    = require('https');
const crypto   = require('crypto');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { protect } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
};

// ── Cloudinary upload helper (unchanged) ──────
async function uploadToCloudinary(base64Data, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey     = process.env.CLOUDINARY_API_KEY;
    const apiSecret  = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) { reject(new Error('Cloudinary not configured')); return; }
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'we-need-u';
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto.createHash('sha1').update(paramsToSign + apiSecret).digest('hex');
    const boundary = '----FormBoundary' + Math.random().toString(36);
    const body = [
      `--${boundary}`, 'Content-Disposition: form-data; name="file"', '', base64Data,
      `--${boundary}`, 'Content-Disposition: form-data; name="api_key"', '', apiKey,
      `--${boundary}`, 'Content-Disposition: form-data; name="timestamp"', '', timestamp.toString(),
      `--${boundary}`, 'Content-Disposition: form-data; name="signature"', '', signature,
      `--${boundary}`, 'Content-Disposition: form-data; name="folder"', '', folder,
      `--${boundary}--`,
    ].join('\r\n');
    const bodyBuffer = Buffer.from(body, 'utf8');
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/${resourceType}/upload`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': bodyBuffer.length },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.secure_url) resolve(parsed.secure_url);
          else reject(new Error(parsed.error?.message || 'Upload failed'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// ══════════════════════════════════════════════
// POST /api/auth/google  ← NEW
// ══════════════════════════════════════════════
router.post('/google', async (req, res) => {
  try {
    const { id_token } = req.body;
    if (!id_token) return res.status(400).json({ success: false, message: 'Google ID token is required.' });

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({ idToken: id_token, audience: process.env.GOOGLE_CLIENT_ID });
    } catch (err) {
      console.error('Google token verification failed:', err.message);
      return res.status(401).json({ success: false, message: 'Invalid Google token. Please try again.' });
    }

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;
    if (!email) return res.status(400).json({ success: false, message: 'Google account must have an email address.' });

    // Check if user already exists
    let result = await query(
      'SELECT id, email, password_hash, full_name, bio, location, skills, avatar_url, role FROM users WHERE email = $1',
      [email]
    );

    let user;
    let isNewUser = false;

    if (result.rows.length > 0) {
      user = result.rows[0];
      // Update avatar if they don't have one yet
      if (!user.avatar_url && picture) {
        await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [picture, user.id]);
        user.avatar_url = picture;
      }
    } else {
      // New user — password_hash is NOT NULL in your DB so store an unusable random hash
      isNewUser = true;
      const unusableHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      result = await query(
        `INSERT INTO users (email, password_hash, full_name, avatar_url, location, skills)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, full_name, bio, location, skills, avatar_url, role`,
        [email, unusableHash, name || email.split('@')[0], picture || null, null, []]
      );
      user = result.rows[0];
    }

    const token = generateToken(user.id);
    const { password_hash, ...safeUser } = user;
    res.status(isNewUser ? 201 : 200).json({ success: true, is_new_user: isNewUser, message: isNewUser ? 'Account created with Google!' : 'Welcome back!', token, user: safeUser });

  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ success: false, message: 'Google sign in failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════
// POST /api/auth/signup  (unchanged)
// ══════════════════════════════════════════════
router.post('/signup', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    const { email, password, full_name, location, skills } = req.body;
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    const password_hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, location, skills)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, location, skills, created_at`,
      [email, password_hash, full_name, location || null, skills || []]
    );
    const user = result.rows[0];
    const token = generateToken(user.id);
    res.status(201).json({ success: true, message: 'Account created!', token, user });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Failed to create account.' });
  }
});

// ══════════════════════════════════════════════
// POST /api/auth/login  (unchanged)
// ══════════════════════════════════════════════
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Valid email and password required.' });
    const { email, password } = req.body;
    const result = await query(
      'SELECT id, email, password_hash, full_name, bio, location, skills, avatar_url, role FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    const token = generateToken(user.id);
    const { password_hash, ...safeUser } = user;
    res.json({ success: true, message: 'Logged in!', token, user: safeUser });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed.' });
  }
});

// ══════════════════════════════════════════════
// GET /api/auth/me  (unchanged)
// ══════════════════════════════════════════════
router.get('/me', protect, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, bio, location, skills, avatar_url, investor_profile, is_verified, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });
    const stats = await query(
      `SELECT 
         (SELECT COUNT(*) FROM projects WHERE creator_id = $1 AND is_active = true) AS project_count,
         (SELECT COUNT(*) FROM matches WHERE (creator_id = $1 OR discoverer_id = $1) AND status = 'accepted') AS match_count`,
      [req.user.id]
    );
    res.json({ success: true, user: { ...result.rows[0], stats: { projects: parseInt(stats.rows[0].project_count), matches: parseInt(stats.rows[0].match_count) } } });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user data.' });
  }
});

// ══════════════════════════════════════════════
// PUT /api/auth/profile  (unchanged)
// ══════════════════════════════════════════════
router.put('/profile', protect, async (req, res) => {
  try {
    const { full_name, bio, location, skills, investor_profile, avatar_base64 } = req.body;
    let avatar_url = null;
    if (avatar_base64) avatar_url = await uploadToCloudinary(avatar_base64, 'image');
    const result = await query(
      `UPDATE users SET
         full_name        = COALESCE($1, full_name),
         bio              = COALESCE($2, bio),
         location         = COALESCE($3, location),
         skills           = COALESCE($4, skills),
         investor_profile = COALESCE($5, investor_profile),
         avatar_url       = COALESCE($6, avatar_url)
       WHERE id = $7
       RETURNING id, email, full_name, bio, location, skills, avatar_url, investor_profile`,
      [full_name || null, bio || null, location || null, skills || null, investor_profile || null, avatar_url, req.user.id]
    );
    res.json({ success: true, message: 'Profile updated!', user: result.rows[0] });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

module.exports = router;
