import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, settle, source } from './dom-harness.ts';
import { mockBrowser } from './mock-browser.ts';
import { portPair } from './mock-port.ts';
import { request, type BackgroundDiagnostics, type Snapshot } from '../src/runtime/contracts.ts';
import type { Config } from '../src/core/policy.ts';

const code = await source('src/background.ts');
type Listener = Parameters<typeof browser.runtime.onMessage.addListener>[0];
const optionsUrl = 'safari-web-extension://local/options.html';
const config: Config = { schemaVersion: 2, rules: [{ id: 'test-rule', domain: 'focus.test', includeSubdomains: false, kind: 'site' }] };

async function setup(stallStorage = false, storedState?: Record<string, unknown>, prepare?: (mock: ReturnType<typeof mockBrowser>) => void) {
  const mock = mockBrowser();
  if (storedState) Object.assign(mock.store, structuredClone(storedState));
  if (stallStorage) mock.api.storage.local.get = () => new Promise(() => undefined);
  prepare?.(mock);
  let listener: Listener | undefined;
  let connected: ((port: browser.runtime.Port) => void) | undefined;
  const event = { addListener: () => undefined };
  Object.assign(mock.api.runtime, {
    id: 'local-blocklist', getURL: (path: string) => `safari-web-extension://local/${path}`,
    getManifest: () => ({ version: '1.0.2' }),
    onMessage: { addListener: (value: Listener) => { listener = value; } },
    onConnect: { addListener: (value: (port: browser.runtime.Port) => void) => { connected = value; } },
    onInstalled: event, onStartup: event, openOptionsPage: async () => undefined
  });
  Object.assign(mock.api.permissions, { onAdded: event, onRemoved: event });
  Object.assign(mock.api, { action: { onClicked: event } });
  const dom = harness('');
  dom.context.browser = mock.api;
  dom.run(code); await settle();
  async function send(message: unknown, sender: browser.runtime.MessageSender) {
    const replies: unknown[] = [];
    assert.ok(listener);
    // Model event-page lifetime tracking through the returned Promise.
    const returned = listener(message, sender, value => { replies.push(value); });
    const keepAlive = returned && typeof returned === 'object' && 'then' in returned ? true : undefined;
    if (keepAlive) replies.push(await returned);
    await settle();
    return { keepAlive, replies: structuredClone(replies) };
  }
  function connect(sender: browser.runtime.MessageSender) {
    const pair = portPair(sender);
    assert.ok(connected);
    connected(pair.server as unknown as browser.runtime.Port);
    return pair;
  }
  return { mock, send, connect };
}

test('settings requests expose their asynchronous lifetime through a returned Promise', async () => {
  const { send } = await setup();
  const { keepAlive, replies } = await send({ type: 'reconcile' }, { id: 'local-blocklist', url: `${optionsUrl}?test=1#settings` });
  assert.equal(keepAlive, true);
  assert.equal(replies.length, 1);
  assert.equal((replies[0] as { ok: boolean }).ok, true);
});
test('a delayed storage response stays attached to the message response', async () => {
  const { mock, send } = await setup();
  let release: ((value: Record<string, unknown>) => void) | undefined;
  mock.api.storage.local.get = () => new Promise(resolve => { release = resolve; });
  let completed = false;
  const pending = send({ type: 'reconcile' }, { id: 'local-blocklist', tab: { id: 1, url: optionsUrl } } as browser.runtime.MessageSender)
    .then(result => { completed = true; return result; });
  await settle();
  assert.equal(completed, false);
  assert.ok(release);
  release(structuredClone(mock.store));
  const result = await pending;
  assert.equal(result.keepAlive, true);
  assert.equal(result.replies.length, 1);
  assert.equal((result.replies[0] as { ok: boolean }).ok, true);
});
test('a new background instance restores saved settings and responds after restart', async () => {
  const first = await setup();
  const sender = { id: 'local-blocklist', tab: { id: 1, url: optionsUrl } } as browser.runtime.MessageSender;
  await first.send({ type: 'save', config, revision: 0 }, sender);
  const restarted = await setup(false, first.mock.store);
  const result = await restarted.send({ type: 'reconcile' }, sender);
  assert.equal(result.keepAlive, true);
  assert.deepEqual(result.replies, [{ ok: true, value: {
    config, revision: 1,
    status: { rules: [{ id: 'test-rule', permission: false, network: false, script: false }], errors: [], extraOrigins: [], privateAllowed: false }
  } }]);
});

