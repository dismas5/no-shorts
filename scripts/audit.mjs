import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]));
  return nested.flat().sort();
}
for (const target of ['firefox', 'safari']) {
  const root = `dist/${target}`, manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'declarativeNetRequestWithHostAccess']);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.background.persistent, false);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  for (const file of await files(root)) {
    assert.ok(!/node_modules|fixture|\.map$|\.ts$|test\./.test(file), file);
    if (!/\.(?:js|html|css|json)$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    if (file.endsWith('.js')) assert.ok(!/[^\x00-\x7F]/.test(source), `Non-ASCII JavaScript source in ${file}`);
    assert.ok(!/scripting\s*\.\s*executeScript\s*\(/.test(source), `Live injection must not return to the settings path: ${file}`);
    assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|eval)\s*\(|storage\.sync|innerHTML\s*=|https?:\/\/(?:localhost|127\.0\.0\.1|[^\s'"]+\.test)/.test(source), file);
    assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(source), file);
    assert.ok(!/https?:\/\//.test(source.replace(/https?:\/\/\*\/\*/g, '').replace(/https?:\/\/\$\{/g, '').replace(/http:\/\/www\.w3\.org/g, '')), `Unexpected external URL in ${file}`);
  }
  for (const file of ['background.js', 'guard.js', 'history.js', 'options.js', 'blocked.js', 'options.html', 'blocked.html', 'styles.css']) {
    assert.ok((await readFile(`${root}/${file}`)).length > 0);
  }
  console.log(`${target}: package, scoped optional permissions, CSP, no remote resources or runtime network APIs: OK`);
}
