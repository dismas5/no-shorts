import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controller, grantNeeded } from '../src/runtime/controller.ts';
import { emptyConfig, normalizeRule } from '../src/core/policy.ts';
import { mockBrowser } from './mock-browser.ts';
const row = normalizeRule({ id: 'r', domain: 'focus.test', kind: 'section', path: '/section', includeSubdomains: false });
const config = { schemaVersion: 2 as const, rules: [row] };
test('add denied, grant, edit, remove: actual protection and scoped script matches', async () => {
  const mock = mockBrowser(); const controller = new Controller(mock.api);
  assert.deepEqual((await controller.reconcile()).config, emptyConfig());
  let result = await controller.save(config, 0);
  assert.deepEqual(result.status.rules[0], { id: 'r', permission: false, network: false, script: false });
  assert.equal(mock.network.length, 0); assert.equal(mock.scripts.length, 0);
  mock.grant(config.rules); result = await controller.reconcile();
  assert.deepEqual(result.status.rules[0], { id: 'r', permission: true, network: true, script: true });
  assert.deepEqual(result.status.errors, []);
  assert.equal(mock.network.length, 1);
  for (const script of mock.scripts) {
    assert.deepEqual(script.matches, ['http://focus.test/*', 'https://focus.test/*']);
    assert.equal(script.runAt, 'document_start'); assert.equal(script.persistAcrossSessions, true);
  }
  result = await controller.save({ ...config, rules: [{ ...row, path: '/other' }] }, 1);
  assert.equal(result.config.rules[0]!.id, 'r');
  assert.ok(mock.network[0]!.condition.regexFilter?.includes('/other'));
  result = await controller.save(emptyConfig(), 2);
  assert.deepEqual(result.status.errors, []); assert.deepEqual(mock.grants, []);
  assert.equal(mock.network.length, 0); assert.equal(mock.scripts.length, 0);
});
test('revocation clears derived policies; restart reinitializes from sole storage source', async () => {
  const mock = mockBrowser(); mock.grant(config.rules);
  const first = new Controller(mock.api); await first.save(config, 0);
  const restarted = new Controller(mock.api);
  assert.equal((await restarted.reconcile()).status.rules[0]!.network, true);
  mock.revoke(); const revoked = await restarted.reconcile();
  assert.equal(revoked.status.rules[0]!.permission, false);
  assert.equal(mock.network.length, 0); assert.equal(mock.scripts.length, 0);
  assert.deepEqual(revoked.config, config);
});
test('apply errors never report full protection, configuration remains retryable; no URL in diagnostics', async () => {
  const mock = mockBrowser(); mock.grant(config.rules); mock.fail('network');
  const controller = new Controller(mock.api); const failed = await controller.save(config, 0);
  assert.equal(failed.status.rules[0]!.network, false); assert.equal(failed.status.rules[0]!.script, true);
  assert.ok(failed.status.errors.length); assert.ok(!JSON.stringify(failed.status.errors).includes('sensitive'));
  mock.fail('network', false); mock.fail('scripts');
  // Force a registration change to exercise the failure, preserving network protection.
  mock.scripts.splice(0);
  const scriptFailure = await controller.reconcile();
  assert.equal(scriptFailure.status.rules[0]!.script, false); assert.equal(scriptFailure.status.rules[0]!.network, true);
  mock.fail('scripts', false); assert.deepEqual((await controller.reconcile()).status.errors, []);
});
test('atomic storage failure and concurrent editor conflict do not overwrite saved policy', async () => {
  const mock = mockBrowser(); const controller = new Controller(mock.api); await controller.reconcile();
  mock.fail('storage'); await assert.rejects(controller.save(config, 0));
  mock.fail('storage', false); assert.deepEqual((await controller.snapshot()).config, emptyConfig());
  await controller.save(config, 0); await assert.rejects(controller.save(emptyConfig(), 0), /другой вкладке/);
  assert.deepEqual((await controller.snapshot()).config, config);
});
test('corrupt or newer stored configuration is not overwritten', async () => {
  const mock = mockBrowser(); mock.store.policy = { schemaVersion: 100, rules: [] };
  const controller = new Controller(mock.api); await assert.rejects(controller.reconcile());
  assert.equal((mock.store.policy as { schemaVersion: number }).schemaVersion, 100);
});
test('overlapping grants are retained while needed; unused grants are removed', () => {
  assert.equal(grantNeeded('https://*.focus.test/*', ['https://sub.focus.test/*']), true);
  assert.equal(grantNeeded('https://focus.test/*', ['https://*.focus.test/*']), true);
  assert.equal(grantNeeded('https://unused.test/*', ['https://focus.test/*']), false);
  assert.equal(grantNeeded('http://focus.test/*', ['https://focus.test/*']), false);
  assert.equal(grantNeeded('https://focus.test/*', []), false);
});
test('block messages are revalidated; no full URL in blocked-page address or persistent storage', async () => {
  const mock = mockBrowser(); mock.grant(config.rules); const controller = new Controller(mock.api); await controller.save(config, 0);
  const sender = { tab: { id: 7 }, frameId: 0 } as browser.runtime.MessageSender;
  assert.equal(await controller.block(sender, 'https://focus.test/stale', 'https://focus.test/section'), false);
  assert.equal(await controller.block(sender, 'https://focus.test/section', 'https://evil.test/section'), false);
  assert.equal(await controller.block({ ...sender, frameId: 1 }, 'https://focus.test/section', 'https://focus.test/section'), false);
  assert.equal(await controller.block(sender, 'https://focus.test/section', 'https://focus.test/section?secret'), true);
  assert.deepEqual(mock.updates, [{ id: 7, url: 'moz-extension://local/blocked.html#r' }]);
  assert.ok(!JSON.stringify(mock.store).includes('secret'));
});
test('permissions.onAdded reconciliation cannot revoke a just-requested grant before save', async () => {
  const mock = mockBrowser(); const controller = new Controller(mock.api);
  await controller.reconcile(); mock.grant(config.rules);
  // onAdded is delivered before the options page receives permissions.request's resolution.
  await controller.reconcile();
  assert.ok(mock.grants.length);
  const saved = await controller.save(config, 0);
  assert.equal(saved.status.rules[0]!.permission, true);
  assert.equal(saved.status.rules[0]!.network, true);
});
test('unexpected browser API failure after saving reports desired policy without stale active status', async () => {
  const mock = mockBrowser(); mock.grant(config.rules); const controller = new Controller(mock.api);
  await controller.save(config, 0);
  mock.api.permissions.getAll = async () => { throw new Error('unavailable'); };
  const result = await controller.save({ ...config, rules: [{ ...row, path: '/new' }] }, 1);
  assert.equal(result.config.rules[0]!.path, '/new');
  assert.equal(result.status.rules[0]!.network, false); assert.equal(result.status.rules[0]!.script, false);
  assert.ok(result.status.errors.length);
});
test('unsupported DNR regex is an explicit partial failure; failed deletion warns about retained rules', async () => {
  const mock = mockBrowser(); mock.grant(config.rules); const controller = new Controller(mock.api);
  mock.api.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false });
  const rejected = await controller.save(config, 0);
  assert.equal(rejected.status.rules[0]!.network, false); assert.ok(rejected.status.errors.length);
  mock.api.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: true });
  await controller.reconcile(); mock.fail('network');
  const removed = await controller.save(emptyConfig(), 1);
  assert.equal(removed.config.rules.length, 0); assert.equal(mock.network.length, 1); assert.ok(removed.status.errors.length);
  mock.fail('network', false); await controller.reconcile(); assert.equal(mock.network.length, 0);
});
test('section and exact rules work with a URL filter engine that rejects alternation', async () => {
  const mock = mockBrowser(); mock.grant(config.rules);
  mock.api.declarativeNetRequest.isRegexSupported = async ({ regex }) => ({
    isSupported: !regex.replace(/\\./g, '').includes('|'), reason: 'syntaxError'
  });
  const controller = new Controller(mock.api);
  let result = await controller.save(config, 0);
  assert.equal(result.status.rules[0]!.network, true);
  result = await controller.save({ ...config, rules: [{ ...row, kind: 'exact' }] }, 1);
  assert.equal(result.status.rules[0]!.network, true);
  assert.deepEqual(result.status.errors, []);
});
test('network diagnostics distinguish regex rejection, update failure and readback mismatch', async () => {
  const mock = mockBrowser(); mock.grant(config.rules);
  mock.api.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: false, reason: 'syntaxError' });
  const controller = new Controller(mock.api);
  assert.match((await controller.save(config, 0)).status.errors.join(), /dnr:regex-syntax/);
  mock.api.declarativeNetRequest.isRegexSupported = async () => ({ isSupported: true });
  mock.fail('network');
  assert.match((await controller.reconcile()).status.errors.join(), /dnr:update/);
  mock.fail('network', false);
  mock.api.declarativeNetRequest.getDynamicRules = async () => [];
  assert.match((await controller.reconcile()).status.errors.join(), /dnr:readback/);
});
test('settings remain responsive when open-tab script APIs never settle', async () => {
  const mock = mockBrowser(); mock.grant(config.rules);
  const calls: string[] = [];
  mock.api.tabs.query = async () => [{ id: 7, url: 'https://focus.test/allowed' } as browser.tabs.Tab];
  mock.api.scripting.executeScript = () => {
    calls.push('executeScript');
    return new Promise(() => undefined);
  };
  const controller = new Controller(mock.api);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Settings blocked at ${controller.diagnosticsStage}`)), 500);
  });
  try {
    const saved = await Promise.race([controller.run(() => controller.save(config, 0)), deadline]);
    assert.equal(saved.revision, 1);
    assert.equal(saved.status.rules[0]!.network, true);
    assert.equal(saved.status.rules[0]!.script, true);
    assert.equal(mock.scripts.length, 2);
    mock.api.tabs.query = () => {
      calls.push('tabs.query');
      return new Promise(() => undefined);
    };
    const reread = await Promise.race([controller.run(() => controller.reconcile()), deadline]);
    assert.deepEqual(reread.config, config);
    const deleted = await Promise.race([controller.run(() => controller.save(emptyConfig(), 1)), deadline]);
    assert.equal(deleted.revision, 2);
    assert.deepEqual(deleted.config, emptyConfig());
    assert.equal(mock.network.length, 0);
    assert.equal(mock.scripts.length, 0);
    assert.deepEqual(calls, []);
  } finally { clearTimeout(timer); }
});