test('exact extension settings URL authenticates senders with an omitted ID or tab-only URL', async () => {
  for (const sender of [{ url: optionsUrl }, { tab: { id: 1, url: optionsUrl } }]) {
    const { mock, send } = await setup();
    const { keepAlive, replies } = await send({ type: 'save', config, revision: 0 }, sender as browser.runtime.MessageSender);
    assert.equal(keepAlive, true);
    assert.equal((replies[0] as { ok: boolean }).ok, true);
    assert.equal((mock.store.policy as typeof config).rules[0]!.domain, 'focus.test');
  }
});

test('untrusted settings requests receive an explicit error and cannot change policy', async () => {
  const senders = [
    { id: 'other-extension', url: optionsUrl },
    { id: 'local-blocklist', url: 'https://focus.test/options.html', tab: { id: 1 } },
    { url: 'safari-web-extension://other/options.html' },
    { url: `${optionsUrl}/other` },
    { url: 'https://focus.test/', tab: { id: 1, url: optionsUrl } },
    { id: 'local-blocklist' }, {}
  ];
  for (const sender of senders) {
    const { mock, send } = await setup();
    const { keepAlive, replies } = await send({ type: 'save', config, revision: 0 }, sender as browser.runtime.MessageSender);
    assert.equal(keepAlive, undefined);
    assert.equal(replies.length, 1);
    assert.equal((replies[0] as { ok: boolean }).ok, false);
    assert.equal((mock.store.policy as typeof config).rules.length, 0);
  }
});

test('diagnostics respond without waiting for storage and disclose no policy or sender identifiers', async () => {
  const { send } = await setup(true);
  const { keepAlive, replies } = await send({ type: 'diagnostics' }, { url: optionsUrl });
  assert.equal(keepAlive, undefined);
  assert.deepEqual(replies, [{ ok: true, value: {
    version: '1.0.2', senderId: 'missing', optionsUrlMatches: true, senderUrlSource: 'url', stage: 'storage:load'
  } }]);
});

