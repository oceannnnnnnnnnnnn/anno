// app.js (Refactored)
const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

// --- In-Memory State ---
const chatHistory = [];
const sockets = new Map(); // clientId -> WebSocket instance
const dmHistory = new Map(); // dmKey -> [messages]
const dmThreads = new Map(); // clientId -> Set(partnerId)

// --- Constants ---
const MESSAGE_LIFETIME = 86400 * 1000; // 24 hours

// --- Utility Functions ---
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

// --- WebSocket Connection Handling ---
wss.on("connection", (ws) => {
  let myClientId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } 
    catch (e) { return; }

    // --- Handshake: Client must introduce itself first ---
    if (msg.type === 'hello') {
      myClientId = String(msg.clientId || ('s_' + Math.random().toString(36).slice(2, 9)));
      sockets.set(myClientId, ws);
      ws._clientId = myClientId;

      if (!dmThreads.has(myClientId)) dmThreads.set(myClientId, new Set());

      // Send acknowledgment and initial state
      sendTo(myClientId, { type: 'hello-ack', clientId: myClientId });
      sendTo(myClientId, { type: 'dm-threads', partners: Array.from(dmThreads.get(myClientId) || []) });
      
      const recentHistory = chatHistory.filter(item => now() - item.timestamp <= MESSAGE_LIFETIME);
      sendTo(myClientId, { type: 'public-history', messages: recentHistory });
      return;
    }

    if (!myClientId) return; // Ignore messages until handshake is complete

    msg.timestamp = now();

    // --- Message Routing ---
    switch (msg.type) {
      case 'public': {
        const obj = { type: 'public', clientId: myClientId, text: msg.text, image: msg.image, tempId: msg.tempId, timestamp: msg.timestamp };
        chatHistory.push(obj);
        broadcast(obj);
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
          image: msg.image || null,
          tempId: msg.tempId || null,
          timestamp: msg.timestamp
        };

        // Add message to history
        const list = dmHistory.get(key) || [];
        list.push(record);
        dmHistory.set(key, list);
        
        // **IMPORTANT**: Auto-create thread if it's the first message
        const myThreads = dmThreads.get(myClientId) || new Set();
        if (!myThreads.has(to)) {
            myThreads.add(to);
            dmThreads.set(myClientId, myThreads);
            // Also notify our client UI to update its thread list
            sendTo(myClientId, { type: 'dm-threads', partners: Array.from(myThreads) });
        }
        
        const partnerThreads = dmThreads.get(to) || new Set();
        if(!partnerThreads.has(myClientId)) {
            partnerThreads.add(myClientId);
            dmThreads.set(to, partnerThreads);
            // Also notify the partner's UI to update their thread list
            sendTo(to, { type: 'dm-threads', partners: Array.from(partnerThreads) });
        }

        // Send to recipient and echo to sender
        sendTo(to, record);
        sendTo(myClientId, { ...record, echoed: true });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (myClientId) {
      sockets.delete(myClientId);
      console.log("Client disconnected:", myClientId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));