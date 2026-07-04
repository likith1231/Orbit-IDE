const fs = require('fs').promises;
const { execSync } = require('child_process');

async function test() {
  // Let's modify index.html slightly on disk just like the DB would
  const path = '/home/likith/Documents/ai-cloud-ide/backend/data/git/b54a1f0a-c551-44d5-a5e1-6c9e0c20a23f/index.html';
  await fs.appendFile(path, '\n<!-- test comment -->');
  
  const stdout = execSync('git status -s', { cwd: '/home/likith/Documents/ai-cloud-ide/backend/data/git/b54a1f0a-c551-44d5-a5e1-6c9e0c20a23f' });
  console.log('Status after modify:', stdout.toString());
}
test();
