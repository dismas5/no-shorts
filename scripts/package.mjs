import { readFile, writeFile, mkdir, symlink, rename, rm, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
const targets = { safari: 'safari-webextension.zip', firefox: 'firefox-unsigned.xpi' };
const target = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(targets, target)) {
  console.error('Usage: npm run package -- <safari|firefox>');
  process.exit(1);
}
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+(?:\.\d+){0,3}$/.test(version)) throw new Error('Invalid package version');
const build = spawnSync(process.execPath, ['scripts/build.mjs', target], { stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const { files } = await import('./audit.mjs');
const dir = `artifacts/${version}`;
await mkdir(dir, { recursive: true });
const name = `local-blocklist-${targets[target]}`;
await writeFile(`${dir}/${name}`, await zip(`dist/${target}`, await files(`dist/${target}`)));
const archives = (await readdir(dir)).filter(file => /^local-blocklist-(safari-webextension\.zip|firefox-unsigned\.xpi)$/.test(file)).sort();
const sums = await Promise.all(archives.map(async file => `${createHash('sha256').update(await readFile(`${dir}/${file}`)).digest('hex')}  ${file}`));
await writeFile(`${dir}/SHA256SUMS`, sums.join('\n') + '\n');
async function updateLink(name, value) {
  const path = `artifacts/${name}`, pending = `${path}.${randomUUID()}.tmp`;
  try { await symlink(value, pending); await rename(pending, path); }
  finally { await rm(pending, { force: true }); }
}
await updateLink(`v${version}`, version);
const compare = (a, b) => {
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] ?? 0n) !== (right[i] ?? 0n)) return (left[i] ?? 0n) > (right[i] ?? 0n) ? 1 : -1;
  }
  return 0;
};
const versions = (await readdir('artifacts', { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && /^\d+(?:\.\d+){0,3}$/.test(entry.name)).map(entry => entry.name);
const packaged = [];
for (const candidate of versions) {
  if ((await readdir(`artifacts/${candidate}`)).some(file => /^local-blocklist-(safari-webextension\.zip|firefox-unsigned\.xpi)$/.test(file))) packaged.push(candidate);
}
packaged.sort(compare);
await updateLink('latest', packaged.at(-1));
console.log(`Packaged ${target}: ${dir}/${name}`);
