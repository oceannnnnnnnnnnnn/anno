// routes/upload.js
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const s3 = require('../r2'); // R2 config (AWS SDK)
const router = express.Router();

// ✅ Multer for in-memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // Max 5MB
});

// ✅ Supabase client for DM thread validation
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('routes/upload: Missing SUPABASE env vars');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ✅ PUBLIC URL for R2
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-75d44103a8864609a30fee8316761d52.r2.dev';

// -------------------
// POST /media/upload
// multipart/form-data: file, scope=public|dm, dmKey (if scope=dm)
// -------------------
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const scope = req.body.scope || 'public';
    const dmKey = req.body.dmKey;

    const clientIp =
  req.headers['x-forwarded-for']?.split(',')[0].trim() ||
  req.socket.remoteAddress;

console.log(`[UPLOAD] IP: ${clientIp}, Username: ${req.body.username || 'Unknown'}, File: ${req.file.originalname}`);


    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // ✅ Sanitize filename
    const safeName = file.originalname.replace(/\s+/g, '_');
    const prefix = (scope === 'dm' && dmKey) ? `dm/${dmKey}` : 'public';
    const key = `${prefix}/${Date.now()}-${safeName.replace(/\.[^/.]+$/, '')}.jpg`; // Force .jpg

    // ✅ Resize and compress image (max 720px, JPEG)
    const compressedBuffer = await sharp(file.buffer)
      .resize({ width: 720, height: 720, fit: 'inside' }) // max 720px
      .jpeg({ quality: 80 }) // compress
      .toBuffer();

    // ✅ Upload to R2
    await s3.upload({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: compressedBuffer,
      ContentType: 'image/jpeg'
    }).promise();

    // ✅ Construct response URL
    if (scope === 'public') {
      const publicUrl = `${R2_PUBLIC_URL}/${key}`;
      return res.json({ key, url: publicUrl });
    } else {
      // DM file (private): return key only
      return res.json({ key });
    }
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'upload_failed' });
  }
});

// -------------------
// GET /media/signed-url?key=...
// Header: X-Client-Id required for DM keys
// -------------------
router.get('/signed-url', async (req, res) => {
  try {
    const { key } = req.query;
    const clientId = req.headers['x-client-id'];

    if (!key) return res.status(400).json({ error: 'Missing key' });

    const parts = key.split('/');
    if (parts[0] === 'dm') {
      const threadKey = parts[1]; // dm/{threadKey}/file.jpg
      if (!clientId) return res.status(403).json({ error: 'Missing client ID' });

      // ✅ Check DM access in Supabase
      const { data: thread, error } = await supabase
        .from('dm_threads')
        .select('user_a, user_b')
        .eq('dm_key', threadKey)
        .maybeSingle();

      if (error || !thread) return res.status(403).json({ error: 'Thread not found' });
      if (thread.user_a !== clientId && thread.user_b !== clientId) {
        return res.status(403).json({ error: 'Not a participant' });
      }
    }

    // ✅ Generate signed URL
    const url = s3.getSignedUrl('getObject', {
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Expires: 60 * 5 // 5 mins
    });

    return res.json({ url });
  } catch (err) {
    console.error('Signed URL error:', err);
    return res.status(500).json({ error: 'signed_url_failed' });
  }
});

module.exports = router;
