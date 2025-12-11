// app.js (fixed & robust pdf-parse handling)
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

let pdfParse = null;
try {
  // require pdf-parse; some installs expose a function, some expose an object with .default
  const _pdf = require('pdf-parse');
  pdfParse = _pdf;
} catch (err) {
  console.warn('pdf-parse not found. PDF parsing will be disabled. Install with `npm install pdf-parse` if you need PDF support.');
  pdfParse = null;
}

const { extractAndRoute } = require('./extractor');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Parse raw text POST { text: "..." }
app.post('/api/parse-text', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing "text" in request body' });
    const result = extractAndRoute(text);
    return res.json(result);
  } catch (err) {
    console.error('Error in /api/parse-text:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Upload file (pdf or txt) under form field 'file'
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';

    if (ext === '.pdf') {
      if (!pdfParse) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        return res.status(500).json({ error: 'PDF parsing not available: install pdf-parse' });
      }

      const dataBuffer = fs.readFileSync(filePath);
      let parsed;
      try {
        if (typeof pdfParse === 'function') {
          parsed = await pdfParse(dataBuffer);
        } else if (pdfParse && typeof pdfParse.default === 'function') {
          parsed = await pdfParse.default(dataBuffer);
        } else {
          throw new Error('pdf-parse export is not callable');
        }
      } catch (err) {
        console.error('Error parsing PDF:', err);
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        return res.status(500).json({ error: 'PDF parsing failed: ' + (err.message || err) });
      }
      text = parsed && parsed.text ? parsed.text : '';
    } else {
      // assume plain text file
      text = fs.readFileSync(filePath, 'utf8');
    }

    const result = extractAndRoute(text);

    // cleanup uploaded file
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
    return res.json(result);
  } catch (err) {
    console.error('Error in /api/upload:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`FNOL Agent backend listening on ${PORT}`));
