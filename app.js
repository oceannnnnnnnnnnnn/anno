// app.js
require('dotenv').config();

// ---------- Startup / Config sanity checks ----------
const REQUIRED_ENVS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'R2_BUCKET'];
REQUIRED_ENVS.forEach(k => {
  if (!process.env[k]) console.warn(`⚠️  Env missing: ${k}`);
});

const ADMIN_KEY = process.env.ADMIN_KEY || null;
if (!ADMIN_KEY) console.warn('⚠️  ADMIN_KEY is not set. Admin functionality will be disabled.');

// ---------- Utilities ----------
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

function normalizeIp(raw) {
  if (!raw) return null;
  raw = String(raw);
  // x-forwarded-for can include multiple IPs, take first
  if (raw.includes(',')) raw = raw.split(',')[0].trim();
  // IPv4-mapped IPv6 like ::ffff:127.0.0.1
  if (raw.startsWith('::ffff:')) return raw.replace('::ffff:', '');
  // strip zone id from IPv6 (fe80::1%lo0)
  const pct = raw.indexOf('%');
  if (pct !== -1) raw = raw.slice(0, pct);
  return raw;
}

// ---------- Express + WebSocket setup ----------
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, perMessageDeflate: {} });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Supabase client ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env — exiting.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ---------- Mount media router (upload/signed url) ----------
const uploadRouter = require('./routes/upload');
app.use('/media', uploadRouter);

// ---------- Moderation / Ban helpers ----------
let bannedIpCache = new Set();

async function loadBanCacheFromDb() {
  try {
    const { data, error } = await supabase.from('banned_ips').select('ip');
    if (error) {
      console.error('Failed to load banned_ips from DB', error);
      return;
    }
    bannedIpCache = new Set((data || []).map(r => r.ip));
    console.log(`[BAN CACHE] loaded ${bannedIpCache.size} IP(s).`);
  } catch (e) {
    console.error('loadBanCacheFromDb exception', e);
  }
}

async function persistBan(ip, moderatorId = null, reason = null) {
  try {
    const payload = { ip, reason, banned_by: moderatorId, created_at: new Date().toISOString() };
    const { error } = await supabase.from('banned_ips').upsert(payload, { onConflict: 'ip' });
    if (error) throw error;
    bannedIpCache.add(ip);
    await supabase.from('moderation_log').insert({
      action: 'ban',
      target_ip: ip,
      moderator_id: moderatorId,
      reason,
      created_at: new Date().toISOString()
    });
    console.log(`[BAN] persisted ${ip}`);
  } catch (e) {
    console.error('persistBan error', e);
  }
}

async function persistUnban(ip, moderatorId = null, reason = null) {
  try {
    const { error } = await supabase.from('banned_ips').delete().eq('ip', ip);
    if (error) throw error;
    bannedIpCache.delete(ip);
    await supabase.from('moderation_log').insert({
      action: 'unban',
      target_ip: ip,
      moderator_id: moderatorId,
      reason,
      created_at: new Date().toISOString()
    });
    console.log(`[UNBAN] ${ip}`);
  } catch (e) {
    console.error('persistUnban error', e);
  }
}

async function logModeration(action, details) {
  try {
    await supabase.from('moderation_log').insert({ action, ...details, created_at: new Date().toISOString() });
  } catch (e) {
    console.error('logModeration error', e);
  }
}

// Warm the ban cache
loadBanCacheFromDb();
setInterval(loadBanCacheFromDb, Number(process.env.BAN_CACHE_REFRESH_MS || 30_000));

// ---------- Simple IP block middleware for HTTP endpoints ----------
const blockedIpsEnv = (process.env.BLOCKED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const ip = normalizeIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
  if (!ip) return next();
  if (bannedIpCache.has(ip) || blockedIpsEnv.includes(ip)) {
    console.log(`[HTTP BLOCK] ${ip} blocked`);
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
});

