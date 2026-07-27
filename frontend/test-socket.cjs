const io = require('socket.io-client');
const socket = io('http://localhost:5000');
socket.on('connect', () => {
  console.log('Connected');
});
socket.on('terminal-output', (d) => {
  console.log('output:', d);
});
socket.on('terminal-ready', (d) => {
  console.log('ready:', d);
  socket.emit('terminal-input', 'ls\r');
});
setTimeout(() => process.exit(), 2000);
