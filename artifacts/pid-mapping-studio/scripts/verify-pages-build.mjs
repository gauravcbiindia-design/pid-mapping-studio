import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/pages/', import.meta.url));
const allowed = /\.(html|js|mjs|css|jpg|jpeg|png|svg|ico|webp|txt|json)$/i;
const files = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full);
    else {
      const name = path.relative(root, full).split(path.sep).join('/');
      if (!allowed.test(name)) throw new Error(`Unexpected public build file: ${name}`);
      const bytes = await readFile(full);
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      files.push({ path: name, sha, size: bytes.length });
    }
  }
}
await walk(root);
if (!files.some((file) => file.path === 'index.html')) throw new Error('Missing index.html');
files.sort((a, b) => a.path.localeCompare(b.path));
const remoteIndex = process.argv.indexOf('--remote-manifest');
if (remoteIndex !== -1) {
  const manifest = JSON.parse(await readFile(process.argv[remoteIndex + 1], 'utf8'));
  const remote = new Map((manifest.tree ?? manifest).map((file) => [file.path, file.sha]));
  const missing = files.filter((file) => remote.get(file.path) !== file.sha);
  if (missing.length) throw new Error(`Public release missing or outdated files: ${missing.map((file) => file.path).join(', ')}`);
  console.log(`Verified all ${files.length} build files against the public repository.`);
} else if (process.argv.includes('--check')) {
  console.log(`Checked ${files.length} public build files. No CAD, PDF, ZIP, LISP, or source-map files included.`);
} else {
  console.log(JSON.stringify(files));
}
