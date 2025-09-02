// // public/client.js (Fixed DM view switching + restored title handling)
// (function () {
//   'use strict';

//   // --- Mobile viewport fix ---
//   const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
//   setVh();
//   window.addEventListener('resize', setVh, { passive: true });
//   document.body.style.overflow = 'hidden';

//   // --- WebSocket Connection ---
//   const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
//   const ws = new WebSocket(`${protocol}://${window.location.host}`);

//   // --- DOM Handles ---
//   const app = document.getElementById('app');
//   const fileInput = document.getElementById('fileInput');
//   const publicChatList = document.getElementById('public-chat-list');
//   const publicComposer = document.getElementById('public-composer');
//   const dmChatList = document.getElementById('dm-chat-list');
//   const dmComposer = document.getElementById('dm-composer');
//   const dmChatTitle = document.getElementById('dm-chat-title');      // <- added
//   const dmChatSubtitle = document.getElementById('dm-chat-subtitle');
//   const dmBackButton = document.getElementById('dm-back-btn');
//   const dmPanel = document.getElementById('dm-panel');
//   const dmOpenBtn = document.querySelector('.dm-open-btn');
//   const dmCloseBtn = document.getElementById('dm-close');
//   const dmThreadsEl = document.getElementById('dm-threads');

//   // --- Universal Composer & Attachment Logic ---
//   document.querySelectorAll('.composer-form').forEach(form => {
//     const input = form.querySelector('.msg-input');
//     const sendBtn = form.querySelector('.send-btn');
//     const attachBtn = form.querySelector('.attach');
//     if (attachBtn) attachBtn.addEventListener('click', () => fileInput.click());
//     form.addEventListener('submit', (e) => { e.preventDefault(); sendTextMessage(); });
//     if(input && sendBtn) {
//         input.addEventListener('input', () => { sendBtn.disabled = input.value.trim() === ''; });
//         input.addEventListener('keydown', (e) => {
//             if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
//         });
//     }
//   });

//   // --- State ---
//   let CLIENT_ID = sessionStorage.getItem('annoClientId');
//   if (!CLIENT_ID) {
//     CLIENT_ID = 'c_' + Math.random().toString(36).slice(2, 9);
//     sessionStorage.setItem('annoClientId', CLIENT_ID);
//   }
//   const pending = new Map();
//   const publicMessages = [];
//   const cachedDMs = new Map();
//   const dmThreads = new Set();
//   const unreadCounts = new Map();
//   let activeDM = null;

//   // --- Utilities ---
//   const dmKey = (a, b) => [a, b].sort().join('|');
//   const now = () => Date.now();
//   const scrollToBottom = (container) => {
//       if(container) setTimeout(() => container.scrollTop = container.scrollHeight, 50);
//   }

//   // --- Presigned cache (must be before resolver) ---
//   const presignedCache = new Map(); // key -> { url, expiresAt }

//   async function resolvePresignedUrl(key) {
//     // cache entries for ~4 minutes
//     const cached = presignedCache.get(key);
//     if (cached && cached.expiresAt > Date.now()) return cached.url;
  
//     const resp = await fetch(`/media/signed-url?key=${encodeURIComponent(key)}`, {
//       headers: { 'X-Client-Id': CLIENT_ID } // server uses this to validate DM membership
//     });
//     if (!resp.ok) throw new Error('failed to get signed url');
//     const { url } = await resp.json();
//     // store with expiry ~4m
//     presignedCache.set(key, { url, expiresAt: Date.now() + (4 * 60 * 1000) });
//     return url;
//   }
  

//   // --- DOM Rendering ---
//   function createMessageElement(msg) {
//     const { text, image, media, clientId, from, tempId, timestamp } = msg;
//     const li = document.createElement('li');
//     const senderId = from || clientId;
//     li.className = 'message ' + (senderId === CLIENT_ID ? 'sent' : 'received');
//     if (tempId) li.dataset.tempId = tempId;

