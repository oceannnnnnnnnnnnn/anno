// app.js (server)

const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public/
app.use(express.static(path.join(__dirname, "public")));

// In-memory chat history (kept as objects)
// Each item: { text: string, clientId: string|null, tempId?: string, timestamp: number }
const chatHistory = [];
const MESSAGE_LIFETIME = 86400 * 1000; // 60 minute for your current tests

wss.on("connection", (ws) => {
  console.log("New client connected");
  const now = Date.now();

  // Send recent chat history (as JSON messages)
  chatHistory.forEach((item) => {
    if (now - item.timestamp <= MESSAGE_LIFETIME) {
      ws.send(JSON.stringify(item));
    }
  });

  ws.on("message", (message) => {
    let msgObj;
    try {
      msgObj = JSON.parse(message);
    } catch (e) {
      // fallback for plain strings
      msgObj = { text: message.toString(), clientId: null };
    }

    msgObj.timestamp = Date.now();

    // Add to history
    chatHistory.push(msgObj);

    // Broadcast message to all clients (JSON)
    const payload = JSON.stringify(msgObj);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });

    // Remove old messages
    while (
      chatHistory.length &&
      Date.now() - chatHistory[0].timestamp > MESSAGE_LIFETIME
    ) {
      chatHistory.shift();
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
