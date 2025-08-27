const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${protocol}://${window.location.host}`);

document.getElementById('send').onclick = () => {
  const msg = document.getElementById('msg').value;
  console.log('Sending:', msg);          // Log what you send
  ws.send(msg);
  document.getElementById('msg').value = '';
};

ws.onmessage = (event) => {
  console.log('Received:', event.data); 
  const li = document.createElement('li');
  li.textContent = event.data;
  document.getElementById('chat').appendChild(li);
};

ws.onopen = () => console.log('WebSocket connected');
ws.onerror = (err) => console.error('WebSocket error:', err);
ws.onclose = () => console.log('WebSocket closed');
