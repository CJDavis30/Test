// Runs the API (tsx watch) and the Vite dev server together.
import { spawn } from 'node:child_process';
const run = (name, cmd, args, env = {}) => {
  const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  p.on('exit', (code) => { console.log(`[${name}] exited ${code}`); process.exit(code ?? 0); });
  return p;
};
const children = [
  run('api', 'npx', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts']),
  run('web', 'npx', ['vite', '--config', 'web/vite.config.ts']),
];
process.on('SIGINT', () => children.forEach((c) => c.kill('SIGINT')));
