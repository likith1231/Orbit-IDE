const { execFile } = require('child_process');

function execFilePromise(cmd, args, options) {
  return new Promise((resolve) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error && !stdout.includes('nothing to commit')) resolve({ stdout, stderr, error });
      else resolve({ stdout, stderr });
    });
  });
}
console.log("ready");
