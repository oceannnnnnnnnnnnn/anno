// public/client.js
(function () {
  // --- connection ---
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}`);

  // --- DOM handles (works with original or updated HTML) ---
  const chat = document.getElementById('chat');         // <ul id="chat">
  const input = document.getElementById('msg');         // <input id="msg"> or <textarea id="msg">
  const button = document.getElementById('send');       // <button id="send">
  const form = document.getElementById('composer');     // optional <form id="composer">
  const container =
    document.getElementById('chat-container') ||        // optional wrapper
    (chat && chat.parentElement) || document.scrollingElement;

  // Guard: if no essential nodes, bail gracefully
  if (!chat || !input) {
    console.error('chat or msg element not found');
    return;
  }

  // --- identity & pending map ---
  let CLIENT_ID = sessionStorage.getItem('annoClientId');
  if (!CLIENT_ID) {
    CLIENT_ID = 'c_' + Math.random().toString(36).slice(2, 9);
    sessionStorage.setItem('annoClientId', CLIENT_ID);
  }
  const pending = new Map(); // tempId -> <li>

  // --- utilities ---
  function nowTs() { return Date.now(); }

  function atBottom() {
    const c = container;
    const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
    return dist < 120; // px from bottom
    }

  function scrollToBottom() {
    const c = container;
    c.scrollTop = c.scrollHeight;
  }

  function autosize(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.resize = 'none';            // no manual drag
    el.style.overflow = 'auto';
    el.style.height = 'auto';
    const max = 140; // px
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }

  // fallback disable manual resize even if CSS missing
  if (input && input.tagName === 'TEXTAREA') {
    input.style.resize = 'none';
    autosize(input);
  }

  function createMessageElement({ text, clientId, tempId, timestamp }, opts = {}) {
    const li = document.createElement('li');
    li.className = 'message ' + (clientId === CLIENT_ID ? 'sent' : 'received');
    if (tempId) li.dataset.tempId = tempId;

    const body = document.createElement('div');
    body.className = 'text';
    body.textContent = String(text ?? '');
    li.appendChild(body);

    const meta = document.createElement('span');
    meta.className = 'meta';
    const t = new Date(timestamp || nowTs()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.textContent = opts.sending ? `${t} • sending` : t;
    li.appendChild(meta);

    if (opts.sending) li.classList.add('sending');
    return li;
  }

  // --- message wire formats (supports JSON or "cid|tid|text" or plain text) ---
  function formatOutgoing(text, tempId) {
    // Prefer JSON; the original server will just rebroadcast this string intact.
    return JSON.stringify({ text, clientId: CLIENT_ID, tempId, timestamp: nowTs() });
  }

  function parseIncoming(raw) {
    // 1) JSON payload
    if (typeof raw === 'string' && raw.startsWith('{')) {
      try {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object' && 'text' in o) {
          return {
            text: String(o.text ?? ''),
            clientId: o.clientId ?? null,
            tempId: o.tempId ?? null,
            timestamp: o.timestamp ?? nowTs(),
          };
        }
      } catch (_) {}
    }

    // 2) Pipe format: "clientId|tempId|text"
    if (typeof raw === 'string') {
      const i1 = raw.indexOf('|');
      const i2 = i1 >= 0 ? raw.indexOf('|', i1 + 1) : -1;
      if (i1 > 0 && i2 > i1) {
        return {
          clientId: raw.slice(0, i1),
          tempId: raw.slice(i1 + 1, i2),
          text: raw.slice(i2 + 1),
          timestamp: nowTs(),
        };
      }
      // 3) Plain text fallback
      return { clientId: null, tempId: null, text: raw, timestamp: nowTs() };
    }

    // Blob/ArrayBuffer unlikely in your setup; fallback
    return { clientId: null, tempId: null, text: String(raw), timestamp: nowTs() };
  }

  // --- websocket handlers ---
  ws.addEventListener('open', () => console.log('WebSocket connected'));
  ws.addEventListener('error', (e) => console.error('WebSocket error:', e));
  ws.addEventListener('close', () => console.log('WebSocket closed'));

  ws.addEventListener('message', (evt) => {
    const msg = parseIncoming(evt.data);

    // If this is our echo for a pending tempId, update the optimistic bubble instead of appending a duplicate
    if (msg.clientId === CLIENT_ID && msg.tempId && pending.has(msg.tempId)) {
      const el = pending.get(msg.tempId);
      el.classList.remove('sending');
      const meta = el.querySelector('.meta');
      if (meta) {
        const t = new Date(msg.timestamp || nowTs()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        meta.textContent = t;
      }
      pending.delete(msg.tempId);
      return; // stop here — no duplicate append
    }

    // New message (history, others, or our own without optimistic)
    const shouldScroll = atBottom();
    const el = createMessageElement(msg);
    chat.appendChild(el);
    if (shouldScroll) scrollToBottom();
  });

  // --- sending ---
  function doSend() {
    const text = (input.value || '').trim();
    if (!text) return;

    const tempId = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // optimistic bubble
    const optimistic = { text, clientId: CLIENT_ID, tempId, timestamp: nowTs() };
    const el = createMessageElement(optimistic, { sending: true });
    const shouldScroll = atBottom();
    chat.appendChild(el);
    pending.set(tempId, el);
    if (shouldScroll) scrollToBottom();

    // send
    ws.send(formatOutgoing(text, tempId));

    // reset input
    input.value = '';
    if (input.tagName === 'TEXTAREA') autosize(input);
    if (button) button.disabled = true;
  }

  // --- UI wiring (works with both original and updated markup) ---
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      doSend();
    });
  }
  if (button) {
    button.addEventListener('click', doSend);
    button.disabled = true;
  }

  input.addEventListener('keydown', (e) => {
    // Enter sends; Shift+Enter makes newline (for textarea)
    if (e.key === 'Enter' && !e.shiftKey) {
      // If it's an <input>, prevent form submission too
      e.preventDefault();
      doSend();
    }
  });

  input.addEventListener('input', () => {
    if (button) button.disabled = input.value.trim() === '';
    if (input.tagName === 'TEXTAREA') autosize(input);
  });

})();
