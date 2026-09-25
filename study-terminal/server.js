require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3:mini';
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'data', 'users.xlsx');
const LAN_UPLOAD_DIR = path.join(__dirname, 'data', 'lan-uploads');

// =====================================================================
// User store — currently a plain .xlsx file (no DB needed to run this).
// Swap this whole block for Supabase/Firebase later without touching
// any route below: they only call loadUsers/saveUsers/findUser.
// =====================================================================
const USER_HEADERS = ['id', 'username', 'passwordHash', 'createdAt'];

function ensureUsersFile() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([USER_HEADERS]);
    XLSX.utils.book_append_sheet(wb, ws, 'users');
    XLSX.writeFile(wb, USERS_FILE);
  }
}

function loadUsers() {
  ensureUsersFile();
  const wb = XLSX.readFile(USERS_FILE);
  const ws = wb.Sheets['users'];
  return XLSX.utils.sheet_to_json(ws);
}

function saveUsers(users) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(users, { header: USER_HEADERS });
  XLSX.utils.book_append_sheet(wb, ws, 'users');
  XLSX.writeFile(wb, USERS_FILE);
}

function findUser(username) {
  return loadUsers().find(
    (u) => (u.username || '').toLowerCase() === username.toLowerCase()
  );
}

// =====================================================================
// Auth
// =====================================================================
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (String(username).length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const users = loadUsers();
  if (users.find((u) => (u.username || '').toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  saveUsers(users);
  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, {
    expiresIn: '7d',
  });
  res.json({ token, username: newUser.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = findUser(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '7d',
  });
  res.json({ token, username: user.username });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ username: req.user.username, guest: !!req.user.guest });
});

// Guest mode: no username/password, nothing is written to users.xlsx.
// The token is short-lived and the frontend keeps it in sessionStorage
// only, so it (and every chat/quiz/flashcard made with it) disappears
// the moment the tab is closed.
app.post('/api/guest', (req, res) => {
  const guestId = 'guest_' + Math.random().toString(36).slice(2, 8);
  const token = jwt.sign({ id: guestId, username: guestId, guest: true }, JWT_SECRET, {
    expiresIn: '6h',
  });
  res.json({ token, username: guestId, guest: true });
});

// =====================================================================
// AI — local, free, open-source models via Ollama. Runs fully offline
// once a model is pulled (see README / install.sh).
// =====================================================================
async function askOllama(prompt, system) {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, system, stream: false }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.response || '';
}

function stripJsonFence(text) {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

app.post('/api/chat', authenticate, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Message required' });
  const historyText = Array.isArray(history)
    ? history
        .slice(-10)
        .map((h) => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.content}`)
        .join('\n')
    : '';
  const prompt = `${historyText}\nStudent: ${message}\nTutor:`;
  const system =
    'You are a patient, encouraging study tutor helping a student prepare for an exam. ' +
    'Explain clearly with short examples, check understanding, and keep answers focused. ' +
    'Avoid unnecessary length.';
  try {
    const reply = await askOllama(prompt, system);
    res.json({ reply: reply.trim() });
  } catch (err) {
    res
      .status(502)
      .json({ error: `AI model unavailable — is Ollama running? (${err.message})` });
  }
});

app.post('/api/quiz', authenticate, async (req, res) => {
  const { topic, count } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  const n = Math.min(Math.max(parseInt(count, 10) || 5, 1), 15);
  const system =
    'You generate exam-style multiple choice quizzes. Respond ONLY with valid JSON, ' +
    'no markdown, no extra text, in exactly this shape: ' +
    '{"questions":[{"question":"...","options":["A","B","C","D"],"answerIndex":0,"explanation":"..."}]}';
  const prompt = `Create a ${n}-question multiple choice quiz about: ${topic}`;
  try {
    const raw = await askOllama(prompt, system);
    const parsed = JSON.parse(stripJsonFence(raw));
    res.json(parsed);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Could not generate quiz — is Ollama running? (${err.message})` });
  }
});

