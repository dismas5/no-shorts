import { readFile, writeFile, mkdir, symlink, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { files } from './audit.mjs';
function crc(bytes) {
  let n = -1;
  for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); }
  return (n ^ -1) >>> 0;
}
export async function zip(root, paths) {
  const locals = [], directory = []; let offset = 0;
  for (const file of paths) {
    const name = Buffer.from(root ? file.slice(root.length + 1).replaceAll('\\', '/') : file.replaceAll('\\', '/'));
    const bytes = await readFile(file), checksum = crc(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(33, 14); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, bytes); directory.push(central, name); offset += local.length + name.length + bytes.length;
  }
  const index = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('artifacts/safari', { recursive: true });
const sums = [];
for (const [target, suffix] of [['firefox', 'firefox-unsigned.xpi'], ['safari', 'safari-webextension.zip']]) {
  const root = `dist/${target}`, bytes = await zip(root, await files(root));
  const name = `${target === 'safari' ? 'safari/' : ''}local-blocklist-${version}-${suffix}`;
  await writeFile(`artifacts/${name}`, bytes); sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
const sourceFiles = ['package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', '.npmrc', 'AGENTS.md', 'README.md', 'LICENSE', ...(await Promise.all(['src', 'public', 'scripts', 'tests', 'docs', 'safari'].map(files))).flat()].sort();
const source = await zip('', sourceFiles), sourceName = `local-blocklist-${version}-source.zip`;
await writeFile(`artifacts/${sourceName}`, source); sums.push(`${createHash('sha256').update(source).digest('hex')}  ${sourceName}`);
await writeFile('artifacts/SHA256SUMS', sums.join('\n') + '\n');
// Publish the stable deployment link only after all packages are complete.
// A relative target survives moving the artifacts directory; rename replaces
// the old link atomically without leaving a missing-link window.
const latest = 'artifacts/safari/local-blocklist-latest-safari-webextension.zip';
const pending = `${latest}.${randomUUID()}.tmp`;
try {
  await symlink(`local-blocklist-${version}-safari-webextension.zip`, pending);
  await rename(pending, latest);
} finally {
  await rm(pending, { force: true });
}
console.log('Deterministic unsigned packages and source archive: artifacts/');
