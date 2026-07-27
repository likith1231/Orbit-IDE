const fs = require('fs');
const path = require('path');

const API_URL_VAR = "import.meta.env.VITE_API_URL || 'http://localhost:5000'";

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace fetch('http://localhost:5000/...') with fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/...`)
  content = content.replace(/fetch\('http:\/\/localhost:5000(\/?[^']*)'/g, "fetch(`${" + API_URL_VAR + "}$1`");
  
  // Replace fetch(`http://localhost:5000/...) with fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/...`)
  content = content.replace(/fetch\(`http:\/\/localhost:5000(\/?[^`]*)`/g, "fetch(`${" + API_URL_VAR + "}$1`");

  // Replace io('http://localhost:5000') with io(import.meta.env.VITE_API_URL || 'http://localhost:5000')
  content = content.replace(/io\('http:\/\/localhost:5000'\)/g, "io(" + API_URL_VAR + ")");
  
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${filePath}`);
}

const files = [
  'frontend/src/IDE.tsx',
  'frontend/src/pages/Login.tsx',
  'frontend/src/pages/Signup.tsx'
];

files.forEach(f => replaceInFile(path.join(__dirname, f)));
