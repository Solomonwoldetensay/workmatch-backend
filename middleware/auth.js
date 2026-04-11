// ─────────────────────────────────────────────
// WorkMatch — Authentication Middleware
// Verifies JWT token on protected routes
// ─────────────────────────────────────────────
 
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
 
const protect = async (req, res, next) => {
  try {
    // Get token from Authorization header: "Bearer <token>"
    const authHeader = req.headers.authorization;
 
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. Please log in.'
      });
    }
 
    const token = authHeader.split(' ')[1];
 
    // Verify the token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: err.name === 'TokenExpiredError'
          ? 'Session expired. Please log in again.'
          : 'Invalid token. Please log in again.'
      });
    }
 
    // Check user still exists in database
    const result = await query(
      'SELECT id, email, full_name, role FROM users WHERE id = $1',
      [decoded.id]
    );
 
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists.'
      });
    }
 
    // Attach user to request object
    req.user = result.rows[0];
    next();
 
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, message: 'Server error during authentication.' });
  }
};
 
// Optional auth — attaches user if token exists, but doesn't block if missing
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query('SELECT id, email, full_name FROM users WHERE id = $1', [decoded.id]);
    req.user = result.rows[0] || null;
    next();
  } catch {
    req.user = null;
    next();
  }
};
 
module.exports = { protect, optionalAuth };
