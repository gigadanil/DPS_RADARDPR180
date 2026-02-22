(() => {
  const socket = io({ transports: ['websocket', 'polling'] });

  const $pttBtn = document.getElementById('pttBtn');
  const $status = document.getElementById('status');
  const $complainBtn = document.getElementById('complainBtn');
  const $nameInput = document.getElementById('nameInput');
  const $userIdInput = document.getElementById('userIdInput');

  const MAX_RECORD_MS = 7000;
  const COOLDOWN_MS = 10000;

  let isPressed = false;
  let isCooldown = false;
  let cooldownTimer = null;
  let recordAutoStopTimer = null;

  let channelBusy = null; // { userId, name }
  let banned = false;

  let mediaStream = null;
  let mediaRecorder = null;
  let chunks = [];

  let lastMessageId = null;
  let lastReporterId = null;

  // ===== TTS queue for prefix =====
  let ttsQueue = [];
  let ttsSpeaking = false;
  let ruVoice = null;

  // ===== Wake Lock =====
  let wakeLock = null;

  function logStatus(text) {
    $status.textContent = text;
  }

  function getUserId() {
    const raw = String($userIdInput.value || '').trim();
    if (raw) return raw;
    const stored = localStorage.getItem('ptt:userId');
    if (stored) return stored;
    const gen = String(Math.random()).slice(2, 10);
    localStorage.setItem('ptt:userId', gen);
    $userIdInput.value = gen;
    return gen;
  }

  function getName() {
    const raw = String($nameInput.value || '').trim();
    if (raw) {
      localStorage.setItem('ptt:name', raw);
      return raw;
    }
    const stored = localStorage.getItem('ptt:name');
    if (stored) {
      $nameInput.value = stored;
      return stored;
    }
    return 'Водитель';
  }

  function loadIdentity() {
    try {
      const n = localStorage.getItem('ptt:name');
      if (n) $nameInput.value = n;
      const id = localStorage.getItem('ptt:userId');
      if (id) $userIdInput.value = id;
    } catch (e) {}
  }

  function canTalkNow() {
    if (banned) return false;
    if (isCooldown) return false;
    if (channelBusy && String(channelBusy.userId) !== String(getUserId())) return false;
    return true;
  }

  function updateButtonUI() {
    const myId = getUserId();

    $pttBtn.classList.remove('disabled', 'busy');
    $pttBtn.disabled = false;

    if (banned) {
      $pttBtn.classList.add('disabled');
      $pttBtn.disabled = true;
      $pttBtn.textContent = '🚫 Вы забанены в рации (30 мин)';
      return;
    }

    if (channelBusy && String(channelBusy.userId) !== String(myId)) {
      $pttBtn.classList.add('busy');
      $pttBtn.disabled = true;
      $pttBtn.textContent = `Канал занят: ${channelBusy.name}`;
      return;
    }

    if (isCooldown) {
      $pttBtn.classList.add('disabled');
      $pttBtn.disabled = true;
      return;
    }

    if (isPressed) {
      $pttBtn.textContent = '🎙️ Говорю… отпусти для отправки';
      return;
    }

    $pttBtn.textContent = '🎙️ Удерживай, чтобы говорить';
  }

  function startCooldown() {
    isCooldown = true;
    const startedAt = Date.now();

    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      const left = Math.max(0, COOLDOWN_MS - (Date.now() - startedAt));
      const sec = Math.ceil(left / 1000);
      $pttBtn.textContent = `⏳ Подожди ${sec}с`;
      if (left <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        isCooldown = false;
        updateButtonUI();
      }
    }, 250);

    updateButtonUI();
  }

  function pickRuVoice() {
    try {
      const voices = speechSynthesis.getVoices() || [];
      const ru = voices.filter(v => String(v.lang || '').toLowerCase().startsWith('ru'));
      if (!ru.length) return null;
      const preferred = ru.find(v => /google|yandex|windows|microsoft/i.test(String(v.name || '')));
      return preferred || ru[0];
    } catch {
      return null;
    }
  }

  function ensureVoices() {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.getVoices(); } catch {}
    try {
      speechSynthesis.onvoiceschanged = () => { ruVoice = pickRuVoice(); };
    } catch {}
    ruVoice = pickRuVoice();
  }

  function speakQueued(text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (!('speechSynthesis' in window)) return;

    ensureVoices();
    ttsQueue.push(t);
    speakNext();
  }

  function speakNext() {
    if (!('speechSynthesis' in window)) return;
    if (ttsSpeaking) return;
    if (!ttsQueue.length) return;

    const next = ttsQueue.shift();
    if (!next) return;

    ttsSpeaking = true;
    const u = new SpeechSynthesisUtterance(next);
    u.lang = 'ru-RU';
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    if (ruVoice) u.voice = ruVoice;

    u.onend = () => { ttsSpeaking = false; speakNext(); };
    u.onerror = () => { ttsSpeaking = false; speakNext(); };

    try { speechSynthesis.speak(u); } catch { ttsSpeaking = false; }
  }

  async function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return;
      if (document.hidden) return;
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    try { wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestWakeLock();
    else releaseWakeLock();
  });

  async function ensureMic() {
    if (mediaStream) return mediaStream;
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return mediaStream;
  }

  function startRecording() {
    chunks = [];

    const options = {};
    // try prefer opus
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      options.mimeType = 'audio/webm;codecs=opus';
    }

    mediaRecorder = new MediaRecorder(mediaStream, options);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        await uploadAndBroadcast(blob);
      } catch (e) {
        logStatus('Ошибка отправки записи');
      }
    };

    mediaRecorder.start();
  }

  function stopRecording() {
    if (!mediaRecorder) return;
    try {
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    } catch {}
  }

  async function uploadAndBroadcast(blob) {
    const fd = new FormData();
    fd.append('userId', getUserId());
    fd.append('name', getName());
    fd.append('audio', blob, `ptt-${Date.now()}.webm`);

    logStatus('Отправка…');

    const res = await fetch('/ptt/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      logStatus(`Ошибка upload: ${res.status}`);
      console.warn(t);
      return;
    }

    logStatus('Отправлено ✅');
    startCooldown();
  }

  function clearAutoStopTimer() {
    if (recordAutoStopTimer) {
      clearTimeout(recordAutoStopTimer);
      recordAutoStopTimer = null;
    }
  }

  async function handlePressStart() {
    if (isPressed) return;
    if (!canTalkNow()) {
      updateButtonUI();
      return;
    }

    try {
      await requestWakeLock();
      await ensureMic();

      socket.emit('ptt:start');

      isPressed = true;
      updateButtonUI();
      logStatus('Запись…');

      startRecording();

      clearAutoStopTimer();
      recordAutoStopTimer = setTimeout(() => {
        if (!isPressed) return;
        handlePressEnd(true);
      }, MAX_RECORD_MS);

    } catch (e) {
      isPressed = false;
      logStatus('Нет доступа к микрофону');
      updateButtonUI();
    }
  }

  function handlePressEnd(auto = false) {
    if (!isPressed) return;

    isPressed = false;
    clearAutoStopTimer();

    try { socket.emit('ptt:stop'); } catch {}

    stopRecording();

    logStatus(auto ? '7 сек — отправляю…' : 'Отпущено — отправляю…');
    updateButtonUI();
  }

  function attachHoldHandlers(el) {
    // мышь
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handlePressStart();
    });
    window.addEventListener('mouseup', () => handlePressEnd(false));

    // тач
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      handlePressStart();
    }, { passive: false });
    window.addEventListener('touchend', () => handlePressEnd(false));

    // fallback
    el.addEventListener('mouseleave', () => handlePressEnd(false));
  }

  async function playIncomingMessage(msg) {
    const speakerName = String(msg?.speakerName || 'Кто-то');
    const url = String(msg?.url || '');
    if (!url) return;

    // ИИ-штурман: коротко озвучить имя
    speakQueued(`На связи ${speakerName}`);

    // ждём, пока фраза "на связи" начнёт/закончит (минимальная пауза)
    // без строгого ожидания — чтобы не затыкаться
    await new Promise(r => setTimeout(r, 450));

    const a = new Audio(url);
    a.volume = 1.0;
    try {
      await requestWakeLock();
      await a.play();
    } catch (e) {
      console.warn('Audio play blocked:', e);
    }
  }

  // ===== Complaints =====
  function ensureReporterId() {
    if (lastReporterId) return lastReporterId;
    const stored = localStorage.getItem('ptt:reporterId');
    if (stored) {
      lastReporterId = stored;
      return stored;
    }
    const gen = String(Math.random()).slice(2, 12);
    localStorage.setItem('ptt:reporterId', gen);
    lastReporterId = gen;
    return gen;
  }

  async function complainLast() {
    if (!lastMessageId) return;

    $complainBtn.disabled = true;
    try {
      const resp = await fetch('/ptt/complaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporterId: ensureReporterId(),
          messageId: lastMessageId
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        logStatus('Жалоба не отправлена');
        return;
      }
      logStatus(`Жалоба отправлена (счётчик: ${data?.count || 0})`);
    } finally {
      setTimeout(() => { $complainBtn.disabled = false; }, 1500);
    }
  }

  // ===== Socket events =====
  socket.on('connect', () => {
    socket.emit('hello', { userId: getUserId(), name: getName() });
    logStatus('Подключено к рации');
    updateButtonUI();
    requestWakeLock();
  });

  socket.on('ptt:state', (state) => {
    channelBusy = state?.busy || null;
    banned = !!state?.banned;
    updateButtonUI();
  });

  socket.on('ptt:busy', (busy) => {
    channelBusy = busy || null;
    updateButtonUI();
  });

  socket.on('ptt:free', () => {
    channelBusy = null;
    updateButtonUI();
  });

  socket.on('ptt:denied', (info) => {
    if (info?.reason === 'banned') {
      banned = true;
      logStatus('Вы забанены в рации');
    } else if (info?.reason === 'busy') {
      channelBusy = info?.busy || channelBusy;
      logStatus('Канал занят');
    }
    updateButtonUI();
  });

  socket.on('ptt:banned', (info) => {
    if (String(info?.userId) === String(getUserId())) {
      banned = true;
      logStatus('Автобан в рации на 30 минут');
      updateButtonUI();
    }
  });

  socket.on('ptt:message', async (msg) => {
    lastMessageId = String(msg?.id || '') || null;
    $complainBtn.disabled = !lastMessageId;

    // если это моё — можно не проигрывать
    if (String(msg?.speakerId) === String(getUserId())) return;

    await playIncomingMessage(msg);
  });

  // ===== init =====
  loadIdentity();
  ensureVoices();
  attachHoldHandlers($pttBtn);

  $complainBtn.addEventListener('click', complainLast);

  // Обновлять имя/ID при изменении
  $nameInput.addEventListener('change', () => socket.emit('hello', { userId: getUserId(), name: getName() }));
  $userIdInput.addEventListener('change', () => socket.emit('hello', { userId: getUserId(), name: getName() }));

})();