//     if (senderId && senderId !== CLIENT_ID) {
//       const idBtn = document.createElement('button');
//       idBtn.className = 'user-id-btn';
//       idBtn.textContent = senderId;
//       idBtn.title = 'Open DM with ' + senderId;
//       idBtn.onclick = () => openDM(senderId);
//       li.appendChild(idBtn);
//     }

//     const content = document.createElement('div');
//     content.className = 'content';

//     // MEDIA handling
//     if (media && media.kind) {
//       if (media.kind === 'image') {
//         const img = document.createElement('img');
//         img.alt = 'Shared image';
//         img.className = 'chat-image blurred';
//         img.onclick = () => img.classList.remove('blurred');

//         // If server returned an immediate public URL (public images), use it:
//         if (media.url) {
//           img.src = media.url;
//         } else {
//           // for DM/private images, get a presigned URL
//           resolvePresignedUrl(media.key).then(url => {
//             img.src = url;
//           }).catch(err => {
//             console.error('failed to get signed url', err);
//             img.alt = 'Could not load image';
//           });
//         }
//         content.appendChild(img);

//       } else if (media.kind === 'video') {
//         const vid = document.createElement('video');
//         vid.controls = true;
//         vid.preload = 'metadata';
//         // If public URL returned:
//         if (media.url) {
//           vid.src = media.url;
//         } else {
//           resolvePresignedUrl(media.key).then(url => { vid.src = url; }).catch(() => { vid.alt = 'Could not load video'; });
//         }
//         content.appendChild(vid);
//       }
//     } else if (image) {
//       // legacy base64 path
//       const img = document.createElement('img');
//       img.src = image;
//       img.className = 'chat-image blurred';
//       img.alt = 'Shared image';
//       img.onclick = () => img.classList.remove('blurred');
//       content.appendChild(img);
//     } else if (text) {
//       content.textContent = String(text ?? '');
//     }

//     li.appendChild(content);

//     const meta = document.createElement('span');
//     meta.className = 'meta';
//     meta.textContent = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
//     li.appendChild(meta);

//     return li;
//   }


//   function renderPublicChat() {
//     publicChatList.innerHTML = '';
//     publicMessages.forEach(msg => publicChatList.appendChild(createMessageElement(msg)));
//     scrollToBottom(publicChatList.parentElement);
//   }

//   function renderDMConversation(partnerId) {
//     dmChatList.innerHTML = '';
//     const key = dmKey(CLIENT_ID, partnerId);
//     const messages = cachedDMs.get(key) || [];
//     messages.forEach(msg => dmChatList.appendChild(createMessageElement(msg)));
//     unreadCounts.delete(partnerId);
//     renderDMPanel();
//     scrollToBottom(dmChatList.parentElement);
//   }
  
//   function renderDMPanel() {
//     if (!dmPanel) return;
//     dmThreadsEl.innerHTML = '';
//     const threads = Array.from(dmThreads);
//     if (threads.length > 0) {
//       threads.forEach(p => {
//         const unread = unreadCounts.get(p) || 0;
//         const row = document.createElement('div');
//         row.className = 'dm-thread';
//         row.innerHTML = `<span>${p}</span><span class="dm-thread-meta">${unread > 0 ? `${unread} new` : ''}</span>`;
//         row.onclick = () => { openDM(p); dmPanel.classList.remove('open'); };
//         dmThreadsEl.appendChild(row);
//       });
//     } else { dmThreadsEl.innerHTML = `<div class="dm-empty">No active DMs. Click a user's ID to start one.</div>`; }
//   }
  
//   // --- VIEW SWITCHING (fixed) ---
//   function showView(view, partnerId) {
//     if (view === 'public') {
//       app.setAttribute('data-view', 'public');
//       activeDM = null;
//       // reset DM header
//       if (dmChatTitle) dmChatTitle.textContent = 'Direct Message';
//       if (dmChatSubtitle) dmChatSubtitle.textContent = '';
//       // enable/disable send buttons are handled by composer input listeners
//       // optionally focus public composer input
//       const inEl = publicComposer.querySelector('.msg-input');
//       if (inEl) inEl.focus();
//       // re-render public list just in case
//       renderPublicChat();
//     } else if (view === 'dm') {
//       if (!partnerId) return;
//       activeDM = String(partnerId);
//       app.setAttribute('data-view', 'dm');
//       // set DM header/subtitle
//       if (dmChatTitle) dmChatTitle.textContent = `Chat`;
//       if (dmChatSubtitle) dmChatSubtitle.textContent = partnerId;
//       // show cached messages for this DM
//       renderDMConversation(partnerId);
//       // focus DM composer input
//       const inEl = dmComposer.querySelector('.msg-input');
//       if (inEl) {
//         inEl.value = '';
//         dmComposer.querySelector('.send-btn').disabled = true;
//         inEl.focus();
//       }
//     }
//   }

