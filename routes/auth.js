const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── SIGNUP ──────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { full_name, email, password, location } = req.body;
    if (!full_name || !email || !password) {
      return res.status(400).json({ message: 'Please fill in all fields.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password needs 6+ characters.' });
    }
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Account already exists with this email.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (full_name, email, password_hash, location) VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, location, avatar_url',
      [full_name, email.toLowerCase(), password_hash, location || '']
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ message: 'Signup failed. Please try again.' });
  }
});

// ── LOGIN ──────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Enter email and password.' });
    }
    const result = await query(
      'SELECT id, email, password_hash, full_name, bio, location, skills, avatar_url, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!result.rows.length) {
      return res.status(401).json({ message: 'No account found with this email.' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Wrong password. Try again.' });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    delete user.password_hash;
    res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// ── GET CURRENT USER ──────────────────────────
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token provided.' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      'SELECT id, full_name, email, location, bio, avatar_url, role FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'User not found.' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(401).json({ message: 'Invalid token.' });
  }
});

// ── UPDATE PROFILE ──────────────────────────
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token.' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { avatar_base64 } = req.body;
    if (avatar_base64) {
      const cloudinary = require('cloudinary').v2;
      const uploaded = await cloudinary.uploader.upload(avatar_base64, { folder: 'avatars' });
      await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [uploaded.secure_url, decoded.userId]);
      const result = await query('SELECT id, full_name, email, location, avatar_url FROM users WHERE id = $1', [decoded.userId]);
      return res.json({ user: result.rows[0] });
    }
    res.json({ message: 'Nothing to update.' });
  } catch (err) {
    console.error('Profile update error:', err.message);
    res.status(500).json({ message: 'Update failed.' });
  }
});

// ── GOOGLE SIGN IN ──────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { id_token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;
    let result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    let user;
    if (result.rows.length) {
      user = result.rows[0];
      if (picture && !user.avatar_url) {
        await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [picture, user.id]);
        user.avatar_url = picture;
      }
    } else {
      const insertResult = await query(
        'INSERT INTO users (full_name, email, avatar_url, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, email.toLowerCase(), picture, '']
      );
      user = insertResult.rows[0];
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    delete user.password_hash;
    res.json({ token, user });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(500).json({ message: 'Google sign in failed.' });
  }
});

module.exports = router;
