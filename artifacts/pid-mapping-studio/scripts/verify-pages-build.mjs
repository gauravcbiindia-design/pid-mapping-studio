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
      if (name !== '.nojekyll' && !allowed.test(name)) throw new Error(`Unexpected public build file: ${name}`);
      const bytes = await readFile(full);
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      files.push({ path: name, sha, size: bytes.length });
    }
  }
}
await walk(root);
if (!files.some((file) => file.path === 'index.html')) throw new Error('Missing index.html');
if (!files.some((file) => file.path === '.nojekyll')) throw new Error('Missing .nojekyll: GitHub Pages may omit underscore-prefixed chunks.');
files.sort((a, b) => a.path.localeCompare(b.path));
const remoteIndex = process.argv.indexOf('--remote-manifest');
const siteIndex = process.argv.indexOf('--site');
if (siteIndex !== -1) {
  const site = process.argv[siteIndex + 1];
  if (!site || !/^https:\/\//.test(site)) throw new Error('Provide the verified HTTPS site base URL.');
  const missing = [];
  for (const file of files) {
    // The marker is a build setting, not a user-facing served asset.
    if (file.path === '.nojekyll') continue;
    const url = new URL(file.path, site.endsWith('/') ? site : `${site}/`);
    url.searchParams.set('verify', file.sha);
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) { missing.push(`${file.path} (HTTP ${response.status})`); continue; }
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (sha !== file.sha) missing.push(`${file.path} (wrong content)`);
  }
  if (missing.length) throw new Error(`Hosted release missing or outdated assets: ${missing.join(', ')}`);
  console.log(`Verified every public asset's actual hosted response and content hash.`);
} else if (remoteIndex !== -1) {
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
