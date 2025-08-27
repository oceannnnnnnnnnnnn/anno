const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${protocol}://${window.location.host}`);

const chat = document.getElementById('chat');
const input = document.getElementById('msg');
const button = document.getElementById('send');

ws.onopen = () => console.log('WebSocket connected');
ws.onerror = err => console.error('WebSocket error:', err);
ws.onclose = () => console.log('WebSocket closed');

ws.onmessage = event => {
  const li = document.createElement('li');
  li.textContent = event.data;
  li.classList.add('message', 'received');
  chat.appendChild(li);
  chat.scrollTop = chat.scrollHeight;
};

button.onclick = () => {
  const msg = input.value.trim();
  if (!msg) return;

  ws.send(msg);
  
  const li = document.createElement('li');
  li.textContent = msg;
  li.classList.add('message', 'sent');
  chat.appendChild(li);
  chat.scrollTop = chat.scrollHeight;

  input.value = '';
  button.disabled = true;
  input.rows = 1;
};

input.addEventListener('input', () => {
  button.disabled = input.value.trim() === '';
  input.rows = Math.min(4, Math.ceil(input.value.length / 30)) || 1;
});
