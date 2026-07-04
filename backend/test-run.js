const fetch = require('node-fetch');

async function test() {
  const payload = {
    code: 'console.log("hello")',
    language: 'html',
    fileName: 'index.html',
    socketId: '123',
    projectFiles: [
      { name: 'index.html', path: '', isFolder: false, content: '<h1>Index</h1>' },
      { name: 'style.css', path: '', isFolder: false, content: 'body { background: black; }' }
    ]
  };
  
  const res = await fetch('http://localhost:5000/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  console.log(data);
}
test();
