// app.js (restored DM functionality, validated)
// Loads env from anno.env by default (dev). In production use real env vars.
require('dotenv').config();

// --- IP Blocking Middleware ---
const blockedIps = process.env.BLOCKED_IPS ? process.env.BLOCKED_IPS.split(',') : [];

function ipBlock(req, res, next) {
  const clientIp =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress;

  console.log(`[IP LOG] Request from: ${clientIp}`);

  if (blockedIps.includes(clientIp)) {
    console.log(`[IP BLOCKED] ${clientIp}`);
    return res.status(403).json({ error: 'Access denied' });
  }

  next();
}



const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const uploadRouter = require('./routes/upload'); // your upload & signed-url endpoints
const app = express();
app.use(ipBlock);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, perMessageDeflate: {} });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));



// --- Supabase (service role key required in env) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Mount media router (contains /upload and /signed-url)
app.use('/media', uploadRouter);

// --- DB helper functions (persist messages) ---
async function insertPublicMessage({ fromId, text, media }) {
  try {
    const payload = {
      kind: 'public',
      from_id: fromId,
      text: text || null,
      media_key: media?.key || null,
      media_url: media?.url || null,
      media_kind: media?.kind || null
    };
    const { data, error } = await supabase
      .from('messages')
      .insert(payload)
      .select('id, created_at')
      .single();
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
      media_kind: media?.kind || null
    };
    const { data, error } = await supabase
      .from('messages')
      .insert(payload)
      .select('id, created_at')
      .single();
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

// --- In-memory runtime state (fast lookups, not durable) ---
const sockets = new Map();         // clientId -> ws
const chatHistory = [];           // recent public messages (optimistic cache)
const dmHistory = new Map();      // dmKey -> [messages]
const dmThreadsMemory = new Map(); // clientId -> Set(partnerIds)

// Expose in-memory threads for other modules that rely on global (some code used global.__dmThreads)
global.__dmThreads = dmThreadsMemory;

// helpers
const MESSAGE_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours
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
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  });
}

// --- WebSocket connection handling (restores full DM functionality) ---
wss.on('connection', (ws, req) => {
  // Extract client IP from headers or socket
  const clientIp =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress;

  ws._clientIp = clientIp; // Store IP on WebSocket object

  let myClientId = null;

  console.log(`[SOCKET CONNECT] IP: ${clientIp}`);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return; // ignore non-JSON
    }

    // --- handshake: client must send hello with clientId ---
    if (msg.type === 'hello') {
      myClientId = String(msg.clientId || ('s_' + Math.random().toString(36).slice(2, 9)));
      sockets.set(myClientId, ws);
      ws._clientId = myClientId;

      console.log(`[HELLO] ClientId: ${myClientId}, IP: ${ws._clientIp}`);

      if (!dmThreadsMemory.has(myClientId)) dmThreadsMemory.set(myClientId, new Set());

      sendTo(myClientId, { type: 'hello-ack', clientId: myClientId });
      sendTo(myClientId, { type: 'dm-threads', partners: Array.from(dmThreadsMemory.get(myClientId) || []) });

      // Load DM threads & public history as before...
      (async () => {
        try {
          const { data: threads } = await supabase
            .from('dm_threads')
            .select('dm_key, user_a, user_b')
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
        } catch (e) {
          console.error('load dm threads error', e);
        }
      })();

      (async () => {
        try {
          const { data: pubRows } = await supabase
            .from('messages')
            .select('from_id, text, media_key, media_url, media_kind, created_at')
            .eq('kind', 'public')
            .order('created_at', { ascending: false })
            .limit(100);

          if (Array.isArray(pubRows)) {
            const publicMsgs = (pubRows || []).reverse().map(r => ({
              type: 'public',
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

    if (!myClientId) return;

    msg.timestamp = now();

    // ✅ LOG EVERY MESSAGE WITH USERNAME + IP
    console.log(`[MESSAGE] ClientId: ${myClientId}, IP: ${ws._clientIp}, Type: ${msg.type}, Text: ${msg.text || '[media]'}`);

    switch (msg.type) {
      case 'public': {
        const obj = {
          type: 'public',
          clientId: myClientId,
          text: msg.text || null,
          media: msg.media || null,
          tempId: msg.tempId || null,
          timestamp: msg.timestamp
        };

        chatHistory.push(obj);
        if (chatHistory.length > 500) chatHistory.shift();

        broadcast(obj);

        insertPublicMessage({ fromId: myClientId, text: msg.text, media: msg.media }).catch(console.error);
        break;
      }

      case 'dm': {
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

        sendTo(to, record);
        sendTo(myClientId, { ...record, echoed: true });

        ensureDMThreadExists(key, myClientId, to).catch(console.error);
        insertDMMessage({ dmKeyVal: key, fromId: myClientId, toId: to, text: msg.text, media: msg.media }).catch(console.error);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (myClientId) {
      sockets.delete(myClientId);
      console.log(`[SOCKET DISCONNECT] ClientId: ${myClientId}, IP: ${ws._clientIp}`);
    }
  });
});



// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// export for tests/tools if needed
module.exports = { app, server, wss };
