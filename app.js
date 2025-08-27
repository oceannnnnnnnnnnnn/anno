// const http = require('http')
// const fs = require('fs')
// const port = process.env.PORT || 3000; 

// const server = http.createServer(function(req, res){
//     res.writeHead(200, {'Content-Type':'text/html'})
//     fs.readFile('index.html', function(error, data){
//         if (error){
//             res.writeHead(404)
//             res.write("File not found")
//         }else{
//             res.write(data)
//         }
//         res.end()
//     })
// })

// server.listen(port, function(error) {
//     if (error){
//         console.log('Something went wrong', error)
//     }else{
//         console.log('Server is listening on Port: ' + port)
//     }
// })





const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', ws => {
  ws.on('message', message => {
    // Broadcast message to all connected clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
