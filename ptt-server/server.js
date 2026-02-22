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
// Радиус рации (км)
const PTT_RADIUS_KM = Number(process.env.PTT_RADIUS_KM || 5);

// кто сейчас удерживает канал (по регионам ~5км)
const regionBusy = new Map(); // regionKey -> { userId, name, sinceMs, lat, lon }

// бан по userId
const bans = new Map(); // userId -> banUntilMs

// сообщения
const messages = new Map(); // messageId -> { speakerId, tsMs }

// жалобы
const complaints = new Map(); // messageId -> { firstTsMs, count, reporters:Set<string> }

// last known location
const socketLoc = new Map(); // socketId -> { lat, lon, tsMs, userId, name }
const userLoc = new Map(); // userId -> { lat, lon, tsMs }

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function regionKey(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'unknown';
  // 0.05 градуса ~ 5-6 км
  const qLat = Math.round(a * 20);
  const qLon = Math.round(b * 20);
  return `${qLat}:${qLon}`;
}

function emitToRadius(event, payload, center) {
  const lat = Number(center?.lat);
  const lon = Number(center?.lon);

  // если центр неизвестен — fallback: всем
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    io.emit(event, payload);
    return;
  }

  for (const [id, socket] of io.sockets.sockets) {
    const loc = socketLoc.get(id);
    const sLat = Number(loc?.lat);
    const sLon = Number(loc?.lon);
    // если клиент не прислал координаты — для совместимости тоже отправим
    if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) {
      socket.emit(event, payload);
      continue;
    }
    const d = haversineKm(lat, lon, sLat, sLon);
    if (d <= PTT_RADIUS_KM) socket.emit(event, payload);
  }
}

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

function canTakeChannelForRegion(userId, rKey) {
  const busy = regionBusy.get(rKey);
  if (!busy) return true;
  return String(busy.userId) === String(userId);
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
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  const rKey = regionKey(lat, lon);

  if (isBanned(userId)) {
    return res.status(403).json({ error: 'banned' });
  }

  if (!canTakeChannelForRegion(userId, rKey)) {
    return res.status(409).json({ error: 'channel_busy' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'no_file' });
  }

  const id = nanoid(12);
  const url = `/uploads/${req.file.filename}`;
  const mime = String(req.file.mimetype || 'audio/webm');

  messages.set(id, { speakerId: userId, tsMs: nowMs(), name });

  // release region channel
  const busy = regionBusy.get(rKey);
  if (busy && String(busy.userId) === String(userId)) {
    regionBusy.delete(rKey);
    emitToRadius('ptt:free', { region: rKey }, { lat, lon });
  }

  const payload = {
    id,
    speakerId: userId,
    speakerName: name,
    url,
    mime,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    createdAtMs: nowMs()
  };

  emitToRadius('ptt:message', payload, { lat, lon });
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
      busy: null,
      banned: isBanned(socket.data.userId)
    });
  });

  socket.on('ptt:loc', (payload) => {
    const lat = Number(payload?.lat);
    const lon = Number(payload?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const entry = { lat, lon, tsMs: nowMs(), userId: socket.data.userId, name: socket.data.name };
    socketLoc.set(socket.id, entry);
    if (socket.data.userId) userLoc.set(String(socket.data.userId), { lat, lon, tsMs: nowMs() });
  });

  socket.on('ptt:start', () => {
    const userId = socket.data.userId;
    const name = sanitizeName(socket.data.name);

    if (isBanned(userId)) {
      socket.emit('ptt:denied', { reason: 'banned' });
      return;
    }

    const loc = socketLoc.get(socket.id) || userLoc.get(String(userId)) || null;
    const lat = Number(loc?.lat);
    const lon = Number(loc?.lon);
    const rKey = regionKey(lat, lon);

    const busy = regionBusy.get(rKey);
    if (busy && String(busy.userId) !== String(userId)) {
      socket.emit('ptt:denied', { reason: 'busy', busy });
      return;
    }

    const next = { userId, name, sinceMs: nowMs(), lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null };
    regionBusy.set(rKey, next);
    emitToRadius('ptt:busy', next, { lat, lon });
  });

  socket.on('ptt:stop', () => {
    const userId = socket.data.userId;
    const loc = socketLoc.get(socket.id) || userLoc.get(String(userId)) || null;
    const rKey = regionKey(loc?.lat, loc?.lon);
    const busy = regionBusy.get(rKey);
    if (busy && String(busy.userId) === String(userId)) {
      regionBusy.delete(rKey);
      emitToRadius('ptt:free', { region: rKey }, { lat: loc?.lat, lon: loc?.lon });
    }
  });

  socket.on('disconnect', () => {
    const userId = socket.data.userId;
    socketLoc.delete(socket.id);

    const loc = userLoc.get(String(userId)) || null;
    const rKey = regionKey(loc?.lat, loc?.lon);
    const busy = regionBusy.get(rKey);
    if (busy && String(busy.userId) === String(userId)) {
      regionBusy.delete(rKey);
      emitToRadius('ptt:free', { region: rKey }, { lat: loc?.lat, lon: loc?.lon });
    }
  });
});

server.listen(PORT, () => {
  console.log(`PTT server listening on http://localhost:${PORT}`);
});
