// WE-NEED-U API Server — With Cloudinary Video Upload
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const https = require('https');
const crypto = require('crypto');
 
const app = express();
const PORT = process.env.PORT || 3000;
 
// ── DATABASE ──────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
 
const db = async (text, params) => {
  const result = await pool.query(text, params);
  return result;
};
 
// ── MIDDLEWARE ────────────────────────────────
app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
 
// ── AUTH HELPER ───────────────────────────────
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET || 'we-need-u_secret_2026', { expiresIn: '7d' });
};
 
const protect = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'we-need-u_secret_2026');
    const result = await db('SELECT id, email, full_name, role FROM users WHERE id = $1', [decoded.id]);
    if (!result.rows.length) return res.status(401).json({ success: false, message: 'User not found.' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};
 
const optionalAuth = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'we-need-u_secret_2026');
      const result = await db('SELECT id, email, full_name FROM users WHERE id = $1', [decoded.id]);
      if (result.rows.length) req.user = result.rows[0];
    }
  } catch (e) {}
  next();
};
 
// ── CLOUDINARY UPLOAD ─────────────────────────
async function uploadToCloudinary(base64Data, resourceType = 'video') {
  return new Promise((resolve, reject) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
 
    if (!cloudName || !apiKey || !apiSecret) {
      reject(new Error('Cloudinary not configured'));
      return;
    }
 
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'we-need-u';
    const eager = 'f_mp4,q_auto';
    const paramsToSign = `eager=${eager}&folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash('sha1')
      .update(paramsToSign + apiSecret)
      .digest('hex');
 
    const boundary = '----FormBoundary' + Math.random().toString(36);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"',
      '',
      base64Data,
      `--${boundary}`,
      'Content-Disposition: form-data; name="api_key"',
      '',
      apiKey,
      `--${boundary}`,
      'Content-Disposition: form-data; name="timestamp"',
      '',
      timestamp.toString(),
      `--${boundary}`,
      'Content-Disposition: form-data; name="signature"',
      '',
      signature,
      `--${boundary}`,
      'Content-Disposition: form-data; name="folder"',
      '',
      folder,
      `--${boundary}`,
      'Content-Disposition: form-data; name="eager"',
      '',
      eager,
      `--${boundary}--`,
    ].join('\r\n');
 
    const bodyBuffer = Buffer.from(body, 'utf8');
 
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/${resourceType}/upload`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length,
      },
    };
 
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.eager && parsed.eager[0] && parsed.eager[0].secure_url) {
            resolve(parsed.eager[0].secure_url);
          } else if (parsed.secure_url) {
            resolve(parsed.secure_url);
          } else {
            reject(new Error(parsed.error?.message || 'Upload failed'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
 
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}
 
// ── HEALTH CHECK ──────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'WE-NEED-U API is running!', version: '2.0.0' });
});
 
// ── VIDEO UPLOAD ROUTE ────────────────────────
app.post('/api/upload', protect, async (req, res) => {
  try {
    const { data, type } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'No file data provided.' });
    }
    const resourceType = (type || '').startsWith('video') ? 'video' : 'image';
    const url = await uploadToCloudinary(data, resourceType);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Upload failed: ' + error.message });
  }
});
 
// ── AUTH ROUTES ───────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, full_name, location } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'Email, password, and name are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    const existing = await db('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await db(
      `INSERT INTO users (email, password_hash, full_name, location)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, location, created_at`,
      [email.toLowerCase(), password_hash, full_name, location || null]
    );
    const user = result.rows[0];
    const token = generateToken(user.id);
    res.status(201).json({ success: true, message: 'Account created!', token, user });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Failed to create account.' });
  }
});
 
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required.' });
    }
    const result = await db(
      'SELECT id, email, password_hash, full_name, bio, location, avatar_url, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
    }
    const token = generateToken(user.id);
    const { password_hash, ...safeUser } = user;
    res.json({ success: true, message: 'Logged in!', token, user: safeUser });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed.' });
  }
});
 
