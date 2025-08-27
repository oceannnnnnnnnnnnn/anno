// Auto-detect ws/wss based on page protocol
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${protocol}://${window.location.host}`);

// Logs
ws.onopen = () => console.log('WebSocket connected');
ws.onerror = (err) => console.error('WebSocket error:', err);
ws.onclose = () => console.log('WebSocket closed');

ws.onmessage = (event) => {
  console.log('Received:', event.data);
  const li = document.createElement('li');
  li.textContent = event.data;
  document.getElementById('chat').appendChild(li);
};

// Input validation
const input = document.getElementById('msg');
const button = document.getElementById('send');

button.onclick = () => {
  let msg = input.value.trim();

  if (msg === '') {
    alert('Cannot send empty message');
    return;
  }

  if (msg.length > 200) {
    alert('Message is too long');
    return;
  }

  const forbidden = /[<>]/;
  if (forbidden.test(msg)) {
    alert('Message contains invalid characters');
    return;
  }

  ws.send(msg);
  input.value = '';
};

// Optional: disable send button if input is empty
input.addEventListener('input', () => {
  button.disabled = input.value.trim() === '';
});
button.disabled = true; // initial state
