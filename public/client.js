// public/client.js (Full file — replace your current client.js with this)
(function () {
  'use strict';

  // --- Mobile viewport fix ---
  const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
  setVh();
  window.addEventListener('resize', setVh, { passive: true });
  document.body.style.overflow = 'hidden';

  // --- WebSocket Connection ---
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}`);

  // --- DOM Handles ---
  const app = document.getElementById('app');
  const fileInput = document.getElementById('fileInput');
  const publicChatList = document.getElementById('public-chat-list');
  const publicComposer = document.getElementById('public-composer');
  const dmChatList = document.getElementById('dm-chat-list');
  const dmComposer = document.getElementById('dm-composer');
  const dmChatTitle = document.getElementById('dm-chat-title');
  const dmChatSubtitle = document.getElementById('dm-chat-subtitle');
  const dmBackButton = document.getElementById('dm-back-btn');
  const dmPanel = document.getElementById('dm-panel');
  const dmOpenBtn = document.querySelector('.dm-open-btn');
  const dmCloseBtn = document.getElementById('dm-close');
  const dmThreadsEl = document.getElementById('dm-threads');

  // --- Universal Composer & Attachment Logic ---
  document.querySelectorAll('.composer-form').forEach(form => {
    const input = form.querySelector('.msg-input');
    const sendBtn = form.querySelector('.send-btn');
    const attachBtn = form.querySelector('.attach');
    if (attachBtn) attachBtn.addEventListener('click', () => fileInput.click());
    form.addEventListener('submit', (e) => { e.preventDefault(); sendTextMessage(); });
    if (input && sendBtn) {
      input.addEventListener('input', () => { sendBtn.disabled = input.value.trim() === ''; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
      });
    }
  });

  // --- State ---
  let CLIENT_ID = sessionStorage.getItem('annoClientId');
  if (!CLIENT_ID) {
    CLIENT_ID = 'c_' + Math.random().toString(36).slice(2, 9);
    sessionStorage.setItem('annoClientId', CLIENT_ID);
  }
  const pending = new Map();
  const publicMessages = [];
  const cachedDMs = new Map();
  const dmThreads = new Set();
  const unreadCounts = new Map();
  let activeDM = null;

  let IS_ADMIN = sessionStorage.getItem('annoIsAdmin') === '1';

  function adminLoginPrompt() {
    const key = prompt('Admin key (paste secret):');
    if (!key) return;
    ws.send(JSON.stringify({ type: 'admin-login', key }));
  }

  // --- Utilities ---
  const dmKey = (a, b) => [a, b].sort().join('|');
  const now = () => Date.now();
  const scrollToBottom = (container) => {
    if (container) setTimeout(() => container.scrollTop = container.scrollHeight, 50);
  };

  // --- Admin UI helpers (robust insertion + visual update) ---
  // We'll expose setAdminVisual so ws message handler can update the UI directly.
  function createAdminButtonIfMissing() {
    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return null;

    // If button already exists, return it
    if (window.__anno_adminBtn && document.body.contains(window.__anno_adminBtn)) {
      return window.__anno_adminBtn;
    }

    const adminBtn = document.createElement('button');
    adminBtn.type = 'button';
    adminBtn.className = 'icon-btn admin-login-btn';
    adminBtn.setAttribute('aria-label', 'Admin login');
    adminBtn.title = 'Admin';
    adminBtn.textContent = '🛡️';

    adminBtn.addEventListener('click', () => { adminLoginPrompt(); });

    // Insert after existing children so it appears to the right of DM button
    topbarRight.appendChild(adminBtn);

    // store globally for easy access
    window.__anno_adminBtn = adminBtn;
    return adminBtn;
  }

  function setAdminVisual(isAdmin) {
    IS_ADMIN = Boolean(isAdmin);
    sessionStorage.setItem('annoIsAdmin', IS_ADMIN ? '1' : '0');
    const btn = window.__anno_adminBtn || createAdminButtonIfMissing();
    if (!btn) return;
    if (IS_ADMIN) {
      btn.classList.add('admin-active');
      btn.title = 'Admin (signed in)';
    } else {
      btn.classList.remove('admin-active');
      btn.title = 'Admin';
    }
    // also dispatch event for any other handlers
    window.dispatchEvent(new CustomEvent('anno-admin-state', { detail: { isAdmin: IS_ADMIN } }));
  }

  // Try to create the admin button now (works regardless of DOMContentLoaded timing).
  // If topbar-right doesn't exist yet, we'll create it later when needed (createAdminButtonIfMissing is idempotent).
  try { createAdminButtonIfMissing(); } catch (e) { /* ignore */ }

  // --- Admin context menu (existing) ---
  function showAdminMenu(x, y, { messageId, clientId }) {
    let menu = document.getElementById('admin-menu');
    if (menu) menu.remove();

    menu = document.createElement('div');
    menu.id = 'admin-menu';
    menu.style.position = 'absolute';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.zIndex = 9999;
    menu.className = 'admin-menu';
    menu.innerHTML = `
      ${messageId ? `<button id="admin-delete-msg">Delete message</button>` : ''}
      ${clientId ? `<button id="admin-kick">Kick user</button><button id="admin-ban">Ban user</button>` : ''}
      <button id="admin-cancel">Cancel</button>
    `;
    document.body.appendChild(menu);

    menu.querySelector('#admin-cancel').onclick = () => menu.remove();
    if (messageId) menu.querySelector('#admin-delete-msg').onclick = () => {
      if (!confirm('Delete this message?')) return;
      ws.send(JSON.stringify({ type: 'admin-delete-message', messageId }));
      menu.remove();
    };
    if (clientId) menu.querySelector('#admin-kick').onclick = () => {
      if (!confirm(`Kick user ${clientId}?`)) return;
      ws.send(JSON.stringify({ type: 'admin-kick', targetId: clientId }));
      menu.remove();
    };
    if (clientId) menu.querySelector('#admin-ban').onclick = () => {
      const reason = prompt('Reason for ban (optional):');
      if (!confirm(`Ban user ${clientId}?`)) return;
      ws.send(JSON.stringify({ type: 'admin-ban', targetId: clientId, reason }));
      menu.remove();
    };

    const onDocClick = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', onDocClick); } };
    document.addEventListener('click', onDocClick);
  }

  // --- Presigned cache (must be before resolver) ---
  const presignedCache = new Map(); // key -> { url, expiresAt }

  async function resolvePresignedUrl(key) {
    const cached = presignedCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const resp = await fetch(`/media/signed-url?key=${encodeURIComponent(key)}`, {
      headers: { 'X-Client-Id': CLIENT_ID }
    });
    if (!resp.ok) throw new Error('failed to get signed url');
    const { url } = await resp.json();
    presignedCache.set(key, { url, expiresAt: Date.now() + (4 * 60 * 1000) });
    return url;
  }

  // --- DOM Rendering ---
  function createMessageElement(msg) {
    const { text, image, media, clientId, from, tempId, timestamp } = msg;
    const li = document.createElement('li');
    if (msg.messageId) li.dataset.messageId = msg.messageId;
    if (msg.tempId) li.dataset.tempId = msg.tempId;

    // If message is flagged deleted (server or local), render [message deleted] and return early
    if (msg.deleted || msg.deleted_at) {
      li.classList.add('deleted');
      const content = document.createElement('div');
      content.className = 'content';
      content.textContent = '[message deleted]';
      li.appendChild(content);

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      li.appendChild(meta);

      return li;
    }

    const senderId = from || clientId;
    li.className = 'message ' + (senderId === CLIENT_ID ? 'sent' : 'received');

    if (senderId && senderId !== CLIENT_ID) {
      const idBtn = document.createElement('button');
      idBtn.className = 'user-id-btn';
      idBtn.textContent = senderId;
      idBtn.title = 'Open DM with ' + senderId;
      idBtn.onclick = () => openDM(senderId);
      li.appendChild(idBtn);
    }

    if (IS_ADMIN) {
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showAdminMenu(e.pageX, e.pageY, {
          messageId: li.dataset.messageId || null,
          clientId: (msg.from || msg.clientId) || null
        });
      });
    }

    const content = document.createElement('div');
    content.className = 'content';

    if (media && media.kind) {
      if (media.kind === 'image') {
        const img = document.createElement('img');
        img.alt = 'Shared image';
        img.className = 'chat-image blurred';
        img.onclick = () => img.classList.remove('blurred');
        if (media.url) img.src = media.url;
        else resolvePresignedUrl(media.key).then(url => img.src = url).catch(() => { img.alt = 'Could not load image'; });
        content.appendChild(img);
      } else if (media.kind === 'video') {
        const vid = document.createElement('video');
        vid.controls = true;
        vid.preload = 'metadata';
        if (media.url) vid.src = media.url;
        else resolvePresignedUrl(media.key).then(url => vid.src = url).catch(() => { vid.alt = 'Could not load video'; });
        content.appendChild(vid);
      }
    } else if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.className = 'chat-image blurred';
      img.alt = 'Shared image';
      img.onclick = () => img.classList.remove('blurred');
      content.appendChild(img);
    } else if (text) {
      content.textContent = String(text ?? '');
    }

    li.appendChild(content);

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.appendChild(meta);

    return li;
  }

  function renderPublicChat() {
    publicChatList.innerHTML = '';
    publicMessages.forEach(msg => publicChatList.appendChild(createMessageElement(msg)));
    scrollToBottom(publicChatList.parentElement);
  }

  function renderDMConversation(partnerId) {
    dmChatList.innerHTML = '';
    const key = dmKey(CLIENT_ID, partnerId);
    const messages = cachedDMs.get(key) || [];
    messages.forEach(msg => dmChatList.appendChild(createMessageElement(msg)));
    unreadCounts.delete(partnerId);
    renderDMPanel();
    scrollToBottom(dmChatList.parentElement);
  }

  function renderDMPanel() {
    if (!dmPanel) return;
    dmThreadsEl.innerHTML = '';
    const threads = Array.from(dmThreads);
    if (threads.length > 0) {
      threads.forEach(p => {
        const unread = unreadCounts.get(p) || 0;
        const row = document.createElement('div');
        row.className = 'dm-thread';
        row.innerHTML = `<span>${p}</span><span class="dm-thread-meta">${unread > 0 ? `${unread} new` : ''}</span>`;
        row.onclick = () => { openDM(p); dmPanel.classList.remove('open'); };
        dmThreadsEl.appendChild(row);
      });
    } else { dmThreadsEl.innerHTML = `<div class="dm-empty">No active DMs. Click a user's ID to start one.</div>`; }
  }

  // --- VIEW SWITCHING ---
  function showView(view, partnerId) {
    if (view === 'public') {
      app.setAttribute('data-view', 'public');
      activeDM = null;
      if (dmChatTitle) dmChatTitle.textContent = 'Direct Message';
      if (dmChatSubtitle) dmChatSubtitle.textContent = '';
      const inEl = publicComposer.querySelector('.msg-input');
      if (inEl) inEl.focus();
      renderPublicChat();
    } else if (view === 'dm') {
      if (!partnerId) return;
      activeDM = String(partnerId);
      app.setAttribute('data-view', 'dm');
      if (dmChatTitle) dmChatTitle.textContent = `Chat`;
      if (dmChatSubtitle) dmChatSubtitle.textContent = partnerId;
      renderDMConversation(partnerId);
      const inEl = dmComposer.querySelector('.msg-input');
      if (inEl) {
        inEl.value = '';
        dmComposer.querySelector('.send-btn').disabled = true;
        inEl.focus();
      }
    }
  }

  // --- Actions ---
  function openDM(partnerId) {
    if (!partnerId) return;
    if (partnerId === CLIENT_ID) return;
    showView('dm', partnerId);
  }

  function sendTextMessage() {
    const composer = activeDM ? dmComposer : publicComposer;
    const input = composer.querySelector('.msg-input');
    const text = (input.value || '').trim();
    if (!text) return;

    const tempId = 't_' + now() + '_' + Math.random().toString(36).slice(2, 6);
    const optimisticMsg = { text, from: CLIENT_ID, tempId, timestamp: now() };
    const el = createMessageElement(optimisticMsg);
    el.classList.add('sending');

    if (activeDM) {
      dmChatList.appendChild(el);
      scrollToBottom(dmChatList.parentElement);
      ws.send(JSON.stringify({ type: 'dm', to: activeDM, text, tempId }));
    } else {
      publicChatList.appendChild(el);
      scrollToBottom(publicChatList.parentElement);
      ws.send(JSON.stringify({ type: 'public', text, tempId }));
    }

    pending.set(tempId, { el });
    input.value = '';
    composer.querySelector('.send-btn').disabled = true;
  }

  // --- Image upload + compression (unchanged) ---
  async function sendImageWithCompression(file) {
    const MAX_WIDTH = 720;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.5));

    const fd = new FormData();
    fd.append('file', blob, file.name.replace(/\s+/g, '_'));
    fd.append('scope', activeDM ? 'dm' : 'public');
    if (activeDM) fd.append('dmKey', dmKey(CLIENT_ID, activeDM));

    const tempId = 'img_' + now() + '_' + Math.random().toString(36).slice(2,6);
    const optimisticMsg = { image: URL.createObjectURL(blob), from: CLIENT_ID, tempId, timestamp: now() };
    const el = createMessageElement(optimisticMsg);
    el.classList.add('sending');

    if (activeDM) { dmChatList.appendChild(el); scrollToBottom(dmChatList.parentElement); }
    else { publicChatList.appendChild(el); scrollToBottom(publicChatList.parentElement); }
    pending.set(tempId, { el });

    try {
      const r = await fetch('/media/upload', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('upload failed');
      const { url, key } = await r.json();

      const media = { kind: 'image', key, url, scope: activeDM ? 'dm' : 'public' };
      if (activeDM) {
        ws.send(JSON.stringify({ type: 'dm', to: activeDM, media, tempId }));
      } else {
        ws.send(JSON.stringify({ type: 'public', media, tempId }));
      }
      setTimeout(() => URL.revokeObjectURL(optimisticMsg.image), 10_000);
    } catch (err) {
      console.error('upload error', err);
      const p = pending.get(tempId);
      if (p) p.el.classList.add('error');
      pending.delete(tempId);
    }
  }

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    sendImageWithCompression(file);
    e.target.value = '';
  });

  // --- WebSocket Handlers ---
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', clientId: CLIENT_ID })));
  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }

    if (msg.type === 'admin-ack') {
      if (msg.ok) {
        // mark admin in memory AND update UI (no race)
        setAdminVisual(true);
        alert('Admin mode enabled');
      } else {
        alert('Admin login failed: ' + (msg.error || 'unknown'));
      }
      return;
    }

    if (msg.type === 'delete-message') {
      const id = Number(msg.messageId);

      // Update DOM if element exists
      const el = document.querySelector(`[data-message-id="${id}"]`);
      if (el) {
        el.classList.add('deleted');
        const content = el.querySelector('.content');
        if (content) content.textContent = '[message deleted]';
      }

      // Update in-memory public cache so re-render keeps deletion
      for (let i = 0; i < publicMessages.length; i++) {
        if (Number(publicMessages[i].messageId) === id) {
          publicMessages[i].deleted = true;
          publicMessages[i].text = '[message deleted]';
          break;
        }
      }

      // Update DM caches (if deletion was a DM)
      for (const [k, arr] of cachedDMs.entries()) {
        for (let i = 0; i < arr.length; i++) {
          if (Number(arr[i].messageId) === id) {
            arr[i].deleted = true;
            arr[i].text = '[message deleted]';
            break;
          }
        }
      }

      // Update pending optimistic items (if any)
      for (const [tempId, p] of pending.entries()) {
        if (p.el && p.el.dataset && Number(p.el.dataset.messageId) === id) {
          p.el.classList.add('deleted');
          const content = p.el.querySelector('.content');
          if (content) content.textContent = '[message deleted]';
        }
      }

      return;
    }


    if (msg.type === 'admin-announce') {
      console.info('ADMIN ANNOUNCE:', msg.text);
      return;
    }

    switch (msg.type) {
      case 'hello-ack':
        if (msg.clientId !== CLIENT_ID) {
          CLIENT_ID = msg.clientId;
          sessionStorage.setItem('annoClientId', CLIENT_ID);
        }
        break;

      case 'public-history':
        publicMessages.push(...msg.messages);
        if (!activeDM) renderPublicChat();
        break;

      case 'dm-threads':
        dmThreads.clear();
        (msg.partners || []).forEach(p => dmThreads.add(p));
        renderDMPanel();
        break;

      case 'public': {
        if (msg.clientId === CLIENT_ID && msg.tempId && pending.has(msg.tempId)) {
          const pendingMsg = pending.get(msg.tempId);
          pendingMsg.el.classList.remove('sending');
          const meta = pendingMsg.el.querySelector('.meta');
          if (meta) meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          pending.delete(msg.tempId);
          publicMessages.push(msg);
          return;
        }
        publicMessages.push(msg);
        if (!activeDM) {
          publicChatList.appendChild(createMessageElement(msg));
          scrollToBottom(publicChatList.parentElement);
        }
        break;
      }

      case 'dm': {
        const partner = msg.from === CLIENT_ID ? msg.to : msg.from;
        const key = dmKey(CLIENT_ID, partner);
        const list = cachedDMs.get(key) || [];
        list.push(msg);
        cachedDMs.set(key, list);

        dmThreads.add(partner);
        renderDMPanel();

        if (msg.echoed && msg.tempId && pending.has(msg.tempId)) {
          const pendingMsg = pending.get(msg.tempId);
          pendingMsg.el.classList.remove('sending');
          const meta = pendingMsg.el.querySelector('.meta');
          if (meta) meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          pending.delete(msg.tempId);
        } else if (activeDM === partner) {
          dmChatList.appendChild(createMessageElement(msg));
          scrollToBottom(dmChatList.parentElement);
        } else if (msg.from !== CLIENT_ID) {
          unreadCounts.set(partner, (unreadCounts.get(partner) || 0) + 1);
          renderDMPanel();
        }
        break;
      }
    }
  });

  // --- UI Event Listeners ---
  if (dmOpenBtn) dmOpenBtn.addEventListener('click', () => { dmPanel.classList.add('open'); renderDMPanel(); });
  if (dmCloseBtn) dmCloseBtn.addEventListener('click', () => dmPanel.classList.remove('open'));
  if (dmBackButton) dmBackButton.addEventListener('click', () => showView('public'));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dmPanel.classList.contains('open')) dmPanel.classList.remove('open');
      else if (activeDM) showView('public');
    }
  });

  // Expose some debug helpers
  window.__anno_showView = showView;
  window.__anno_setAdminVisual = setAdminVisual;
  window.__anno_createAdminBtn = createAdminButtonIfMissing;

  // ensure admin button exists (retry if necessary when DOM not ready)
  if (!window.__anno_adminBtn) {
    // Attempt again once DOMContentLoaded if not present now
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => createAdminButtonIfMissing());
    } else {
      createAdminButtonIfMissing();
    }
  }
})();
