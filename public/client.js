const ws = new WebSocket(`ws://${window.location.host}`);

document.getElementById('send').onclick = () => {
  const msg = document.getElementById('msg').value;
  ws.send(msg);
  document.getElementById('msg').value = '';
};

ws.onmessage = (event) => {
  const li = document.createElement('li');
  li.textContent = event.data;
  document.getElementById('chat').appendChild(li);
};
