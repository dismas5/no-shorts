import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, cp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startFixtures } from './fixture-server.mjs';
// Real Firefox + geckodriver integration. Test-only required hosts live in a temporary copy.
// Snap Firefox and host geckodriver must both see the test extension files.
await mkdir('build', { recursive: true });
const temp = await mkdtemp(path.resolve('build', 'firefox-test-'));
const downloads = path.join(temp, 'downloads');
await mkdir(downloads);
let fixture, driver, session;
const driverPort = Number(process.env.LB_DRIVER_PORT ?? 4447);
const endpoint = `http://127.0.0.1:${driverPort}`;
async function command(method, route, body) {
  const response = await fetch(endpoint + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (result.value?.error) throw new Error(`${result.value.error}: ${result.value.message}`);
  return result.value;
}
const waitFor = async (check, label) => {
  for (let i = 0; i < 100; i++) { try { const value = await check(); if (value) return value; } catch { /* Browser is transitioning. */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timeout: ${label}`);
};
try {
  fixture = await startFixtures();
  await cp('dist/firefox', path.join(temp, 'extension'), { recursive: true });
  const manifestPath = path.join(temp, 'extension', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://127.0.0.1/*'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  // Python's standard zipfile avoids modifying production packages or invoking signing services.
  const archive = path.join(temp, 'test.xpi');
  const packed = spawnSync(process.env.PYTHON_BIN ?? 'python3', ['-c', 'import sys,zipfile,pathlib; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w"); [z.write(p,p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()', path.join(temp, 'extension'), archive], { encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || 'Python 3 is required for test-only XPI');
  let driverFailure;
  // Current Firefox requires this flag to navigate to the test extension's options.
  // It applies only to the temporary WebDriver session, never a user's profile.
  driver = spawn(process.env.GECKODRIVER_BIN ?? 'geckodriver', ['--allow-system-access', '--port', String(driverPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
  driver.on('error', error => { driverFailure = error; });
  await waitFor(async () => { if (driverFailure) throw driverFailure; return command('GET', '/status'); }, 'geckodriver startup');
  const uuid = '12e4fca2-2959-4dfb-9b56-96d25365775e';
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox',
    'moz:firefoxOptions': { args: ['-headless'], ...(process.env.FIREFOX_BIN ? { binary: process.env.FIREFOX_BIN } : {}), prefs: {
      'extensions.webextensions.uuids': JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: uuid }),
      'media.autoplay.default': 0,
      'browser.download.dir': downloads, 'browser.download.folderList': 2, 'browser.download.useDownloadDir': true,
      'browser.helperApps.neverAsk.saveToDisk': 'application/json'
    } }
  } } });
  session = created.sessionId;
  const route = `/session/${session}`;
  await command('POST', route + '/timeouts', { pageLoad: 10000, script: 10000 });
  const script = (code, args = []) => command('POST', route + '/execute/sync', { script: code, args });
  const navigate = url => command('POST', route + '/url', { url });
  const click = async selector => {
    const element = await command('POST', route + '/element', { using: 'css selector', value: selector });
    return command('POST', route + `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
  };
  await command('POST', route + '/moz/addon/install', { path: archive, temporary: true });
  const options = `moz-extension://${uuid}/options.html`;
  await navigate(options);
  await waitFor(() => script("return document.querySelector('#status')?.textContent.includes('Список пуст')"), 'empty options');
  await script("document.querySelector('#domain').value='127.0.0.1';document.querySelector('#rule-name').value='Моё правило 🔒 & # + %';document.querySelector('#kind').value='section';document.querySelector('#kind').dispatchEvent(new Event('change'));document.querySelector('#path').value='/section';");
  await click('#save-rule');
  await waitFor(() => script("return document.querySelector('.rule-status')?.textContent.includes('Сеть: активна')"), 'applied real DNR');
  await navigate(fixture.origin + '/allowed');
  assert.ok(await script("return !!document.querySelector('#allowed-content')"));
  try { await navigate(fixture.origin + '/section/direct'); } catch { /* A native blocked-navigation error is expected. */ }
  assert.equal(fixture.hits.get('/section/direct') ?? 0, 0, 'DNR must stop request before local server');
  await navigate(fixture.origin + '/section-example');
  assert.ok(await script("return !!document.querySelector('#allowed-content')"));
  for (const selector of ['#push', '#replace', '#blocked-link']) {
    await navigate(fixture.origin + '/allowed'); await click(selector);
    await waitFor(async () => (await command('GET', route + '/url')).startsWith(`moz-extension://${uuid}/blocked.html#`), selector);
    assert.ok(await script("return document.querySelector('#reason').textContent.includes('Моё правило 🔒 & # + %')"));
  }
  await navigate(options);
  await waitFor(() => script("return document.querySelector('.rule-toggle')?.getAttribute('aria-checked') === 'true'"), 'enabled switch');
  await click('.rule-toggle');
  await waitFor(() => script("return document.querySelector('.rule-toggle')?.getAttribute('aria-checked') === 'false' && !document.querySelector('.rule-toggle').disabled"), 'paused rule');
  assert.ok(await script("return document.activeElement === document.querySelector('.rule-toggle')"), 'switch keeps keyboard focus after save');
  await navigate(fixture.origin + '/section/paused');
  assert.ok(await script("return !!document.querySelector('#allowed-content')"));
  assert.equal(fixture.hits.get('/section/paused'), 1, 'paused rule allows the request through');
  await navigate(options);
  await waitFor(() => script("return document.querySelector('.rule-toggle')?.getAttribute('aria-checked') === 'false'"), 'paused state survives options reload');
  await click('#export');
  const exported = await waitFor(async () => JSON.parse(await readFile(path.join(downloads, 'local-blocklist.json'), 'utf8')), 'JSON file downloaded');
  assert.deepEqual(exported, JSON.parse(await script("return document.querySelector('#json-preview').value")));
  assert.equal(exported.rules[0].name, 'Моё правило 🔒 & # + %');
  assert.equal(exported.rules[0].enabled, false);
  assert.equal(await command('GET', route + '/url'), options, 'export keeps the settings page open');
  await script("document.querySelector('.rule-toggle').focus()");
  await command('POST', route + '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [
    { type: 'keyDown', value: ' ' }, { type: 'keyUp', value: ' ' }
  ] }] });
  await waitFor(() => script("return document.querySelector('.rule-status')?.textContent.includes('Сеть: активна') && document.querySelector('.rule-toggle')?.getAttribute('aria-checked') === 'true'"), 'keyboard resumes rule');
  try { await navigate(fixture.origin + '/section/resumed'); } catch { /* Native DNR error. */ }
  assert.equal(fixture.hits.get('/section/resumed') ?? 0, 0, 'resumed rule blocks the request again');
  await navigate(fixture.origin + '/allowed'); await click('#new-tab');
  await waitFor(async () => (await command('GET', route + '/window/handles')).length === 2, 'new tab');
  assert.equal(fixture.hits.get('/section/new-tab') ?? 0, 0);
  // Keep screenshot evidence from a real extension options page, never website/browsing data.
  await navigate(options); await waitFor(() => script("return !!document.querySelector('.rule-row')"), 'options reloaded');
  await mkdir('.test-output', { recursive: true });
  for (const width of [320, 768, 1024, 1440]) {
    await command('POST', route + '/window/rect', { width, height: 1000 });
    await script("document.querySelector('.rule-toggle').scrollIntoView({block: 'center'})");
    const viewport = await script('return { width: innerWidth, height: innerHeight }');
    console.log(`Options viewport: requested window ${width}, actual ${viewport.width} × ${viewport.height}`);
    const overflow = await script('return document.documentElement.scrollWidth > innerWidth');
    assert.equal(overflow, false, `horizontal overflow at ${width}`);
    const png = await command('GET', route + '/screenshot');
    await writeFile(`.test-output/firefox-options-${width}.png`, Buffer.from(png, 'base64'));
  }
  await click('.rule-toggle');
  await waitFor(() => script("return document.querySelector('.rule-toggle')?.getAttribute('aria-checked') === 'false' && !document.querySelector('.rule-toggle').disabled"), 'disabled screenshot');
  await script("document.querySelector('.rule-toggle').scrollIntoView({block: 'center'})");
  await writeFile('.test-output/firefox-toggle-disabled.png', Buffer.from(await command('GET', route + '/screenshot'), 'base64'));
  console.log('PASS real Firefox: extension settings, JSON file download with Unicode and paused state, applied DNR, direct request prevention, path boundary, MAIN SPA, replaceState, link capture, pause/resume, keyboard switch and focus, new tab, options layout without overflow.');
  console.log('Manual checklist remains for restart, native permission denial/revocation/private mode and genuine BFCache/media on each platform.');
} catch (error) {
  console.error('Firefox integration NOT PASSED:', error.message);
  console.error('Requires an environment that permits loopback servers and launching Firefox/geckodriver. See docs/TESTING.md.');
  process.exitCode = 1;
} finally {
  if (session) await command('DELETE', `/session/${session}`).catch(() => undefined);
  driver?.kill();
  if (fixture) await new Promise(resolve => fixture.server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