test('save conflicts return a single structured error; unknown messages are ignored', async () => {
  const { send } = await setup();
  const failed = await send({ type: 'save', config, revision: 99 }, { id: 'local-blocklist', url: optionsUrl });
  assert.equal(failed.keepAlive, true);
  assert.equal(failed.replies.length, 1);
  assert.match((failed.replies[0] as { error: string }).error, /Список изменён/);
  assert.deepEqual(await send({ type: 'unknown' }, {}), { keepAlive: undefined, replies: [] });
});
test('real request client exchanges diagnostics, saves and settings over ports without sendMessage', async () => {
  const background = await setup();
  const previous = globalThis.browser;
  const pairs: ReturnType<typeof portPair>[] = [];
  globalThis.browser = { runtime: { connect: () => {
    const pair = background.connect({ id: 'local-blocklist', tab: { id: 1, url: optionsUrl } } as browser.runtime.MessageSender);
    pairs.push(pair); return pair.client;
  } } } as unknown as typeof browser;
  try {
    const diagnostics = await request<BackgroundDiagnostics>({ type: 'diagnostics' });
    assert.equal(diagnostics.optionsUrlMatches, true);
    const saved = await request<Snapshot>({ type: 'save', config, revision: 0 });
    assert.equal(saved.revision, 1);
    const snapshot = await request<Snapshot>({ type: 'snapshot' });
    assert.deepEqual(snapshot.config, config);
    const restarted = await setup(false, background.mock.store);
    globalThis.browser.runtime.connect = (() => {
      const pair = restarted.connect({ id: 'local-blocklist', tab: { id: 1, url: optionsUrl } } as browser.runtime.MessageSender);
      pairs.push(pair); return pair.client;
    }) as unknown as typeof browser.runtime.connect;
    const restored = await request<Snapshot>({ type: 'reconcile' });
    assert.deepEqual(restored.config, config);
    assert.equal(restored.revision, 1);
    assert.ok(pairs.every(pair => pair.closed));
    assert.ok(pairs.every(pair => pair.client.onMessage.size === 0 && pair.client.onDisconnect.size === 0));
  } finally { globalThis.browser = previous; }
});
test('ports enforce settings authorization and accept only one operation per connection', async () => {
  const background = await setup();
  const denied = background.connect({ id: 'local-blocklist', url: 'https://focus.test/' });
  const replies: unknown[] = [];
  denied.client.onMessage.addListener(value => { replies.push(value); });
  denied.client.postMessage({ type: 'save', config, revision: 0 });
  await settle();
  assert.equal((replies[0] as { ok: boolean }).ok, false);
  assert.equal((background.mock.store.policy as typeof config).rules.length, 0);
  denied.client.disconnect();
  const allowed = background.connect({ url: optionsUrl });
  allowed.client.postMessage({ type: 'save', config, revision: 0 });
  allowed.client.postMessage({ type: 'save', config: { ...config, rules: [] }, revision: 1 });
  await settle();
  assert.equal(background.mock.store.revision, 1);
  assert.deepEqual(background.mock.store.policy, config);
  allowed.client.disconnect();
});
test('port diagnostics remain responsive when the controller queue is blocked by storage', async () => {
  const background = await setup(true);
  const pair = background.connect({ url: optionsUrl });
  const replies: unknown[] = [];
  pair.client.onMessage.addListener(value => { replies.push(value); });
  pair.client.postMessage({ type: 'diagnostics' });
  await settle();
  assert.equal((replies[0] as { value: BackgroundDiagnostics }).value.stage, 'storage:load');
  pair.client.disconnect();
});
test('restored settings and policy requests work with a saved rule even when Safari injection APIs hang', async () => {
  let pageApiCalls = 0;
  const background = await setup(false, { policy: config, revision: 8 }, mock => {
    mock.grant(config.rules);
    mock.api.tabs.query = () => { pageApiCalls++; return new Promise(() => undefined); };
    mock.api.scripting.executeScript = () => { pageApiCalls++; return new Promise(() => undefined); };
  });
  const previous = globalThis.browser;
  globalThis.browser = { runtime: { connect: () => background.connect({
    id: 'local-blocklist', tab: { id: 1, url: optionsUrl }
  } as browser.runtime.MessageSender).client } } as unknown as typeof browser;
  try {
    const loaded = await request<Snapshot>({ type: 'reconcile' });
    assert.equal(loaded.revision, 8);
    assert.deepEqual(loaded.config, config);
    assert.equal(loaded.status.rules[0]!.network, true);
    assert.equal(loaded.status.rules[0]!.script, true);
    assert.equal((await request<BackgroundDiagnostics>({ type: 'diagnostics' })).stage, 'ready');
    const changed = await request<Snapshot>({ type: 'save', config, revision: 8 });
    assert.equal(changed.revision, 9);
    assert.equal(pageApiCalls, 0);
  } finally { globalThis.browser = previous; }
});
test('registered scripts block an SPA route after page reload and after a new background instance', async () => {
  const sectionConfig: Config = { schemaVersion: 2, rules: [{
    id: 'shorts', domain: 'focus.test', kind: 'section', path: '/shorts', includeSubdomains: false
  }] };
  const guard = await source('src/guard.ts'), history = await source('src/history.ts');
  let store: Record<string, unknown> = { policy: sectionConfig, revision: 4 };
  for (let restart = 0; restart < 2; restart++) {
    const background = await setup(false, store, mock => {
      mock.grant(sectionConfig.rules);
      mock.api.scripting.executeScript = () => new Promise(() => undefined);
    });
    // Model a document load using the actual files registered by the controller.
    const page = harness('<html><body><div id="allowed">Allowed</div><video></video></body></html>', 'https://focus.test/watch');
    background.mock.api.tabs.get = async () => ({ id: 7, url: page.location.href }) as browser.tabs.Tab;
    Object.assign(page.window.document.querySelector('video')!, { pause: () => undefined });
    page.context.browser = {
      runtime: { connect: () => background.connect({
        id: 'local-blocklist', url: page.location.href, tab: { id: 7, url: page.location.href }, frameId: 0
      } as browser.runtime.MessageSender).client },
      storage: { onChanged: { addListener: () => undefined } }
    };
    assert.deepEqual(background.mock.scripts.map(script => script.js?.[0]).sort(), ['guard.js', 'history.js']);
    assert.ok(background.mock.scripts.every(script => script.runAt === 'document_start' && script.allFrames));
    page.run(history); page.run(guard); await settle();
    assert.ok(page.window.document.getElementById('allowed'));
    page.run("history.pushState({}, '', '/shorts/example')"); await settle();
    assert.equal(page.window.document.getElementById('allowed'), null);
    assert.match(page.window.document.body.textContent, /Доступ заблокирован/);
    assert.deepEqual(background.mock.updates, [{ id: 7, url: 'safari-web-extension://local/blocked.html#shorts' }]);
    store = structuredClone(background.mock.store);
  }
});