//   // --- Actions ---
//   function openDM(partnerId) {
//     if (!partnerId) return;
//     if (partnerId === CLIENT_ID) return;
//     showView('dm', partnerId);
//   }

//   function sendTextMessage() {
//     const composer = activeDM ? dmComposer : publicComposer;
//     const input = composer.querySelector('.msg-input');
//     const text = (input.value || '').trim();
//     if (!text) return;

//     const tempId = 't_' + now() + '_' + Math.random().toString(36).slice(2, 6);
//     const optimisticMsg = { text, from: CLIENT_ID, tempId, timestamp: now() };
//     const el = createMessageElement(optimisticMsg);
//     el.classList.add('sending');

//     if (activeDM) {
//       dmChatList.appendChild(el);
//       scrollToBottom(dmChatList.parentElement);
//       ws.send(JSON.stringify({ type: 'dm', to: activeDM, text, tempId }));
//     } else {
//       publicChatList.appendChild(el);
//       scrollToBottom(publicChatList.parentElement);
//       ws.send(JSON.stringify({ type: 'public', text, tempId }));
//     }

//     pending.set(tempId, { el });
//     input.value = '';
//     composer.querySelector('.send-btn').disabled = true;
//   }
  
//   async function sendImageWithCompression(file) {
//     const MAX_WIDTH = 720;
//     // load into bitmap for better memory usage
//     const bitmap = await createImageBitmap(file);
//     const scale = Math.min(1, MAX_WIDTH / bitmap.width);
//     const w = Math.round(bitmap.width * scale);
//     const h = Math.round(bitmap.height * scale);
  
//     const canvas = document.createElement('canvas');
//     canvas.width = w; canvas.height = h;
//     const ctx = canvas.getContext('2d');
//     ctx.drawImage(bitmap, 0, 0, w, h);
  
//     const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.5));
  
//     // Build multipart body (includes scope/dmKey)
//     const fd = new FormData();
//     fd.append('file', blob, file.name.replace(/\s+/g, '_'));
//     fd.append('scope', activeDM ? 'dm' : 'public');
//     if (activeDM) fd.append('dmKey', dmKey(CLIENT_ID, activeDM));
  
//     // show optimistic UI
//     const tempId = 'img_' + now() + '_' + Math.random().toString(36).slice(2,6);
//     const optimisticMsg = { image: URL.createObjectURL(blob), from: CLIENT_ID, tempId, timestamp: now() };
//     const el = createMessageElement(optimisticMsg);
//     el.classList.add('sending');
  
//     if (activeDM) { dmChatList.appendChild(el); scrollToBottom(dmChatList.parentElement); }
//     else { publicChatList.appendChild(el); scrollToBottom(publicChatList.parentElement); }
//     pending.set(tempId, { el });

//     try {
//       const r = await fetch('/media/upload', { method: 'POST', body: fd });
//       if (!r.ok) throw new Error('upload failed');
//       const { url, key } = await r.json();
  
//       // send only the small JSON over WS (media metadata)
//       const media = { kind: 'image', key, url, scope: activeDM ? 'dm' : 'public' };
//       if (activeDM) {
//         ws.send(JSON.stringify({ type: 'dm', to: activeDM, media, tempId }));
//       } else {
//         ws.send(JSON.stringify({ type: 'public', media, tempId }));
//       }

