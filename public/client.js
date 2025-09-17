/* ---------- REPLACE public/client.js WITH THIS FILE ---------- */
(function () {
  'use strict';

  // --- Mobile viewport fix ---
  const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
  setVh();
  window.addEventListener('resize', setVh, { passive: true });
  // document.body.style.overflow = 'hidden';

  // --- WebSocket Connection ---
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.hostname}:${window.location.port || (protocol === 'wss' ? 443 : 80)}`);

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



  // client.js
// --- Add this after the DOM Handles section ---

// const publicChatContainer = document.getElementById('public-chat-list').parentElement;
// let isLoadingMore = false; // Prevents sending multiple requests at once
// let hasLoadedAllHistory = false; // Stops trying to load more when we've reached the end

// client.js (Corrected)
// ---------- replace existing scroll listener with this ----------
(function attachPublicScrollHandler() {
  const list = publicChatList || document.getElementById('public-chat-list');
  if (!list) { console.warn('public-chat-list not found'); return; }

  // find the element that's actually scrollable
  let scrollNode = list.closest('.chat-container') || list.parentElement || list;
  let current = scrollNode;
  while (current && current !== document.documentElement) {
    const v = getComputedStyle(current).overflowY;
    if (v === 'auto' || v === 'scroll') { scrollNode = current; break; }
    current = current.parentElement;
  }

  console.log('Attaching public scroll handler to:', scrollNode);
  let isLoadingMore = false;
  let hasLoadedAllHistory = false;

  // put these near your isLoadingMore/hasLoadedAllHistory state (inside the IIFE)
let lastTriggeredAt = 0;
const TRIGGER_DEBOUNCE_MS = 2000; // don't trigger more than once every 2s
const TOP_THRESHOLD_PX = 80; // trigger when within 80px of the top (or bottom for reversed lists)

// ---------- replace / add this function inside attachPublicScrollHandler() ----------
function onPublicScroll() {
  const nowTs = Date.now();
  // raw debug values
  console.log('public scroll (raw):',
    'scrollTop=', scrollNode.scrollTop,
    'clientHeight=', scrollNode.clientHeight,
    'scrollHeight=', scrollNode.scrollHeight
  );

  const first = list.firstElementChild;
  const listStyle = getComputedStyle(list);
  const reversed = (listStyle.flexDirection === 'column-reverse') || list.classList.contains('reversed');

  // compute distance (in px) from top-of-history
  let reachedTop = false;
  let distance = Infinity;

  if (reversed) {
    // For reversed lists the top-of-history is the bottom of the scroll area
    const distanceFromBottom = (scrollNode.scrollHeight - (scrollNode.scrollTop + scrollNode.clientHeight));
    distance = distanceFromBottom;
    console.log('reversed list; distanceFromBottom=', distanceFromBottom);
    reachedTop = distanceFromBottom <= TOP_THRESHOLD_PX;
  } else {
    // Normal list: top-of-history is scrollTop near 0
    const distanceFromTop = scrollNode.scrollTop;
    distance = distanceFromTop;
    console.log('distanceFromTop=', distanceFromTop);

    // fallback: if scrollTop isn't small due to padding, check first <li> position
    if (first) {
      const listRect = scrollNode.getBoundingClientRect();
      const firstRect = first.getBoundingClientRect();
      const firstDelta = firstRect.top - listRect.top;
      console.log('first delta to container top:', firstDelta);
      // if the first element is already visually at/near the top, treat that as reached
      if (firstDelta <= 4) reachedTop = true; // small tolerance
    }

    // accept being "near" the top, not exactly zero
    reachedTop = reachedTop || (distanceFromTop <= TOP_THRESHOLD_PX);
  }

  console.log('reachedTop=', reachedTop, 'reversed=', reversed, 'distance=', distance);

  if (!reachedTop) return;

  if (isLoadingMore) {
    console.log('will not load: isLoadingMore flag set');
    return;
  }
  if (hasLoadedAllHistory) {
    console.log('will not load: hasLoadedAllHistory flag set');
    return;
  }

  if (nowTs - lastTriggeredAt < TRIGGER_DEBOUNCE_MS) {
    console.log('skipping load-more due to debounce (last at', new Date(lastTriggeredAt).toISOString(), ')');
    return;
  }

  const oldestMessage = (publicMessages && publicMessages[0]) || null;
if (!oldestMessage) {
  console.log('no oldestMessage yet — will retry shortly');

  // schedule another check in case history arrives later
  setTimeout(onPublicScroll, 1000);

  return;
}

  // mark last triggered time & set loading flag
  lastTriggeredAt = nowTs;
  isLoadingMore = true;

  console.log('Triggering load-more before:', oldestMessage.timestamp, 'distance=', distance);

  // show loader UI
  const loader = document.createElement('li');
  loader.className = 'loading-indicator';
  loader.textContent = 'Loading history...';
  list.prepend(loader);

  // send your request (use ws variable that exists in the outer scope)
  if (ws && ws.send) {
    try {
      ws.send(JSON.stringify({ type: 'request-more-history', before: oldestMessage.timestamp }));
    } catch (err) {
      console.error('failed to send request-more-history', err);
      // ensure we clear isLoadingMore so future attempts can run
      isLoadingMore = false;
      loader.remove();
    }
  } else {
    console.warn('ws not available; cannot request-more-history');
    isLoadingMore = false;
    loader.remove();
  }
}

// after you attach the listener, run one initial quick check
// (place this line right after: scrollNode.addEventListener('scroll', onPublicScroll, { passive: true }); )
setTimeout(onPublicScroll, 150);

  

  scrollNode.addEventListener('scroll', onPublicScroll, { passive: true });
})();




  // FEED DOM handles
  const feedPage = document.getElementById('feed-page');
  const feedList = document.getElementById('feed-list');
  const feedComposer = document.getElementById('feed-composer');
  const navToggleBtn = document.getElementById('nav-toggle-btn');
  const navToggleBtnFeed = document.getElementById('nav-toggle-btn-feed');

  // --- Universal Composer & Attachment Logic (works for public, feed and dm since they all have .composer-form) ---
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
  let lastNonDmView = 'public'; // remember whether user prefers "public" or "feed"
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
  function createAdminButtonIfMissing() {
    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return null;

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

    topbarRight.appendChild(adminBtn);
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
    window.dispatchEvent(new CustomEvent('anno-admin-state', { detail: { isAdmin: IS_ADMIN } }));
  }

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

  // --- DOM Rendering for messages (unchanged from your implementation) ---
  function createMessageElement(msg) {
    const { text, image, media, clientId, from, tempId, timestamp } = msg;
    const li = document.createElement('li');
    if (msg.messageId) li.dataset.messageId = msg.messageId;
    if (msg.tempId) li.dataset.tempId = msg.tempId;

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

  // --- FEED rendering ---
  function createFeedElement(msg) {
    const li = document.createElement('li');
    li.className = 'feed-item';
    if (msg.messageId) li.dataset.messageId = msg.messageId;
    if (msg.tempId) li.dataset.tempId = msg.tempId;

    const container = document.createElement('div');
    container.className = 'feed-container';

    // media
    // --- inside createFeedElement(msg) where you handle image media ---
if (msg.media && msg.media.kind === 'image') {
  // create wrapper
  const wrap = document.createElement('div');
  wrap.className = 'feed-media-wrap';

  const img = document.createElement('img');
  img.className = 'feed-media';
  img.alt = 'Feed image';
  img.loading = 'lazy';     // lazy load for performance
  img.decoding = 'async';   // async decode for smoother paint
  // sizes hint (optional but helpful)
  img.sizes = '(max-width:720px) 94vw, 720px';

  // set src (either available immediately or via presigned resolver)
  if (msg.media.url) {
    img.src = msg.media.url;
  } else if (msg.media.key) {
    // resolve presigned and assign
    resolvePresignedUrl(msg.media.key).then(url => { img.src = url; }).catch(() => { img.alt = 'Could not load image'; });
  }

  // primary click: open lightbox (instead of navigating away)
  img.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openLightboxForMsg(msg);
  });

  wrap.appendChild(img);
  container.appendChild(wrap);
} else if (msg.media && msg.media.kind === 'video') {
      const v = document.createElement('video');
      v.className = 'feed-media';
      v.controls = true;
      if (msg.media.url) v.src = msg.media.url;
      else resolvePresignedUrl(msg.media.key).then(url => v.src = url).catch(() => { /* ignore */ });
      container.appendChild(v);
    } else {
      // fallback: text preview
      const p = document.createElement('div');
      p.textContent = msg.text || '';
      container.appendChild(p);
    }

    const meta = document.createElement('div');
meta.className = 'feed-meta';

// LEFT: clickable username (opens DM)
const left = document.createElement('div');
const partnerId = msg.clientId || msg.from || null;
const usernameBtn = document.createElement('button');
usernameBtn.className = 'feed-username icon-btn';
usernameBtn.type = 'button';
usernameBtn.textContent = partnerId ? `@${String(partnerId).slice(0,8)}` : '@anon';
usernameBtn.setAttribute('aria-label', partnerId ? `Open DM with ${usernameBtn.textContent}` : 'No DM available');

if (partnerId) {
  // stopPropagation so clicking the username doesn't trigger the feed-item click
  usernameBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openDM(partnerId);
  });
} else {
  usernameBtn.disabled = true;
  usernameBtn.style.opacity = '0.6';
}

// append to left area
left.appendChild(usernameBtn);

// RIGHT: timestamp
const right = document.createElement('div');
right.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

meta.appendChild(left);
meta.appendChild(right);

container.appendChild(meta);
li.appendChild(container);
return li;

  }

  function renderFeed() {
    if (!feedList) return;
    feedList.innerHTML = '';
    // show public messages that include media, newest first
    const mediaMsgs = publicMessages.filter(m => m.media && (m.media.kind === 'image' || m.media.kind === 'video'));
    mediaMsgs.forEach(m => feedList.appendChild(createFeedElement(m)));
    // scroll behaviour: optional — do not force scroll to bottom for feed
  }

  function appendFeedItem(msg) {
    if (!feedList) return;
    if (!(msg.media && (msg.media.kind === 'image' || msg.media.kind === 'video'))) return;
    // insert at top (newest first)
    const el = createFeedElement(msg);
    feedList.insertBefore(el, feedList.firstChild);
  }

  // --- VIEW SWITCHING ---
  function showView(view, partnerId) {
    if (view === 'public') {
      app.setAttribute('data-view', 'public');
      if (feedPage) feedPage.style.display = 'none';
      document.getElementById('public-chat-page').style.display = 'flex';
      document.getElementById('dm-chat-page').style.display = 'none';
      activeDM = null;
      lastNonDmView = 'public';
      if (dmChatTitle) dmChatTitle.textContent = 'Direct Message';
      if (dmChatSubtitle) dmChatSubtitle.textContent = '';
      const inEl = publicComposer.querySelector('.msg-input');
      if (inEl) inEl.focus();
      renderPublicChat();
    } else if (view === 'dm') {
      if (!partnerId) return;
      activeDM = String(partnerId);
      app.setAttribute('data-view', 'dm');
      document.getElementById('public-chat-page').style.display = 'none';
      if (feedPage) feedPage.style.display = 'none';
      document.getElementById('dm-chat-page').style.display = 'flex';
      if (dmChatTitle) dmChatTitle.textContent = `Chat`;
      if (dmChatSubtitle) dmChatSubtitle.textContent = partnerId;
      renderDMConversation(partnerId);
      const inEl = dmComposer.querySelector('.msg-input');
      if (inEl) {
        inEl.value = '';
        dmComposer.querySelector('.send-btn').disabled = true;
        inEl.focus();
      }
    } else if (view === 'feed') {
      app.setAttribute('data-view', 'feed');
      document.getElementById('public-chat-page').style.display = 'none';
      document.getElementById('dm-chat-page').style.display = 'none';
      if (feedPage) feedPage.style.display = 'flex';
      activeDM = null;
      lastNonDmView = 'feed';
      renderFeed();
      const inEl = feedComposer ? feedComposer.querySelector('.msg-input') : null;
      if (inEl) {
        inEl.value = '';
        feedComposer.querySelector('.send-btn').disabled = true;
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
    const composer = activeDM ? dmComposer : (app.getAttribute('data-view') === 'feed' ? feedComposer : publicComposer);
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
      // public
      publicChatList.appendChild(el);
      scrollToBottom(publicChatList.parentElement);
      // if feed visible, also append text-only posts (optional). We only auto-add media to feed; keep text out for clarity.
      ws.send(JSON.stringify({ type: 'public', text, tempId }));
    }

    pending.set(tempId, { el });
    input.value = '';
    composer.querySelector('.send-btn').disabled = true;
  }

  // --- Image upload + compression (updated: also appends optimistic feed item when posting public media) ---
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
    const optimisticMsg = { image: URL.createObjectURL(blob), from: CLIENT_ID, tempId, timestamp: now(), media: { kind: 'image' } };
    const el = createMessageElement(optimisticMsg);
    el.classList.add('sending');

    if (activeDM) {
      dmChatList.appendChild(el); scrollToBottom(dmChatList.parentElement);
    } else {
      publicChatList.appendChild(el); scrollToBottom(publicChatList.parentElement);
      // also append to feed immediately (optimistic)
      appendFeedItem(optimisticMsg);
    }
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
        setAdminVisual(true);
        alert('Admin mode enabled');
      } else {
        alert('Admin login failed: ' + (msg.error || 'unknown'));
      }
      return;
    }

//     // inside your server's ws.on('message', async (msgRaw) => { ... })
// if (msg.type === 'request-more-history') {
//   try {
//     const beforeTimestamp = new Date(msg.before).toISOString();

//     // Query Supabase on the server with your service key
//     const { data: olderRows, error } = await supabase
//       .from('messages')
//       .select('id, from_id, text, media_key, media_url, media_kind, created_at')
//       .eq('kind', 'public')
//       .is('deleted_at', null)
//       .lt('created_at', beforeTimestamp)
//       .order('created_at', { ascending: false })
//       .limit(50);

//     if (error) throw error;

//     const olderMsgs = (olderRows || []).reverse().map(r => ({
//       type: 'public',
//       messageId: r.id,
//       clientId: r.from_id,
//       text: r.text,
//       media: r.media_key
//         ? { kind: r.media_kind, key: r.media_key, url: r.media_url, scope: 'public' }
//         : null,
//       timestamp: new Date(r.created_at).getTime()
//     }));

//     // Send the batch back to the client that requested it
//     ws.send(JSON.stringify({
//       type: 'more-public-history',
//       messages: olderMsgs
//     }));

//   } catch (e) {
//     console.error('Failed to fetch older history:', e);
//     ws.send(JSON.stringify({
//       type: 'more-public-history',
//       messages: []
//     }));
//   }
//   return; // Stop processing after handling this message type
// }


    if (msg.type === 'delete-message') {
      const id = Number(msg.messageId);

      const el = document.querySelector(`[data-message-id="${id}"]`);
      if (el) {
        el.classList.add('deleted');
        const content = el.querySelector('.content');
        if (content) content.textContent = '[message deleted]';
      }

      for (let i = 0; i < publicMessages.length; i++) {
        if (Number(publicMessages[i].messageId) === id) {
          publicMessages[i].deleted = true;
          publicMessages[i].text = '[message deleted]';
          break;
        }
      }

      for (const [k, arr] of cachedDMs.entries()) {
        for (let i = 0; i < arr.length; i++) {
          if (Number(arr[i].messageId) === id) {
            arr[i].deleted = true;
            arr[i].text = '[message deleted]';
            break;
          }
        }
      }

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
        // render both chat and feed (feed shows media items)
        if (!activeDM) renderPublicChat();
        renderFeed();
        break;

      case 'dm-threads':
        dmThreads.clear();
        (msg.partners || []).forEach(p => dmThreads.add(p));
        renderDMPanel();
        break;

      case 'more-public-history': {
        // Remove the loading indicator
        const loader = publicChatList.querySelector('.loading-indicator');
        if (loader) loader.remove();

        if (msg.messages.length === 0) {
          console.log('No more history to load.');
          hasLoadedAllHistory = true;
          isLoadingMore = false;
          return;
        }

       // Use the same scrollNode we attached the listener to
const container = publicChatList.closest('.chat-container') || publicChatList.parentElement;
if (!container) {
  console.warn('No container found for scroll restore');
  return;
}

const oldScrollHeight = container.scrollHeight;

msg.messages.forEach(m => {
  publicMessages.unshift(m);
  const el = createMessageElement(m);
  publicChatList.prepend(el);
});

const newScrollHeight = container.scrollHeight;
container.scrollTop = newScrollHeight - oldScrollHeight;

console.log('[history restore]', {
  oldScrollHeight,
  newScrollHeight,
  finalScrollTop: container.scrollTop
});


        isLoadingMore = false;
        break;
      }


      case 'public': {
        if (msg.clientId === CLIENT_ID && msg.tempId && pending.has(msg.tempId)) {
          const pendingMsg = pending.get(msg.tempId);
          pendingMsg.el.classList.remove('sending');
          const meta = pendingMsg.el.querySelector('.meta');
          if (meta) meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          pending.delete(msg.tempId);
          publicMessages.push(msg);
          // also add to feed if media present
          appendFeedItem(msg);
          return;
        }
        publicMessages.push(msg);
        if (!activeDM) {
          publicChatList.appendChild(createMessageElement(msg));
          scrollToBottom(publicChatList.parentElement);
        }
        // if the public message has media, append it to the feed (keeps feed and public synced)
        if (msg.media && (msg.media.kind === 'image' || msg.media.kind === 'video')) {
          appendFeedItem(msg);
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

  // DM back button should go to whichever view user last used (feed or public)
  if (dmBackButton) dmBackButton.addEventListener('click', () => showView(lastNonDmView || 'public'));

  // nav toggle: public -> feed, feed -> public
  if (navToggleBtn) navToggleBtn.addEventListener('click', () => {
    const current = app.getAttribute('data-view') || 'public';
    if (current === 'feed') showView('public');
    else showView('feed');
  });
  if (navToggleBtnFeed) navToggleBtnFeed.addEventListener('click', () => {
    const current = app.getAttribute('data-view') || 'feed';
    if (current === 'feed') showView('public');
    else showView('feed');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dmPanel.classList.contains('open')) dmPanel.classList.remove('open');
      else if (activeDM) showView(lastNonDmView || 'public');
    }
  });

  // --- Lightbox helpers (simple, self-contained) ---
function ensureLightboxExists() {
  let lb = document.getElementById('lightbox');
  if (lb) return lb;

  lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.className = 'lightbox';
  lb.innerHTML = `
    <button class="close-btn" aria-label="Close">✕</button>
    <img alt="Full-size image" />
  `;
  document.body.appendChild(lb);
  lb.querySelector('.close-btn').addEventListener('click', closeLightbox);
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
  return lb;
}

function openLightboxForMsg(msg) {
  const lb = ensureLightboxExists();
  const imgEl = lb.querySelector('img');

  // If we have a direct URL, use it; otherwise resolve the presigned URL
  if (msg.media && msg.media.url) {
    imgEl.src = msg.media.url;
    lb.classList.add('open');
  } else if (msg.media && msg.media.key) {
    resolvePresignedUrl(msg.media.key).then(url => {
      imgEl.src = url;
      lb.classList.add('open');
    }).catch(() => {
      // fallback: show an error image or message
      imgEl.alt = 'Could not load image';
      lb.classList.add('open');
    });
  } else if (msg.image) {
    // optimistic objectURL (upload preview)
    imgEl.src = msg.image;
    lb.classList.add('open');
  }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  const imgEl = lb.querySelector('img');
  imgEl.removeAttribute('src');
  lb.classList.remove('open');
}


  // Expose debug helpers
  window.__anno_showView = showView;
  window.__anno_setAdminVisual = setAdminVisual;
  window.__anno_createAdminBtn = createAdminButtonIfMissing;

  // ensure admin button exists (retry if necessary when DOM not ready)
  if (!window.__anno_adminBtn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => createAdminButtonIfMissing());
    } else {
      createAdminButtonIfMissing();
    }
  }
})();

// --- Dynamic layout helper for ads/topbar/composer (unchanged) ---
(function () {
  function measureAndApply() {
    try {
      const adEl = document.querySelector('.leaderboard-ad-container, .mobile-ad');
      const topbarEl = document.querySelector('.topbar');
      const composerEl = document.querySelector('.composer-form');

      const adH = adEl ? adEl.getBoundingClientRect().height : 0;
      const topbarH = topbarEl ? topbarEl.getBoundingClientRect().height : 0;
      const composerH = composerEl ? composerEl.getBoundingClientRect().height : 0;

      document.documentElement.style.setProperty('--ad-height', adH + 'px');
      document.documentElement.style.setProperty('--topbar-height', topbarH + 'px');
      document.documentElement.style.setProperty('--composer-height', composerH + 'px');

      if (topbarEl) {
        topbarEl.style.top = adH + 'px';
      }
    } catch (err) {
      console.error('[layout helper] failed:', err);
    }
  }

  window.addEventListener('DOMContentLoaded', measureAndApply);
  window.addEventListener('resize', measureAndApply);
  window.addEventListener('load', measureAndApply);
  setInterval(measureAndApply, 2000);
})();


