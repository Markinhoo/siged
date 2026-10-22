import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const preferredPort = Number(process.env.PORT || 3003);

function cleanupStaleWindowsProcesses() {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    const cleanup = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'cleanup-windows.ps1'),
      '-ProjectRoot', root, '-KeepProcessId', String(process.pid),
    ], { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    cleanup.stdout.on('data', (chunk) => process.stdout.write(`[dev] ${chunk}`));
    cleanup.once('error', () => resolve());
    cleanup.once('exit', () => resolve());
  });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findApiPort() {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No hay puertos libres entre ${preferredPort} y ${preferredPort + 99}.`);
}

await cleanupStaleWindowsProcesses();
const apiPort = await findApiPort();
if (apiPort !== preferredPort) {
  console.log(`[dev] El puerto ${preferredPort} está ocupado; la API usará ${apiPort}.`);
}

const env = { ...process.env, PORT: String(apiPort), VITE_API_PORT: String(apiPort) };
const children = [
  spawn(process.execPath, [path.join(here, 'supervisor.js')], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, env, stdio: 'inherit' }),
];
let stopping = false;

function killProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore',
    });
    killer.once('error', () => { child.kill(); resolve(); });
    killer.once('exit', () => resolve());
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) void killProcessTree(child);
}

for (const child of children) {
  child.once('error', (error) => {
    console.error('[dev] No se pudo iniciar un proceso:', error.message);
    stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
