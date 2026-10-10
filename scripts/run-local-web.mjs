import { spawn } from 'node:child_process';

process.env.PORT ??= '5173';
process.env.BASE_PATH ??= '/';
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const server = spawn(command, ['--filter', '@workspace/pid-mapping-studio', 'run', 'dev', '--', '--host', '127.0.0.1'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});
server.on('error', (error) => {
  console.error('Could not start the local web app. Install Node.js and pnpm with your administrator.');
  console.error(error.message);
  process.exitCode = 1;
});
server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