app.get('/api/auth/me', protect, async (req, res) => {
  try {
    const result = await db(
      'SELECT id, email, full_name, bio, location, skills, avatar_url, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const stats = await db(
      `SELECT 
         (SELECT COUNT(*) FROM projects WHERE creator_id = $1 AND is_active = true) AS projects,
         (SELECT COUNT(*) FROM matches WHERE (creator_id = $1 OR discoverer_id = $1) AND status = 'accepted') AS matches`,
      [req.user.id]
    );
    res.json({
      success: true,
      user: {
        ...result.rows[0],
        stats: {
          projects: parseInt(stats.rows[0].projects),
          matches: parseInt(stats.rows[0].matches)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get user.' });
  }
});
 
// ── PROJECTS ROUTES ───────────────────────────
app.get('/api/projects', optionalAuth, async (req, res) => {
  try {
    const { category, mode, page = 1, limit = 20, search } = req.query;
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
      conditions.push(`p.creator_id != $${params.length}`);
      conditions.push(`p.id NOT IN (SELECT project_id FROM swipes WHERE swiper_id = $${params.length})`);
    }
 
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit));
    params.push(offset);
 
    const result = await db(
      `SELECT p.id, p.title, p.description, p.category, p.tags, p.mode, p.stage,
              p.investment_target, p.equity_offered, p.views, p.video_url, p.image_url, p.created_at,
              u.id AS creator_id, u.full_name AS creator_name,
              u.location AS creator_location, u.avatar_url AS creator_avatar,
              (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS match_count
       FROM projects p
       JOIN users u ON p.creator_id = u.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
 
    res.json({ success: true, projects: result.rows });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ success: false, message: 'Failed to load projects.' });
  }
});
 
app.get('/api/projects/mine', protect, async (req, res) => {
  try {
    const result = await db(
      `SELECT p.*,
              (SELECT COUNT(*) FROM matches WHERE project_id = p.id AND status = 'accepted') AS total_matches
       FROM projects p WHERE p.creator_id = $1 ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, projects: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load your projects.' });
  }
});
 
app.post('/api/projects', protect, async (req, res) => {
  try {
    const { title, description, category, tags, mode, stage, investment_target, equity_offered, video_url, image_url } = req.body;
    if (!title || !description || !category || !mode) {
      return res.status(400).json({ success: false, message: 'Title, description, category, and mode are required.' });
    }
    const result = await db(
      `INSERT INTO projects (creator_id, title, description, category, tags, mode, stage, investment_target, equity_offered, video_url, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, title, description, category, tags || [], mode, stage || null, investment_target || null, equity_offered || null, video_url || null, image_url || null]
    );
    res.status(201).json({ success: true, message: 'Project posted!', project: result.rows[0] });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ success: false, message: 'Failed to create project.' });
  }
});
 
app.post('/api/projects/:id/view', async (req, res) => {
  try {
    await db('UPDATE projects SET views = views + 1 WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false });
  }
});
 
// ── MATCHES ROUTES ────────────────────────────
app.post('/api/matches/swipe', optionalAuth, async (req, res) => {
  try {
    const { project_id, action } = req.body;
    if (!project_id || !action) {
      return res.status(400).json({ success: false, message: 'project_id and action required.' });
    }
    if (!req.user) {
      return res.json({ success: true, message: 'Swipe recorded (guest).' });
    }
    await db(
      `INSERT INTO swipes (swiper_id, project_id, action) VALUES ($1, $2, $3)
       ON CONFLICT (swiper_id, project_id, action) DO NOTHING`,
      [req.user.id, project_id, action]
    ).catch(() => {});
 
    if (action === 'skip') {
      return res.json({ success: true, message: 'Skipped.' });
    }
 
    const project = await db('SELECT creator_id, title FROM projects WHERE id = $1', [project_id]);
    if (!project.rows.length) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
 
    const match_type = action === 'invest' ? 'invest' : 'collab';
    const matchResult = await db(
      `INSERT INTO matches (project_id, creator_id, discoverer_id, match_type, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (project_id, discoverer_id, match_type) DO NOTHING
       RETURNING id`,
      [project_id, project.rows[0].creator_id, req.user.id, match_type]
    );
 
    if (matchResult.rows.length > 0) {
      await db(`UPDATE matches SET status = 'accepted' WHERE id = $1`, [matchResult.rows[0].id]);
      await db(
        `INSERT INTO conversations (match_id, user1_id, user2_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [matchResult.rows[0].id, project.rows[0].creator_id, req.user.id]
      );
    }
 
    res.json({
      success: true,
      message: action === 'invest' ? 'Investment interest sent!' : 'Collaboration request sent!',
      matched: matchResult.rows.length > 0
    });
  } catch (error) {
    console.error('Swipe error:', error);
    res.status(500).json({ success: false, message: 'Failed to process swipe.' });
  }
});
 
app.get('/api/matches/my-matches', protect, async (req, res) => {
  try {
    const result = await db(
      `SELECT m.id, m.match_type, m.status, m.created_at,
              p.title AS project_title, p.id AS project_id,
              c.id AS conversation_id,
              CASE WHEN m.creator_id = $1 THEN u2.full_name ELSE u1.full_name END AS other_user_name,
              CASE WHEN m.creator_id = $1 THEN m.discoverer_id ELSE m.creator_id END AS other_user_id,
              conv.last_message
       FROM matches m
       JOIN projects p ON m.project_id = p.id
       JOIN users u1 ON m.creator_id = u1.id
       JOIN users u2 ON m.discoverer_id = u2.id
       LEFT JOIN conversations conv ON conv.match_id = m.id
       LEFT JOIN conversations c ON c.match_id = m.id
       WHERE (m.creator_id = $1 OR m.discoverer_id = $1) AND m.status = 'accepted'
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, matches: result.rows });
  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ success: false, message: 'Failed to load matches.' });
  }
});
 
// ── MESSAGES ROUTES ───────────────────────────
app.get('/api/messages/:conversation_id', protect, async (req, res) => {
  try {
    const result = await db(
      `SELECT m.*, u.full_name AS sender_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.conversation_id]
    );
    res.json({ success: true, messages: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load messages.' });
  }
});
 
app.post('/api/messages/:conversation_id', protect, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, message: 'Message content required.' });
    const result = await db(
      `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.conversation_id, req.user.id, content]
    );
    await db(
      `UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2`,
      [content.substring(0, 100), req.params.conversation_id]
    );
    res.status(201).json({ success: true, message: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});
 
app.put('/api/messages/:conversation_id/read', protect, async (req, res) => {
  try {
    await db(
      `UPDATE messages SET is_read = true WHERE conversation_id = $1 AND sender_id != $2`,
      [req.params.conversation_id, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});
 
// ── 404 ───────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});
 
// ── START ─────────────────────────────────────
app.listen(PORT, () => {
  console.log('========================================');
  console.log('  WE-NEED-U API — Video Upload Ready!');
  console.log(`  Port: ${PORT}`);
  console.log(`  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? 'Connected' : 'Not configured'}`);
  console.log('========================================');
});
 
module.exports = app;
 