// ---------- Database helpers for messages (returns inserted row) ----------
async function insertPublicMessage({ fromId, text, media }) {
  try {
    const payload = {
      kind: 'public',
      from_id: fromId,
      text: text || null,
      media_key: media?.key || null,
      media_url: media?.url || null,
      media_kind: media?.kind || null,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('messages').insert(payload).select('id, created_at').single();
    if (error) {
      console.error('insertPublicMessage error:', error);
      return null;
    }
    return data;
  } catch (e) {
    console.error('insertPublicMessage exception:', e);
    return null;
  }
}

async function insertDMMessage({ dmKeyVal, fromId, toId, text, media }) {
  try {
    const payload = {
      kind: 'dm',
      dm_key: dmKeyVal,
      from_id: fromId,
      to_id: toId,
      text: text || null,
      media_key: media?.key || null,
      media_url: media?.url || null,
      media_kind: media?.kind || null,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('messages').insert(payload).select('id, created_at').single();
    if (error) {
      console.error('insertDMMessage error:', error);
      return null;
    }
    return data;
  } catch (e) {
    console.error('insertDMMessage exception:', e);
    return null;
  }
}

// Ensure DM thread exists (upsert into dm_threads)
async function ensureDMThreadExists(dmKeyVal, a, b) {
  try {
    const payload = {
      dm_key: dmKeyVal,
      user_a: a < b ? a : b,
      user_b: a < b ? b : a
    };
    const { error } = await supabase.from('dm_threads').upsert(payload, { onConflict: 'dm_key' });
    if (error) console.error('ensureDMThreadExists error:', error);
  } catch (e) {
    console.error('ensureDMThreadExists exception:', e);
  }
}

// ---------- Runtime in-memory maps ----------
const sockets = new Map();         // clientId -> ws
const chatHistory = [];           // recent public messages (in-memory)
const dmHistory = new Map();      // dmKey -> [messages]
const dmThreadsMemory = new Map(); // clientId -> Set(partnerIds)
global.__dmThreads = dmThreadsMemory; // compatibility for any other modules

const MESSAGE_LIFETIME = 24 * 60 * 60 * 1000;
const dmKey = (a, b) => [a, b].sort().join('|');
const now = () => Date.now();

function sendTo(clientId, dataObj) {
  const ws = sockets.get(clientId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(dataObj));
  }
}

function broadcast(dataObj) {
  const payload = JSON.stringify(dataObj);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

// ---------- WebSocket handling ----------
wss.on('connection', (ws, req) => {
  // capture and normalize IP
  const ip = normalizeIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
  ws._clientIp = ip || 'unknown';
  ws._isAdmin = false;       // will be set to true if admin login succeeds
  ws._adminId = null;        // admin client id after handshake

  let myClientId = null;

  console.log(`[SOCKET CONNECT] IP: ${ws._clientIp}`);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    // ----- ADMIN LOGIN HANDLER (works pre- or post-hello) -----
    if (msg.type === 'admin-login') {
      if (!ADMIN_KEY) {
        ws.send(JSON.stringify({ type: 'admin-ack', ok: false, error: 'admin_disabled' }));
        console.warn(`[ADMIN LOGIN attempt] admin disabled, conn IP: ${ws._clientIp}`);
        return;
      }
      if (String(msg.key) === String(ADMIN_KEY)) {
        ws._isAdmin = true;
        // If client already has a clientId (sent hello earlier), link adminId
        if (myClientId) { ws._adminId = myClientId; await logModeration('admin_login', { moderator_id: ws._adminId }); }
        ws.send(JSON.stringify({ type: 'admin-ack', ok: true, adminId: ws._adminId || null }));
        console.log(`[ADMIN LOGIN success] conn IP: ${ws._clientIp}, clientId: ${myClientId || 'not-yet-known'}`);
      } else {
        ws.send(JSON.stringify({ type: 'admin-ack', ok: false, error: 'invalid_key' }));
        console.warn(`[ADMIN LOGIN failed] conn IP: ${ws._clientIp}`);
      }
      return;
    }

    // If admin action attempted by a non-admin, reject early
    if (msg.type && msg.type.startsWith('admin-') && !ws._isAdmin) {
      console.warn(`[ADMIN ATTEMPT] non-admin attempted ${msg.type} from IP ${ws._clientIp} (client ${myClientId})`);
      ws.send(JSON.stringify({ type: 'admin-error', error: 'not-authorized' }));
      return;
    }

    // ----- handshake hello -----
    if (msg.type === 'hello') {
      myClientId = String(msg.clientId || ('s_' + Math.random().toString(36).slice(2, 9)));
      sockets.set(myClientId, ws);
      ws._clientId = myClientId;
      if (ws._isAdmin) {
        ws._adminId = myClientId;
        await logModeration('admin_login', { moderator_id: myClientId });
        console.log(`[ADMIN registered] ${myClientId} (IP: ${ws._clientIp})`);
      }
      console.log(`[HELLO] ClientId: ${myClientId}, IP: ${ws._clientIp}`);

      // ensure memory set exists
      if (!dmThreadsMemory.has(myClientId)) dmThreadsMemory.set(myClientId, new Set());

      // send ack + thread list + recent public history
      sendTo(myClientId, { type: 'hello-ack', clientId: myClientId });
      sendTo(myClientId, { type: 'dm-threads', partners: Array.from(dmThreadsMemory.get(myClientId) || []) });

      // async load persisted dm threads
      (async () => {
        try {
          const { data: threads } = await supabase.from('dm_threads').select('dm_key, user_a, user_b')
            .or(`user_a.eq.${myClientId},user_b.eq.${myClientId}`);
          if (Array.isArray(threads)) {
            const partners = [];
            threads.forEach(t => {
              const partner = (t.user_a === myClientId) ? t.user_b : t.user_a;
              partners.push(partner);
              const set = dmThreadsMemory.get(myClientId) || new Set();
              set.add(partner);
              dmThreadsMemory.set(myClientId, set);
            });
            sendTo(myClientId, { type: 'dm-threads', partners });
          }
        } catch (e) { console.error('load dm threads error', e); }
      })();

      // async load public messages from DB
            // async load public messages from DB
            (async () => {
              try {
                const { data: pubRows } = await supabase.from('messages')
                  .select('id, from_id, text, media_key, media_url, media_kind, created_at')
                  .eq('kind', 'public')
                  .is('deleted_at', null)                       // <-- NEW: exclude soft-deleted rows
                  .order('created_at', { ascending: false })
                  .limit(100);
      
                if (Array.isArray(pubRows)) {
                  const publicMsgs = pubRows.reverse().map(r => ({
                    type: 'public',
                    messageId: r.id,
                    clientId: r.from_id,
                    text: r.text,
                    media: r.media_key ? { kind: r.media_kind, key: r.media_key, url: r.media_url, scope: 'public' } : null,
                    timestamp: new Date(r.created_at).getTime()
                  }));
                  sendTo(myClientId, { type: 'public-history', messages: publicMsgs });
                } else {
                  const recentHistory = chatHistory.filter(item => now() - item.timestamp <= MESSAGE_LIFETIME);
                  sendTo(myClientId, { type: 'public-history', messages: recentHistory });
                }
              } catch (e) {
                console.error('load public history error', e);
              }
            })();
      

      return;
    }

    // require handshake for further actions
    if (!myClientId) {
      console.warn(`No handshake yet, ignoring message from IP ${ws._clientIp}`);
      return;
    }

    msg.timestamp = now();

    // Log all messages with client id and IP for audit
    console.log(`[MESSAGE] ClientId: ${myClientId}, IP: ${ws._clientIp}, Type: ${msg.type}, Text: ${msg.text ? msg.text.slice(0,200) : '[media]'} `);

    // ---------- Admin actions (only if ws._isAdmin true) ----------
    if (msg.type === 'admin-delete-message') {
      const messageId = Number(msg.messageId);
      if (!messageId) {
        ws.send(JSON.stringify({ type: 'admin-error', error: 'missing_message_id' }));
        return;
      }
      try {
        // Soft-delete in DB
        const { error } = await supabase
          .from('messages')
          .update({ deleted_at: new Date().toISOString(), deleted_by: ws._adminId || myClientId })
          .eq('id', messageId);
        if (error) throw error;
    
        // Remove from in-memory public chatHistory so we don't re-send it later
        for (let i = chatHistory.length - 1; i >= 0; i--) {
          if (Number(chatHistory[i].messageId) === messageId) {
            chatHistory.splice(i, 1);
          }
        }
    
        // Remove / mark in DM in-memory history as well
        for (const [dmk, arr] of dmHistory.entries()) {
          for (let i = arr.length - 1; i >= 0; i--) {
            if (Number(arr[i].messageId) === messageId) {
              arr.splice(i, 1);
            }
          }
          if (arr.length === 0) dmHistory.delete(dmk);
          else dmHistory.set(dmk, arr);
        }
    
        // Broadcast delete to clients so they update DOM/caches
        broadcast({ type: 'delete-message', messageId });
    
        await logModeration('delete_message', { message_id: messageId, moderator_id: ws._adminId || myClientId });
        ws.send(JSON.stringify({ type: 'admin-ok', action: 'delete', messageId }));
        console.log(`[ADMIN DELETE] message ${messageId} by ${ws._adminId || myClientId}`);
      } catch (e) {
        console.error('admin-delete-message error', e);
        ws.send(JSON.stringify({ type: 'admin-error', error: 'delete_failed' }));
      }
      return;
    }
    

    if (msg.type === 'admin-ban') {
      // msg.targetId OR msg.ip should be provided. If targetId present, we map to ip.
      try {
        let ipToBan = msg.ip || null;
        if (!ipToBan && msg.targetId) {
          const targetSocket = sockets.get(String(msg.targetId));
          ipToBan = targetSocket ? targetSocket._clientIp : null;
        }
        if (!ipToBan) { ws.send(JSON.stringify({ type: 'admin-error', error: 'missing_ip_or_target' })); return; }
        await persistBan(ipToBan, ws._adminId || myClientId, msg.reason || null);
        // close sockets matching that IP
        sockets.forEach((s, cid) => { if (s._clientIp === ipToBan) s.close(4003, 'Banned by admin'); });
        broadcast({ type: 'admin-notice', text: `A user/IP has been banned by a moderator.` });
        await logModeration('ban', { target_id: msg.targetId || null, target_ip: ipToBan, moderator_id: ws._adminId || myClientId, reason: msg.reason || null });
        ws.send(JSON.stringify({ type: 'admin-ok', action: 'ban', ip: ipToBan }));
        console.log(`[ADMIN BAN] ${msg.targetId || 'unknown'} @ ${ipToBan} by ${ws._adminId || myClientId}`);
      } catch (e) {
        console.error('admin-ban error', e);
        ws.send(JSON.stringify({ type: 'admin-error', error: 'ban_failed' }));
      }
      return;
    }

    if (msg.type === 'admin-kick') {
      try {
        const targetClientId = String(msg.targetId);
        if (!targetClientId) { ws.send(JSON.stringify({ type: 'admin-error', error: 'missing_target' })); return; }
        const targetSocket = sockets.get(targetClientId);
        if (targetSocket) {
          targetSocket.close(4004, 'Kicked by admin');
          await logModeration('kick', { target_id: targetClientId, moderator_id: ws._adminId || myClientId, reason: msg.reason || null });
          ws.send(JSON.stringify({ type: 'admin-ok', action: 'kick', target: targetClientId }));
          console.log(`[ADMIN KICK] ${targetClientId} by ${ws._adminId || myClientId}`);
        } else {
          ws.send(JSON.stringify({ type: 'admin-error', error: 'target_not_found' }));
        }
      } catch (e) {
        console.error('admin-kick error', e);
        ws.send(JSON.stringify({ type: 'admin-error', error: 'kick_failed' }));
      }
      return;
    }

    if (msg.type === 'admin-list-sockets') {
      const list = [];
      sockets.forEach((s, cid) => list.push({ clientId: cid, ip: s._clientIp, isAdmin: !!s._isAdmin }));
      ws.send(JSON.stringify({ type: 'admin-socket-list', list }));
      return;
    }

    if (msg.type === 'admin-announce') {
      const txt = String(msg.text || '');
      broadcast({ type: 'admin-announce', text: txt });
      await logModeration('announce', { moderator_id: ws._adminId || myClientId, reason: txt });
      ws.send(JSON.stringify({ type: 'admin-ok', action: 'announce' }));
      return;
    }

    // ---------- Regular public / DM message handling ----------
    if (msg.type === 'public') {
      const obj = {
        type: 'public',
        clientId: myClientId,
        text: msg.text || null,
        media: msg.media || null,
        tempId: msg.tempId || null,
        timestamp: msg.timestamp
      };

      // persist first (so we can attach messageId in broadcast)
      try {
        const insertResult = await insertPublicMessage({ fromId: myClientId, text: msg.text, media: msg.media });
        if (insertResult && insertResult.id) obj.messageId = insertResult.id;
      } catch (e) {
        console.error('persist public message failed', e);
      }

      chatHistory.push(obj);
      if (chatHistory.length > 500) chatHistory.shift();

      broadcast(obj);
      return;
    }

    if (msg.type === 'dm') {
      const to = String(msg.to || '');
      if (!to || to === myClientId) return;

      const key = dmKey(myClientId, to);
      const record = {
        type: 'dm',
        dmKey: key,
        from: myClientId,
        to,
        text: msg.text || null,
        media: msg.media || null,
        tempId: msg.tempId || null,
        timestamp: msg.timestamp
      };

      // persist DM message
      try {
        const insertResult = await insertDMMessage({ dmKeyVal: key, fromId: myClientId, toId: to, text: msg.text, media: msg.media });
        if (insertResult && insertResult.id) record.messageId = insertResult.id;
      } catch (e) {
        console.error('persist DM message failed', e);
      }

      const list = dmHistory.get(key) || [];
      list.push(record);
      if (list.length > 500) list.shift();
      dmHistory.set(key, list);

      const setA = dmThreadsMemory.get(myClientId) || new Set();
      if (!setA.has(to)) {
        setA.add(to);
        dmThreadsMemory.set(myClientId, setA);
        sendTo(myClientId, { type: 'dm-threads', partners: Array.from(setA) });
      }
      const setB = dmThreadsMemory.get(to) || new Set();
      if (!setB.has(myClientId)) {
        setB.add(myClientId);
        dmThreadsMemory.set(to, setB);
        sendTo(to, { type: 'dm-threads', partners: Array.from(setB) });
      }

      // send to recipient & echo to sender
      sendTo(to, record);
      sendTo(myClientId, { ...record, echoed: true });

      return;
    }
  });

  ws.on('close', () => {
    // remove from sockets map
    if (ws._clientId && sockets.has(ws._clientId)) sockets.delete(ws._clientId);
    console.log(`[SOCKET DISCONNECT] ClientId: ${ws._clientId || 'unknown'}, IP: ${ws._clientIp}`);
  });
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = { app, server, wss };
