// ─────────────────────────────────────────────
// WorkMatch — Main API Server
// Built with Node.js + Express + PostgreSQL
// ─────────────────────────────────────────────

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

// Import route files
const authRoutes     = require('./routes/auth');
const projectRoutes  = require('./routes/projects');
const matchRoutes    = require('./routes/matches');
const messageRoutes  = require('./routes/messages');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── SECURITY MIDDLEWARE ───────────────────────
// Helmet sets secure HTTP headers
app.use(helmet());

// CORS — allows your frontend to call this API
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:5500',   // VS Code Live Server
    'http://127.0.0.1:5500',
    'https://workmatch.netlify.app', // Your Netlify URL
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting — prevents abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      100,             // max 100 requests per window per IP
  message:  { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Stricter limit on auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // only 10 login/signup attempts per 15 min
  message: { success: false, message: 'Too many login attempts. Please wait 15 minutes.' },
});
app.use('/api/auth/login',  authLimiter);
app.use('/api/auth/signup', authLimiter);

// ── BODY PARSING ─────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── STATIC FILES (uploaded images) ───────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API ROUTES ────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/matches',  matchRoutes);
app.use('/api/messages', messageRoutes);

// ── HEALTH CHECK ─────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'WorkMatch API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── API DOCS (simple) ─────────────────────────
app.get('/api', (req, res) => {
  res.json({
    success: true,
    name: 'WorkMatch API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/signup':   'Create new account',
        'POST /api/auth/login':    'Login and get token',
        'GET  /api/auth/me':       'Get current user (auth required)',
        'PUT  /api/auth/profile':  'Update profile (auth required)',
      },
      projects: {
        'GET    /api/projects':          'Get project feed (supports ?category=&mode=&page=&search=)',
        'POST   /api/projects':          'Create new project (auth required)',
        'GET    /api/projects/mine':     'Get my projects (auth required)',
        'GET    /api/projects/:id':      'Get single project',
        'PUT    /api/projects/:id':      'Update project (auth required, owner only)',
        'DELETE /api/projects/:id':      'Delete project (auth required, owner only)',
        'POST   /api/projects/:id/view': 'Increment view count',
      },
      matches: {
        'POST /api/matches/swipe':           'Swipe on a project — body: { project_id, action, message? }',
        'GET  /api/matches/requests':        'Get incoming match requests (auth required)',
        'PUT  /api/matches/:id/accept':      'Accept a match request (auth required)',
        'PUT  /api/matches/:id/decline':     'Decline a match request (auth required)',
        'GET  /api/matches/my-matches':      'Get all accepted matches (auth required)',
      },
      messages: {
        'GET  /api/messages/conversations':         'Get all conversations (auth required)',
        'GET  /api/messages/:conversation_id':      'Get messages in a conversation (auth required)',
        'POST /api/messages/:conversation_id':      'Send a message (auth required)',
        'PUT  /api/messages/:conversation_id/read': 'Mark messages as read (auth required)',
      },
    }
  });
});

// ── 404 HANDLER ──────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`
  });
});

// ── GLOBAL ERROR HANDLER ─────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred.'
      : err.message,
  });
});

// ── START SERVER ─────────────────────────────
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  WorkMatch API Server');
  console.log('========================================');
  console.log(`  Status:      Running`);
  console.log(`  Port:        ${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  API Base:    http://localhost:${PORT}/api`);
  console.log(`  Docs:        http://localhost:${PORT}/api`);
  console.log(`  Health:      http://localhost:${PORT}/api/health`);
  console.log('========================================\n');
});

module.exports = app;
