const path = require('path');
const fs = require('fs');
const http = require('http');

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { nanoid } = require('nanoid');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3030);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function sanitizeName(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'Неизвестный';
  const cut = raw.slice(0, 32);
  // очень простой фильтр по словам (не идеальный, но лучше чем ничего)
  const bad = /(\b(?:хуй|пизд|ёб|еба|бля|сука|мраз|гандон|шлюх)\b)/i;
  if (bad.test(cut)) return 'Пользователь';
  return cut;
}

function nowMs() {
  return Date.now();
}

// ====== In-memory state (MVP) ======
// кто сейчас удерживает канал
let channelBusy = null; // { userId, name, sinceMs }

// бан по userId
const bans = new Map(); // userId -> banUntilMs

// сообщения
const messages = new Map(); // messageId -> { speakerId, tsMs }

// жалобы
const complaints = new Map(); // messageId -> { firstTsMs, count, reporters:Set<string> }

function isBanned(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const until = bans.get(uid);
  if (!until) return false;
  if (until <= nowMs()) {
    bans.delete(uid);
    return false;
  }
  return true;
}

function banUser(userId, minutes) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  bans.set(uid, nowMs() + minutes * 60 * 1000);
}

function canTakeChannel(userId) {
  if (!channelBusy) return true;
  return String(channelBusy.userId) === String(userId);
}

// ====== Multer upload ======
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10) || '.webm';
    cb(null, `${Date.now()}-${nanoid(10)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// ====== Static hosting for demo client ======
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
}));
app.use('/', express.static(path.join(__dirname, 'public')));

// ====== HTTP upload endpoint (Multer) ======
app.post('/ptt/upload', upload.single('audio'), (req, res) => {
  const userId = String(req.body?.userId || '').trim() || 'anon';
  const name = sanitizeName(req.body?.name);

  if (isBanned(userId)) {
    return res.status(403).json({ error: 'banned' });
  }

  if (!canTakeChannel(userId)) {
    return res.status(409).json({ error: 'channel_busy', busy: channelBusy });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'no_file' });
  }

  const id = nanoid(12);
  const url = `/uploads/${req.file.filename}`;
  const mime = String(req.file.mimetype || 'audio/webm');

  messages.set(id, { speakerId: userId, tsMs: nowMs(), name });

  // release channel
  channelBusy = null;
  io.emit('ptt:free');

  const payload = {
    id,
    speakerId: userId,
    speakerName: name,
    url,
    mime,
    createdAtMs: nowMs()
  };

  io.emit('ptt:message', payload);
  return res.json({ ok: true, message: payload });
});

// Жалоба на последнее сообщение
app.post('/ptt/complaint', (req, res) => {
  const reporterId = String(req.body?.reporterId || '').trim() || nanoid(8);
  const messageId = String(req.body?.messageId || '').trim();
  if (!messageId) return res.status(400).json({ error: 'missing_messageId' });

  const msg = messages.get(messageId);
  if (!msg) return res.status(404).json({ error: 'unknown_message' });

  const windowMs = 60 * 1000;
  const threshold = 3;

  const entry = complaints.get(messageId) || { firstTsMs: nowMs(), count: 0, reporters: new Set() };

  // reset window if expired
  if (nowMs() - entry.firstTsMs > windowMs) {
    entry.firstTsMs = nowMs();
    entry.count = 0;
    entry.reporters = new Set();
  }

  if (entry.reporters.has(reporterId)) {
    complaints.set(messageId, entry);
    return res.json({ ok: true, count: entry.count, duplicated: true });
  }

  entry.reporters.add(reporterId);
  entry.count += 1;
  complaints.set(messageId, entry);

  if (entry.count >= threshold) {
    banUser(msg.speakerId, 30);
    io.emit('ptt:banned', { userId: msg.speakerId, minutes: 30 });
  }

  return res.json({ ok: true, count: entry.count });
});

// ====== Socket.io ======
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  socket.data.userId = 'anon';
  socket.data.name = 'Неизвестный';

  socket.on('hello', (payload) => {
    socket.data.userId = String(payload?.userId || 'anon').trim() || 'anon';
    socket.data.name = sanitizeName(payload?.name);

    socket.emit('ptt:state', {
      busy: channelBusy,
      banned: isBanned(socket.data.userId)
    });
  });

  socket.on('ptt:start', () => {
    const userId = socket.data.userId;
    const name = sanitizeName(socket.data.name);

    if (isBanned(userId)) {
      socket.emit('ptt:denied', { reason: 'banned' });
      return;
    }

    if (channelBusy && String(channelBusy.userId) !== String(userId)) {
      socket.emit('ptt:denied', { reason: 'busy', busy: channelBusy });
      return;
    }

    channelBusy = { userId, name, sinceMs: nowMs() };
    io.emit('ptt:busy', channelBusy);
  });

  socket.on('ptt:stop', () => {
    const userId = socket.data.userId;
    if (channelBusy && String(channelBusy.userId) === String(userId)) {
      channelBusy = null;
      io.emit('ptt:free');
    }
  });

  socket.on('disconnect', () => {
    const userId = socket.data.userId;
    if (channelBusy && String(channelBusy.userId) === String(userId)) {
      channelBusy = null;
      io.emit('ptt:free');
    }
  });
});

server.listen(PORT, () => {
  console.log(`PTT server listening on http://localhost:${PORT}`);
});
