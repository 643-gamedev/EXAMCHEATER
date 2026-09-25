(() => {
  // Real accounts persist in localStorage (survives closing the tab).
  // Guest sessions live in sessionStorage only — the browser wipes
  // sessionStorage the moment the tab/window closes, which is what
  // makes guest chats disappear automatically. No server-side chat
  // storage exists for either mode; chat history only ever lives in
  // this page's memory.
  const savedGuestToken = sessionStorage.getItem('st_guest_token');
  const savedGuestUsername = sessionStorage.getItem('st_guest_username');
  const savedToken = localStorage.getItem('st_token');
  const savedUsername = localStorage.getItem('st_username');

  const state = {
    token: savedGuestToken || savedToken || null,
    username: savedGuestUsername || savedUsername || null,
    isGuest: !!savedGuestToken,
    mode: 'login', // or 'register'
    chatHistory: [],
  };

  const $ = (id) => document.getElementById(id);

  // ---------------- Auth screen ----------------
  const authScreen = $('authScreen');
  const appScreen = $('appScreen');
  const authForm = $('authForm');
  const authError = $('authError');
  const authToggle = $('authToggle');
  const authModeLabel = $('authModeLabel');
  const authSubmit = $('authSubmit');
  const whoami = $('whoami');
  const whoamiName = $('whoami-name');
  const guestBadge = $('guestBadge');
  const guestBtn = $('guestBtn');
  const logoutBtn = $('logoutBtn');

  function showApp() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    if (state.isGuest) {
      whoami.classList.add('hidden');
      guestBadge.classList.remove('hidden');
    } else {
      guestBadge.classList.add('hidden');
      whoami.classList.remove('hidden');
      whoamiName.textContent = state.username;
    }
    startLanPolling();
  }

  function showAuth() {
    appScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    whoami.classList.add('hidden');
    guestBadge.classList.add('hidden');
    logoutBtn.classList.add('hidden');
  }

  guestBtn.addEventListener('click', async () => {
    authError.classList.add('hidden');
    try {
      const res = await fetch('/api/guest', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start a guest session');
      state.token = data.token;
      state.username = data.username;
      state.isGuest = true;
      sessionStorage.setItem('st_guest_token', state.token);
      sessionStorage.setItem('st_guest_username', state.username);
      showApp();
    } catch (err) {
      authError.textContent = '! ' + err.message;
      authError.classList.remove('hidden');
    }
  });

  authToggle.addEventListener('click', () => {
    state.mode = state.mode === 'login' ? 'register' : 'login';
    authModeLabel.textContent = state.mode;
    authSubmit.textContent = state.mode === 'login' ? '[ login ]' : '[ register ]';
    authToggle.textContent =
      state.mode === 'login' ? 'need an account? register -->' : 'have an account? login -->';
    authError.classList.add('hidden');
  });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const username = $('authUsername').value.trim();
    const password = $('authPassword').value;
    try {
      const res = await fetch(`/api/${state.mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      state.token = data.token;
      state.username = data.username;
      state.isGuest = false;
      localStorage.setItem('st_token', state.token);
      localStorage.setItem('st_username', state.username);
      showApp();
    } catch (err) {
      authError.textContent = '! ' + err.message;
      authError.classList.remove('hidden');
    }
  });

  function clearSession() {
    state.token = null;
    state.username = null;
    state.isGuest = false;
    state.chatHistory = [];
    localStorage.removeItem('st_token');
    localStorage.removeItem('st_username');
    sessionStorage.removeItem('st_guest_token');
    sessionStorage.removeItem('st_guest_username');
    if (lanPollHandle) {
      clearInterval(lanPollHandle);
      lanPollHandle = null;
    }
    lanLastId = 0;
  }

  logoutBtn.addEventListener('click', () => {
    clearSession();
    showAuth();
  });

  // Belt-and-suspenders: sessionStorage already clears itself when the
  // tab/window closes, but explicitly wipe the guest session and any
  // in-memory chat/quiz/flashcard content the instant the tab starts
  // unloading, too.
  window.addEventListener('pagehide', () => {
    if (state.isGuest) clearSession();
  });

  async function authedFetch(url, options = {}) {
    const isFormData = options.body instanceof FormData;
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${state.token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      logoutBtn.click();
      throw new Error('Session expired — please log in again.');
    }
    return res;
  }

  // ---------------- Tabs ----------------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    });
  });

  // ---------------- Chat ----------------
  const chatLog = $('chatLog');
  const chatForm = $('chatForm');
  const chatInput = $('chatInput');

  function appendMsg(container, who, text) {
    const div = document.createElement('div');
    div.className = `msg ${who}`;
    div.innerHTML = `<span class="who"></span>${escapeHtml(text)}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  appendMsg(chatLog, 'system', 'tutor is ready. ask about anything you need to study.');

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;
    appendMsg(chatLog, 'user', message);
    state.chatHistory.push({ role: 'user', content: message });
    chatInput.value = '';
    appendMsg(chatLog, 'system', 'thinking...');
    try {
      const res = await authedFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message, history: state.chatHistory }),
      });
      const data = await res.json();
      chatLog.lastChild.remove();
      if (!res.ok) throw new Error(data.error || 'Failed to reach the tutor');
      appendMsg(chatLog, 'bot', data.reply);
      state.chatHistory.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      chatLog.lastChild.remove();
      appendMsg(chatLog, 'system', '! ' + err.message);
    }
  });

  // ---------------- Quiz ----------------
  const quizForm = $('quizForm');
  const quizArea = $('quizArea');

  quizForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = $('quizTopic').value.trim();
    const count = $('quizCount').value;
    if (!topic) return;
    quizArea.innerHTML = '<div class="msg system">generating quiz...</div>';
    try {
      const res = await authedFetch('/api/quiz', {
        method: 'POST',
        body: JSON.stringify({ topic, count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate quiz');
      renderQuiz(data.questions || []);
    } catch (err) {
      quizArea.innerHTML = `<div class="msg system">! ${escapeHtml(err.message)}</div>`;
    }
  });

  function renderQuiz(questions) {
    quizArea.innerHTML = '';
    if (!questions.length) {
      quizArea.innerHTML = '<div class="msg system">no questions generated. try again.</div>';
      return;
    }
    questions.forEach((q, qi) => {
      const wrap = document.createElement('div');
      wrap.className = 'quiz-question';
      const title = document.createElement('div');
      title.className = 'q-title';
      title.textContent = `${qi + 1}. ${q.question}`;
      wrap.appendChild(title);

      (q.options || []).forEach((opt, oi) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quiz-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          wrap.querySelectorAll('.quiz-option').forEach((b) => (b.disabled = true));
          if (oi === q.answerIndex) {
            btn.classList.add('correct');
          } else {
            btn.classList.add('wrong');
            const correctBtn = wrap.querySelectorAll('.quiz-option')[q.answerIndex];
            if (correctBtn) correctBtn.classList.add('correct');
          }
          if (q.explanation) {
            const exp = document.createElement('div');
            exp.className = 'quiz-explanation';
            exp.textContent = q.explanation;
            wrap.appendChild(exp);
          }
        });
        wrap.appendChild(btn);
      });

      quizArea.appendChild(wrap);
    });
  }

  // ---------------- Flashcards ----------------
  const flashForm = $('flashForm');
  const flashArea = $('flashArea');

  flashForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const topic = $('flashTopic').value.trim();
    const count = $('flashCount').value;
    if (!topic) return;
    flashArea.innerHTML = '<div class="msg system">generating flashcards...</div>';
    try {
      const res = await authedFetch('/api/flashcards', {
        method: 'POST',
        body: JSON.stringify({ topic, count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate flashcards');
      renderFlashcards(data.cards || []);
    } catch (err) {
      flashArea.innerHTML = `<div class="msg system">! ${escapeHtml(err.message)}</div>`;
    }
  });

  function renderFlashcards(cards) {
    flashArea.innerHTML = '';
    if (!cards.length) {
      flashArea.innerHTML = '<div class="msg system">no flashcards generated. try again.</div>';
      return;
    }
    cards.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'flash-card';
      card.dataset.flipped = 'false';
      card.textContent = c.front;
      card.addEventListener('click', () => {
        const flipped = card.dataset.flipped === 'true';
        card.textContent = flipped ? c.front : c.back;
        card.dataset.flipped = flipped ? 'false' : 'true';
      });
      flashArea.appendChild(card);
    });
  }

  // ---------------- LAN chat ----------------
  const lanLog = $('lanLog');
  const lanForm = $('lanForm');
  const lanInput = $('lanInput');
  const lanFile = $('lanFile');
  const lanFileName = $('lanFileName');
  let lanLastId = 0;
  let lanPollHandle = null;

  lanFile.addEventListener('change', () => {
    lanFileName.textContent = lanFile.files[0] ? `attached: ${lanFile.files[0].name}` : '';
    lanFileName.classList.toggle('hidden', !lanFile.files[0]);
  });

  function renderLanMessage(m) {
    const div = document.createElement('div');
    div.className = 'msg lan-msg';
    const meta = document.createElement('div');
    meta.className = 'lan-meta';
    meta.textContent = `${m.sender} · ${new Date(m.ts).toLocaleTimeString()}`;
    div.appendChild(meta);

    if (m.type === 'text') {
      const body = document.createElement('div');
      body.textContent = m.text;
      div.appendChild(body);
    } else if (m.type === 'image') {
      const img = document.createElement('img');
      img.src = m.url;
      img.alt = m.filename;
      div.appendChild(img);
    } else {
      const a = document.createElement('a');
      a.href = m.url;
      a.className = 'file-link';
      a.textContent = `⬇ ${m.filename} (${Math.round((m.size || 0) / 1024)} KB)`;
      a.download = m.filename;
      div.appendChild(a);
    }
    lanLog.appendChild(div);
    lanLog.scrollTop = lanLog.scrollHeight;
  }

  async function pollLan() {
    try {
      const res = await authedFetch(`/api/lan/messages?after=${lanLastId}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.messages)) {
        data.messages.forEach((m) => {
          renderLanMessage(m);
          lanLastId = Math.max(lanLastId, m.id);
        });
      }
    } catch {
      /* ignore transient poll errors */
    }
  }

  function startLanPolling() {
    if (lanPollHandle) return;
    pollLan();
    lanPollHandle = setInterval(pollLan, 2000);
  }

  lanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = lanInput.value.trim();
    const file = lanFile.files[0];
    try {
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await authedFetch('/api/lan/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        lanFile.value = '';
        lanFileName.classList.add('hidden');
      }
      if (text) {
        const res = await authedFetch('/api/lan/messages', {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Send failed');
        lanInput.value = '';
      }
      pollLan();
    } catch (err) {
      appendMsg(lanLog, 'system', '! ' + err.message);
    }
  });

  // ---------------- Study guide ----------------
  const guideForm = $('guideForm');
  const guideProvider = $('guideProvider');
  const guideKeyRow = $('guideKeyRow');
  const guideApiKey = $('guideApiKey');
  const guideModel = $('guideModel');
  const guideTopic = $('guideTopic');
  const guideNotes = $('guideNotes');
  const guideOutput = $('guideOutput');

  function providerStorageKey(provider, field) {
    return `st_guide_${provider}_${field}`;
  }

  guideProvider.addEventListener('change', () => {
    const p = guideProvider.value;
    guideKeyRow.classList.toggle('hidden', p === 'ollama');
    guideApiKey.value = localStorage.getItem(providerStorageKey(p, 'key')) || '';
    guideModel.value = localStorage.getItem(providerStorageKey(p, 'model')) || '';
  });

  function tinyMarkdown(text) {
    const escaped = escapeHtml(text);
    return escaped
      .split('\n')
      .map((line) => {
        if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
        if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`;
        if (/^# /.test(line)) return `<h1>${line.slice(2)}</h1>`;
        if (/^[-*] /.test(line)) return `&bull; ${line.slice(2)}<br/>`;
        return line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '<br/>';
      })
      .join('\n');
  }

  guideForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = guideProvider.value;
    const apiKey = guideApiKey.value.trim();
    const model = guideModel.value.trim();
    const topic = guideTopic.value.trim();
    const notes = guideNotes.value.trim();
    if (!topic && !notes) return;

    if (provider !== 'ollama') {
      localStorage.setItem(providerStorageKey(provider, 'key'), apiKey);
      localStorage.setItem(providerStorageKey(provider, 'model'), model);
    }

    guideOutput.innerHTML = '<div class="msg system">generating study guide...</div>';
    try {
      const res = await authedFetch('/api/generate-guide', {
        method: 'POST',
        body: JSON.stringify({ topic, notes, provider, apiKey, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate study guide');
      guideOutput.innerHTML = tinyMarkdown(data.guide || '(empty response)');
    } catch (err) {
      guideOutput.innerHTML = `<div class="msg system">! ${escapeHtml(err.message)}</div>`;
    }
  });

  // ---------------- Boot ----------------
  if (state.token && state.username) {
    showApp();
  } else {
    showAuth();
  }
})();
