import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const entry = path.join(here, 'index.js');
let child;
let stopping = false;
let requestedRestart = false;
let restartTimer;
const watchers = [];

function launch() {
  if (stopping) return;
  console.log('[supervisor] Iniciando servidor SIGED…');
  child = spawn(process.execPath, [entry], { stdio: 'inherit', env: process.env });
  child.once('error', (error) => {
    console.error('[supervisor] No se pudo iniciar el servidor:', error.message);
    scheduleRestart();
  });
  child.once('exit', (code, signal) => {
    child = undefined;
    if (stopping) return;
    if (requestedRestart) {
      requestedRestart = false;
      launch();
      return;
    }
    if (code === 98) {
      stopping = true;
      for (const watcher of watchers) watcher.close();
      console.error(`[supervisor] El puerto ${process.env.PORT || 3002} ya está ocupado. Se detuvo el reinicio automático; cierra el otro servidor SIGED o libera el puerto y vuelve a ejecutar npm run dev.`);
      process.exitCode = 98;
      return;
    }
    console.error(`[supervisor] El servidor terminó (código ${code ?? '—'}, señal ${signal ?? '—'}). Se reiniciará en 2 segundos.`);
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (stopping || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    launch();
  }, 2000);
}

function restartForFileChange(file) {
  if (!child || stopping || requestedRestart) return;
  console.log(`[supervisor] Cambio en ${path.basename(file)}; reiniciando servidor…`);
  requestedRestart = true;
  child.kill();
}

for (const file of [entry, path.join(root, 'queries.txt'), path.join(root, '.env')]) {
  try {
    watchers.push(watch(file, () => restartForFileChange(file)));
  } catch {
    // .env puede no existir hasta que el usuario configure la conexión.
  }
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers) watcher.close();
  console.log(`\n[supervisor] Deteniendo por ${signal}.`);
  if (child) child.kill();
  else process.exit(0);
}

process.once('SIGINT', () => shutdown('Ctrl+C'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
launch();
