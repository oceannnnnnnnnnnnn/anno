// public/client.js
// Mobile viewport fix + chat client (uses JSON payloads, optimistic UI, duplicate prevention)

// --- Mobile viewport fix (sets --vh and locks body scroll) ---
(function () {
  function setVh() {
    document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  }
  setVh();
  window.addEventListener('resize', setVh, { passive: true });

  // Prevent body/document scrolling; allow only chat container to scroll.
  document.documentElement.style.overscrollBehavior = 'none';
  document.body.style.overscrollBehavior = 'none';
  document.body.style.overflow = 'hidden';
})();

// --- Chat client (executes after DOM elements are parsed; script is expected at end of body) ---
(function () {
  // --- connection ---
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}`);

  // --- DOM handles (works with index.html structure) ---
  const chat = document.getElementById('chat');         // <ul id="chat">
  const input = document.getElementById('msg');         // <textarea id="msg">
  const button = document.getElementById('send');       // <button id="send">
  const form = document.getElementById('composer');     // <form id="composer">
  const chatContainer = document.getElementById('chat-container') || (chat && chat.parentElement);
  const attachBtn = document.querySelector('.icon-btn.attach');
  const fileInput = document.getElementById('fileInput');

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
  }

  // Guard: if no essential nodes, bail gracefully
  if (!chat || !input || !chatContainer) {
    console.error('Required DOM nodes not found: #chat, #msg, #chat-container');
    return;
  }

  // When the input gets focus, scroll chat to bottom after keyboard opens (mobile UX)
  input.addEventListener('focus', () => {
    setTimeout(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 250);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 250);
  });

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
    const c = chatContainer;
    const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
    return dist < 120; // px from bottom
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function autosize(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.resize = 'none';            // no manual drag
    el.style.overflow = 'auto';
    el.style.height = 'auto';
    const max = 140; // px
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }

  if (input && input.tagName === 'TEXTAREA') {
    input.style.resize = 'none';
    autosize(input);
  }

  function createMessageElement({ text, image, clientId, tempId, timestamp }, opts = {}) {
    const li = document.createElement('li');
    li.className = 'message ' + (clientId === CLIENT_ID ? 'sent' : 'received');
    if (tempId) li.dataset.tempId = tempId;
  
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.className = 'chat-image blurred';
      img.alt = 'Shared image';
      img.addEventListener('click', () => {
        img.classList.remove('blurred');
        img.classList.add('unblurred');
      });
      li.appendChild(img);
    } else {
      const body = document.createElement('div');
      body.className = 'text';
      body.textContent = String(text ?? '');
      li.appendChild(body);
    }
  
    // Meta info: timestamp + user ID if it's not me
    const meta = document.createElement('span');
    meta.className = 'meta';
    const t = new Date(timestamp || nowTs()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
    if (clientId !== CLIENT_ID && clientId) {
      meta.textContent = `${clientId} • ${t}`;
    } else {
      meta.textContent = opts.sending ? `${t} • sending` : t;
    }
    li.appendChild(meta);
  
    if (opts.sending) li.classList.add('sending');
    return li;
  }
  

  // --- message wire formats (supports JSON or plain text) ---
  function formatOutgoing(text, tempId) {
    // Send JSON object; server may rebroadcast this string (original server will rebroadcast raw string)
    return JSON.stringify({ text, clientId: CLIENT_ID, tempId, timestamp: nowTs() });
  }

  function parseIncoming(raw) {
    if (typeof raw === 'string' && raw.startsWith('{')) {
      try {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          return {
            text: o.text || null,
            image: o.image || null,
            clientId: o.clientId || null,
            tempId: o.tempId || null,
            timestamp: o.timestamp || nowTs(),
          };
        }
      } catch (_) {}
    }
    return { clientId: null, tempId: null, text: String(raw), image: null, timestamp: nowTs() };
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
      // keep text as-is (server text may be same); remove dataset and pending map
      delete el.dataset.tempId;
      pending.delete(msg.tempId);
      return; // don't append duplicate
    }

    // New message (history, others, or our own without optimistic)
    const shouldScroll = atBottom();
    const el = createMessageElement(msg);
    chat.appendChild(el);
    if (shouldScroll) scrollToBottom();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
  
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // Base64 encoded image
      sendImage(dataUrl);
    };
    reader.readAsDataURL(file);
  
    // Reset input so selecting the same file again triggers change
    fileInput.value = '';
  });
  
  function sendImage(dataUrl) {
    const tempId = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  
    const optimistic = { image: dataUrl, clientId: CLIENT_ID, tempId, timestamp: nowTs() };
    const el = createMessageElement(optimistic, { sending: true });
    const shouldScroll = atBottom();
    chat.appendChild(el);
    pending.set(tempId, el);
    if (shouldScroll) scrollToBottom();
  
    ws.send(JSON.stringify({ image: dataUrl, clientId: CLIENT_ID, tempId, timestamp: nowTs() }));
  }
  

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

  // --- UI wiring ---
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      doSend();
    });
  }

  if (button) {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      doSend();
    });
    button.disabled = true;
  }

  input.addEventListener('keydown', (e) => {
    // Enter sends; Shift+Enter makes newline (for textarea)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  input.addEventListener('input', () => {
    if (button) button.disabled = input.value.trim() === '';
    if (input.tagName === 'TEXTAREA') autosize(input);
  });

  // init scroll to bottom if content exists
  setTimeout(scrollToBottom, 50);

})();