//       // optional: revoke optimistic blob URL after a short while to free memory
//       setTimeout(() => URL.revokeObjectURL(optimisticMsg.image), 10_000);
//     } catch (err) {
//       console.error('upload error', err);
//       // show error on optimistic element
//       const p = pending.get(tempId);
//       if (p) p.el.classList.add('error');
//       pending.delete(tempId);
//     }
//   }
  

//   fileInput.addEventListener('change', (e) => {
//     const file = e.target.files[0];
//     if (!file || !file.type.startsWith('image/')) return;
//     sendImageWithCompression(file);
//     e.target.value = '';
//   });
  
//   // --- WebSocket Handlers ---
//   ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', clientId: CLIENT_ID })));
//   ws.addEventListener('message', (evt) => {
//     let msg;
//     try { msg = JSON.parse(evt.data); } 
//     catch (e) { return; }

//     switch (msg.type) {
//       case 'hello-ack':
//         if (msg.clientId !== CLIENT_ID) {
//           CLIENT_ID = msg.clientId;
//           sessionStorage.setItem('annoClientId', CLIENT_ID);
//         }
//         break;

//       case 'public-history':
//         publicMessages.push(...msg.messages);
//         if(!activeDM) renderPublicChat();
//         break;

//       case 'dm-threads':
//         dmThreads.clear();
//         (msg.partners || []).forEach(p => dmThreads.add(p));
//         renderDMPanel();
//         break;
      
//       case 'public': {
//         // ✨ --- DOUBLE-MESSAGE BUG FIX --- ✨
//         // If this is the echo of our own message, update its status and stop.
//         if (msg.clientId === CLIENT_ID && msg.tempId && pending.has(msg.tempId)) {
//           const pendingMsg = pending.get(msg.tempId);
//           pendingMsg.el.classList.remove('sending');
//           // Optionally update the timestamp on the optimistic message
//           const meta = pendingMsg.el.querySelector('.meta');
//           if (meta) {
//               meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
//           }
//           pending.delete(msg.tempId);
//           publicMessages.push(msg); // Add the final message to history
//           return; // Exit here to prevent rendering a duplicate message
//         }

//         // Otherwise, it's a message from someone else, so render it.
//         publicMessages.push(msg);
//         if (!activeDM) {
//           publicChatList.appendChild(createMessageElement(msg));
//           scrollToBottom(publicChatList.parentElement);
//         }
//         break;
//       }

//       case 'dm': {
//         const partner = msg.from === CLIENT_ID ? msg.to : msg.from;
//         const key = dmKey(CLIENT_ID, partner);
//         const list = cachedDMs.get(key) || [];
//         list.push(msg);
//         cachedDMs.set(key, list);

//         // Update in-memory threads set so panel shows active DMs
//         dmThreads.add(partner);
//         renderDMPanel();

//         if (msg.echoed && msg.tempId && pending.has(msg.tempId)) {
//           const pendingMsg = pending.get(msg.tempId);
//           pendingMsg.el.classList.remove('sending');
//           const meta = pendingMsg.el.querySelector('.meta');
//           if (meta) {
//             meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
//           }
//           pending.delete(msg.tempId);
//         } else if (activeDM === partner) {
//           dmChatList.appendChild(createMessageElement(msg));
//           scrollToBottom(dmChatList.parentElement);
//         } else if (msg.from !== CLIENT_ID) {
//           unreadCounts.set(partner, (unreadCounts.get(partner) || 0) + 1);
//           renderDMPanel();
//         }
//         break;
//       }
//     }
//   });

//   // --- UI Event Listeners ---
//   dmOpenBtn.addEventListener('click', () => { dmPanel.classList.add('open'); renderDMPanel(); });
//   dmCloseBtn.addEventListener('click', () => dmPanel.classList.remove('open'));
//   dmBackButton.addEventListener('click', () => showView('public'));
//   window.addEventListener('keydown', (e) => {
//     if (e.key === 'Escape') {
//       if (dmPanel.classList.contains('open')) dmPanel.classList.remove('open');
//       else if (activeDM) showView('public');
//     }
//   });

//   // expose showView for debugging in console
//   window.__anno_showView = showView;
// })();
