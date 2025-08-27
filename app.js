const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// In-memory chat history
// Each item: { message: string, timestamp: number }
const chatHistory = [];
// const MESSAGE_LIFETIME = 24 * 60 * 60 * 1000; // 1 day
const MESSAGE_LIFETIME = 60 * 1000; // 1 minute in milliseconds

wss.on('connection', (ws) => {
  console.log('New client connected');

  const now = Date.now();

  // Send recent chat history to the new client
  chatHistory.forEach(item => {
    if (now - item.timestamp <= MESSAGE_LIFETIME) {
      ws.send(item.message);
    }
  });

  ws.on('message', (message) => {
    const text = message.toString();
    const timestamp = Date.now();
    console.log('Received:', text);

    // Add message to history
    chatHistory.push({ message: text, timestamp });

    // Broadcast message to all clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    });

    // Remove old messages
    while (chatHistory.length && timestamp - chatHistory[0].timestamp > MESSAGE_LIFETIME) {
      chatHistory.shift();
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
