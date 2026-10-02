// Starter files for new projects. Each template is a list of { path, content }.
const TEMPLATES = {
  blank: {
    label: 'Blank',
    files: [{ path: 'README.md', content: '# New project\n' }],
  },
  python: {
    label: 'Python script',
    files: [
      { path: 'main.py', content: 'def greet(name: str) -> str:\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    name = input("What is your name? ")\n    print(greet(name))\n' },
      { path: 'README.md', content: '# Python project\n\nPress **Ctrl+Enter** with `main.py` open to run it.\n' },
    ],
  },
  'node-express': {
    label: 'Node.js + Express API',
    files: [
      { path: 'package.json', content: JSON.stringify({ name: 'express-api', version: '1.0.0', main: 'server.js', scripts: { start: 'node server.js' }, dependencies: { express: '^4.21.2' } }, null, 2) + '\n' },
      { path: 'server.js', content: "const express = require('express');\n\nconst app = express();\napp.use(express.json());\n\nconst todos = [{ id: 1, title: 'Try Orbit IDE', done: false }];\n\napp.get('/', (req, res) => res.send('<h1>Express is running 🚀</h1><p>Try <a href=\"api/todos\">api/todos</a></p>'));\napp.get('/api/todos', (req, res) => res.json(todos));\napp.post('/api/todos', (req, res) => {\n  const todo = { id: todos.length + 1, title: req.body.title, done: false };\n  todos.push(todo);\n  res.status(201).json(todo);\n});\n\nconst PORT = process.env.PORT || 3000;\napp.listen(PORT, '0.0.0.0', () => console.log(`Listening on http://localhost:${PORT}`));\n" },
      { path: 'README.md', content: '# Express API\n\nOpen `server.js` and press **Run** — dependencies install automatically and a preview opens.\n' },
    ],
  },
  flask: {
    label: 'Python + Flask web app',
    files: [
      { path: 'requirements.txt', content: 'flask==3.1.0\n' },
      { path: 'app.py', content: 'from flask import Flask, jsonify\n\napp = Flask(__name__)\n\n\n@app.route("/")\ndef index():\n    return "<h1>Flask is running 🐍</h1><p>Try <a href=\'api/hello\'>api/hello</a></p>"\n\n\n@app.route("/api/hello")\ndef hello():\n    return jsonify(message="Hello from Flask")\n\n\nif __name__ == "__main__":\n    app.run(host="0.0.0.0", port=5000, debug=True)\n' },
      { path: 'README.md', content: '# Flask app\n\nOpen `app.py` and press **Run** — requirements install automatically and a preview opens.\n' },
    ],
  },
  'static-site': {
    label: 'HTML/CSS/JS website',
    files: [
      { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>My site</title>\n  <link rel="stylesheet" href="style.css" />\n</head>\n<body>\n  <main>\n    <h1>Hello, web! 👋</h1>\n    <button id="btn">Click me</button>\n    <p id="count">Clicked 0 times</p>\n  </main>\n  <script src="script.js"></script>\n</body>\n</html>\n' },
      { path: 'style.css', content: 'body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }\nbutton { padding: 10px 18px; border: 0; border-radius: 8px; background: #6366f1; color: white; font-size: 16px; cursor: pointer; }\n' },
      { path: 'script.js', content: "let count = 0;\ndocument.getElementById('btn').addEventListener('click', () => {\n  count += 1;\n  document.getElementById('count').textContent = `Clicked ${count} times`;\n});\n" },
    ],
  },
  cpp: {
    label: 'C++ program',
    files: [
      { path: 'main.cpp', content: '#include <iostream>\n#include <string>\n\nint main() {\n    std::string name;\n    std::cout << "What is your name? ";\n    std::getline(std::cin, name);\n    std::cout << "Hello, " << name << "!" << std::endl;\n    return 0;\n}\n' },
    ],
  },
  java: {
    label: 'Java program',
    files: [
      { path: 'Main.java', content: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.print("What is your name? ");\n        String name = in.nextLine();\n        System.out.println("Hello, " + name + "!");\n    }\n}\n' },
    ],
  },
};

// Rows for prisma.file.createMany: parent folders plus files.
function templateRows(key) {
  const tpl = TEMPLATES[key] || TEMPLATES.blank;
  const { languageFor } = require('./workspace');
  const rows = [];
  const folders = new Set();
  for (const f of tpl.files) {
    const parts = f.path.split('/');
    const name = parts.pop();
    for (let i = 0; i < parts.length; i++) folders.add(parts.slice(0, i + 1).join('/'));
    rows.push({ name, path: parts.join('/'), isFolder: false, language: languageFor(name), content: f.content });
  }
  for (const rel of folders) {
    const i = rel.lastIndexOf('/');
    rows.push({ name: rel.slice(i + 1), path: i === -1 ? '' : rel.slice(0, i), isFolder: true, language: '', content: '' });
  }
  return rows;
}

const templateList = () => Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label }));

module.exports = { templateRows, templateList };
