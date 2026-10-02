const Docker = require('dockerode');
const config = require('../config');

const docker = new Docker({ socketPath: config.dockerSocket });

let availableCache = null;
let availableCheckedAt = 0;

async function dockerAvailable() {
  if (availableCache !== null && Date.now() - availableCheckedAt < 30000) return availableCache;
  try {
    await docker.ping();
    availableCache = true;
  } catch {
    availableCache = false;
  }
  availableCheckedAt = Date.now();
  return availableCache;
}

const pulling = new Map();

// Rewrite a Docker Hub image to go through DOCKER_IMAGE_MIRROR (e.g. "mirror.gcr.io").
// Images from other registries (mcr.microsoft.com/..., ghcr.io/...) are left alone.
function mirrored(image) {
  if (!config.imageMirror) return image;
  const first = image.split('/')[0];
  const hasRegistry = image.includes('/') && (first.includes('.') || first.includes(':'));
  if (hasRegistry) return image;
  const repo = image.includes('/') ? image : `library/${image}`;
  return `${config.imageMirror.replace(/\/+$/, '')}/${repo}`;
}

// Make sure `image` exists locally, pulling it (optionally through a mirror) on first use.
async function ensureImage(image, onProgress) {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch { /* not present */ }

  if (pulling.has(image)) return pulling.get(image);

  const job = (async () => {
    const source = mirrored(image);
    onProgress?.(`Pulling ${source} (first run only)...`);
    const stream = await docker.pull(source);
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, err => (err ? reject(err) : resolve()));
    });
    if (source !== image) {
      const [repo, tag = 'latest'] = image.split(':');
      await docker.getImage(source).tag({ repo, tag });
    }
  })().finally(() => pulling.delete(image));

  pulling.set(image, job);
  return job;
}

// Ports a process is LISTENing on inside a container. Reads /proc/net/tcp{,6},
// which exists in every Linux image (unlike netstat/ss).
async function listeningPorts(container) {
  const exec = await container.exec({
    Cmd: ['sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null'],
    AttachStdout: true,
    AttachStderr: false,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = await new Promise((resolve) => {
    const chunks = [];
    docker.modem.demuxStream(stream, { write: c => chunks.push(c) }, { write: () => {} });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
  const ports = new Set();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[3] !== '0A') continue; // 0A = LISTEN
    const port = parseInt(cols[1].split(':').pop(), 16);
    if (port) ports.add(port);
  }
  return [...ports];
}

// { "3000/tcp": "49153", ... } for ports published on the host.
function publishedPorts(info) {
  const out = {};
  for (const [key, value] of Object.entries(info?.NetworkSettings?.Ports || {})) {
    if (value && value.length) out[key] = value[0].HostPort;
  }
  return out;
}

module.exports = { docker, dockerAvailable, ensureImage, listeningPorts, publishedPorts };
