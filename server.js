// WE-NEED-U API Server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
const { protect } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────
app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── CLOUDINARY UPLOAD ─────────────────────────
async function uploadToCloudinary(base64Data, resourceType = 'video') {
  return new Promise((resolve, reject) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      reject(new Error('Cloudinary not configured'));
      return;
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'we-need-u';
    const eager = 'f_mp4,q_auto';
    const paramsToSign = `eager=${eager}&folder=${folder}&timestamp=${timestamp}`;
    const signature = crypto.createHash('sha1').update(paramsToSign + apiSecret).digest('hex');

    const boundary = '----FormBoundary' + Math.random().toString(36);
    const body = [
      `--${boundary}`, 'Content-Disposition: form-data; name="file"', '', base64Data,
      `--${boundary}`, 'Content-Disposition: form-data; name="api_key"', '', apiKey,
      `--${boundary}`, 'Content-Disposition: form-data; name="timestamp"', '', timestamp.toString(),
      `--${boundary}`, 'Content-Disposition: form-data; name="signature"', '', signature,
      `--${boundary}`, 'Content-Disposition: form-data; name="folder"', '', folder,
      `--${boundary}`, 'Content-Disposition: form-data; name="eager"', '', eager,
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
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// ── HEALTH CHECK ──────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'WE-NEED-U API is running!', version: '3.0.0' });
});

// ── VIDEO UPLOAD ROUTE ────────────────────────
app.post('/api/upload', protect, async (req, res) => {
  try {
    const { data, type } = req.body;
    if (!data) return res.status(400).json({ success: false, message: 'No file data provided.' });
    const resourceType = (type || '').startsWith('video') ? 'video' : 'image';
    const url = await uploadToCloudinary(data, resourceType);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Upload failed: ' + error.message });
  }
});

// ── ROUTES ────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/matches',  require('./routes/matches'));
app.use('/api/messages', require('./routes/messages'));

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