app.post('/api/flashcards', authenticate, async (req, res) => {
  const { topic, count } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  const n = Math.min(Math.max(parseInt(count, 10) || 8, 1), 20);
  const system =
    'You generate exam flashcards. Respond ONLY with valid JSON, no markdown, no extra text, ' +
    'in exactly this shape: {"cards":[{"front":"...","back":"..."}]}';
  const prompt = `Create ${n} flashcards (term or question on the front, a concise answer on the back) about: ${topic}`;
  try {
    const raw = await askOllama(prompt, system);
    const parsed = JSON.parse(stripJsonFence(raw));
    res.json(parsed);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Could not generate flashcards — is Ollama running? (${err.message})` });
  }
});

// =====================================================================
// LAN chat & file sharing — a shared room for everyone on the same
// network as this server (e.g. a study group in a library). No
// WebSockets or WebRTC: the frontend just polls this plain HTTP API
// every couple of seconds, which is all a LAN needs. Messages and
// files live only in this server's memory/disk and reset when the
// server restarts — there's no cloud component at all.
// =====================================================================
if (!fs.existsSync(LAN_UPLOAD_DIR)) fs.mkdirSync(LAN_UPLOAD_DIR, { recursive: true });
app.use('/lan-uploads', express.static(LAN_UPLOAD_DIR));

const MAX_LAN_MESSAGES = 300;
let lanMessages = [];
let lanNextId = 1;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, LAN_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9_.\-]/g, '_');
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

function pushLanMessage(msg) {
  const full = { id: lanNextId++, ts: new Date().toISOString(), ...msg };
  lanMessages.push(full);
  if (lanMessages.length > MAX_LAN_MESSAGES) lanMessages.shift();
  return full;
}

app.get('/api/lan/messages', authenticate, (req, res) => {
  const after = parseInt(req.query.after, 10) || 0;
  res.json({ messages: lanMessages.filter((m) => m.id > after) });
});

app.post('/api/lan/messages', authenticate, (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message text required' });
  const msg = pushLanMessage({ type: 'text', sender: req.user.username, text: text.trim() });
  res.json({ message: msg });
});

app.post('/api/lan/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const isImage = /^image\//.test(req.file.mimetype);
  const msg = pushLanMessage({
    type: isImage ? 'image' : 'file',
    sender: req.user.username,
    filename: req.file.originalname,
    url: `/lan-uploads/${req.file.filename}`,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
  res.json({ message: msg });
});

// =====================================================================
// Study guide generator — defaults to the local, free Ollama model,
// but you can point it at any provider by supplying an API key from
// the frontend for that one request. Keys are never stored server-side;
// the frontend keeps them (if at all) in the browser's own localStorage.
// =====================================================================
async function callAnthropic({ apiKey, model, system, prompt }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return (data.content || []).map((b) => b.text || '').join('\n');
}

async function callOpenAICompatible({ baseUrl, apiKey, model, system, prompt, extraHeaders }) {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(extraHeaders || {}),
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

app.post('/api/generate-guide', authenticate, async (req, res) => {
  const { topic, notes, provider, apiKey, model } = req.body || {};
  if (!topic && !notes) return res.status(400).json({ error: 'A topic or some notes are required' });
  const system =
    'You are an expert study-guide writer. Produce a clear, well-organized study guide using ' +
    'markdown headings (#, ##), bullet points, bolded key terms, and a short list of likely exam ' +
    'questions at the end. Be thorough but avoid padding.';
  const prompt = `Topic: ${topic || '(see notes)'}\n\nNotes provided by the student:\n${notes || '(none)'}\n\nWrite the study guide.`;

  try {
    let text;
    switch (provider) {
      case 'anthropic':
        if (!apiKey) return res.status(400).json({ error: 'Anthropic API key required' });
        text = await callAnthropic({ apiKey, model, system, prompt });
        break;
      case 'openai':
        if (!apiKey) return res.status(400).json({ error: 'OpenAI API key required' });
        text = await callOpenAICompatible({
          baseUrl: 'https://api.openai.com/v1',
          apiKey,
          model,
          system,
          prompt,
        });
        break;
      case 'openrouter':
        if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key required' });
        text = await callOpenAICompatible({
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey,
          model: model || 'openrouter/auto',
          system,
          prompt,
          extraHeaders: { 'HTTP-Referer': 'https://study-terminal.local', 'X-Title': 'Study Terminal' },
        });
        break;
      case 'ollama':
      default:
        text = await askOllama(prompt, system);
        break;
    }
    res.json({ guide: (text || '').trim() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`> study-terminal listening on http://localhost:${PORT}`);
  console.log(`> model: ${OLLAMA_MODEL} via ${OLLAMA_URL}`);
});
