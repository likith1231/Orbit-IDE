const pty = require('node-pty');
const ptyProcess = pty.spawn('bash', [], { name: 'xterm-color', cols: 80, rows: 24, cwd: process.env.HOME, env: process.env });
ptyProcess.onData((data) => {
  console.log('PTY Data:', JSON.stringify(data));
});
setTimeout(() => {
  ptyProcess.write('pwd\r');
}, 1000);
setTimeout(() => process.exit(), 2000);
