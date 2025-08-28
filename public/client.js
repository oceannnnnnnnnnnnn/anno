// public/client.js (Updated)
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
    if(input && sendBtn) {
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

  // --- Utilities ---
  const dmKey = (a, b) => [a, b].sort().join('|');
  const now = () => Date.now();
  const scrollToBottom = (container) => {
      if(container) setTimeout(() => container.scrollTop = container.scrollHeight, 50);
  }

  // --- View Management ---
  function showView(view, partnerId = null) {
    if (view === 'dm') {
      activeDM = partnerId;
      dmChatSubtitle.textContent = `with ${partnerId}`;
      app.dataset.view = 'dm';
      renderDMConversation(partnerId);
    } else {
      activeDM = null;
      app.dataset.view = 'public';
      renderPublicChat();
    }
  }

  // --- DOM Rendering ---
  function createMessageElement({ text, image, clientId, from, tempId, timestamp }) {
    const li = document.createElement('li');
    const senderId = from || clientId;
    li.className = 'message ' + (senderId === CLIENT_ID ? 'sent' : 'received');
    if (tempId) li.dataset.tempId = tempId;

    if (senderId && senderId !== CLIENT_ID) {
      const idBtn = document.createElement('button');
      idBtn.className = 'user-id-btn';
      idBtn.textContent = senderId;
      idBtn.title = 'Open DM with ' + senderId;
      idBtn.onclick = () => openDM(senderId);
      li.appendChild(idBtn);
    }

    if (image) {
      const img = document.createElement('img');
      img.src = image;
      // ✨ --- BLUR FUNCTIONALITY RESTORED --- ✨
      img.className = 'chat-image blurred';
      img.alt = 'Shared image';
      img.onclick = () => img.classList.remove('blurred');
      li.appendChild(img);
    } else {
      const body = document.createElement('div');
      body.className = 'text';
      body.textContent = String(text ?? '');
      li.appendChild(body);
    }

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
  
  // --- Actions ---
  function openDM(partnerId) {
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
  
  function sendImageWithCompression(file) {
      const MAX_WIDTH = 800;
      const reader = new FileReader();
      reader.onload = (e) => {
          const img = document.createElement("img");
          img.onload = () => {
              const canvas = document.createElement('canvas');
              const scale = Math.min(1, MAX_WIDTH / img.width);
              canvas.width = img.width * scale;
              canvas.height = img.height * scale;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL(file.type, 0.85);
              const tempId = 'img_' + now() + '_' + Math.random().toString(36).slice(2, 6);
              const optimisticMsg = { image: dataUrl, from: CLIENT_ID, tempId, timestamp: now() };
              const el = createMessageElement(optimisticMsg);
              el.classList.add('sending');
              
              if (activeDM) {
                  dmChatList.appendChild(el);
                  scrollToBottom(dmChatList.parentElement);
                  ws.send(JSON.stringify({ type: 'dm', to: activeDM, image: dataUrl, tempId }));
              } else {
                  publicChatList.appendChild(el);
                  scrollToBottom(publicChatList.parentElement);
                  ws.send(JSON.stringify({ type: 'public', image: dataUrl, tempId }));
              }
              pending.set(tempId, { el });
          };
          img.src = e.target.result;
      };
      reader.readAsDataURL(file);
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
    try { msg = JSON.parse(evt.data); } 
    catch (e) { return; }

    switch (msg.type) {
      case 'hello-ack':
        if (msg.clientId !== CLIENT_ID) {
          CLIENT_ID = msg.clientId;
          sessionStorage.setItem('annoClientId', CLIENT_ID);
        }
        break;

      case 'public-history':
        publicMessages.push(...msg.messages);
        if(!activeDM) renderPublicChat();
        break;

      case 'dm-threads':
        dmThreads.clear();
        (msg.partners || []).forEach(p => dmThreads.add(p));
        renderDMPanel();
        break;
      
      case 'public': {
        // ✨ --- DOUBLE-MESSAGE BUG FIX --- ✨
        // If this is the echo of our own message, update its status and stop.
        if (msg.clientId === CLIENT_ID && msg.tempId && pending.has(msg.tempId)) {
          const pendingMsg = pending.get(msg.tempId);
          pendingMsg.el.classList.remove('sending');
          // Optionally update the timestamp on the optimistic message
          const meta = pendingMsg.el.querySelector('.meta');
          if (meta) {
              meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }
          pending.delete(msg.tempId);
          publicMessages.push(msg); // Add the final message to history
          return; // Exit here to prevent rendering a duplicate message
        }

        // Otherwise, it's a message from someone else, so render it.
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

        if (msg.echoed && msg.tempId && pending.has(msg.tempId)) {
          const pendingMsg = pending.get(msg.tempId);
          pendingMsg.el.classList.remove('sending');
          const meta = pendingMsg.el.querySelector('.meta');
          if (meta) {
            meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }
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
  dmOpenBtn.addEventListener('click', () => { dmPanel.classList.add('open'); renderDMPanel(); });
  dmCloseBtn.addEventListener('click', () => dmPanel.classList.remove('open'));
  dmBackButton.addEventListener('click', () => showView('public'));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dmPanel.classList.contains('open')) dmPanel.classList.remove('open');
      else if (activeDM) showView('public');
    }
  });
})();