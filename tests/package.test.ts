import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, readFile, readlink, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

test('packaging selects a target, preserves other packages and points latest to the newest version', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'local-blocklist-package-'));
  try {
    for (const name of ['src', 'public', 'scripts']) await cp(name, path.join(root, name), { recursive: true });
    await cp('package.json', path.join(root, 'package.json'));
    await symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir');
    const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/package.mjs', ...args], { cwd: root, encoding: 'utf8' });
    assert.notEqual(run().status, 0);
    assert.notEqual(run('invalid').status, 0);
    assert.equal(run('safari').status, 0);
    const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version as string;
    const folder = path.join(root, 'artifacts', version);
    assert.deepEqual((await readdir(folder)).sort(), ['SHA256SUMS', 'local-blocklist-safari-webextension.zip']);
    assert.equal(await readlink(path.join(root, 'artifacts/latest')), version);
    assert.equal(await readlink(path.join(root, `artifacts/v${version}`)), version);
    assert.equal(run('firefox').status, 0);
    const names = (await readdir(folder)).sort();
    assert.deepEqual(names, ['SHA256SUMS', 'local-blocklist-firefox-unsigned.xpi', 'local-blocklist-safari-webextension.zip']);
    const sums = await readFile(path.join(folder, 'SHA256SUMS'), 'utf8');
    for (const line of sums.trim().split('\n')) {
      const [digest, name] = line.split('  ');
      assert.equal(createHash('sha256').update(await readFile(path.join(folder, name!))).digest('hex'), digest);
    }
    assert.equal(run('firefox').status, 0);
    assert.equal(await readFile(path.join(folder, 'SHA256SUMS'), 'utf8'), sums);
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    manifest.version = '99.0.0';
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    assert.equal(run('safari').status, 0);
    manifest.version = version;
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    assert.equal(run('firefox').status, 0);
    assert.equal(await readlink(path.join(root, 'artifacts/latest')), '99.0.0');
    assert.equal(await readlink(path.join(root, `artifacts/v${version}`)), version);
  } finally { await rm(root, { recursive: true, force: true }); }
});
