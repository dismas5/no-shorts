import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/runtime/contracts.ts';
import { portPair } from './mock-port.ts';
import { settle } from './dom-harness.ts';

test('timeout closes the port, removes listeners and never retries a save', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pair = portPair();
  let calls = 0;
  pair.server.onMessage.addListener(() => { calls++; });
  const previous = globalThis.browser;
  globalThis.browser = { runtime: { connect: () => pair.client } } as unknown as typeof browser;
  try {
    const pending = request({ type: 'save' });
    const rejected = assert.rejects(pending, /10 секунд.*операция могла завершиться/);
    await settle();
    context.mock.timers.tick(10_000);
    await rejected;
    assert.equal(calls, 1);
    assert.equal(pair.closed, true);
    assert.equal(pair.client.onMessage.size, 0);
    assert.equal(pair.client.onDisconnect.size, 0);
  } finally { globalThis.browser = previous; }
});
test('a disconnected background rejects promptly and a later request creates a fresh connection', async () => {
  const pairs: ReturnType<typeof portPair>[] = [];
  const previous = globalThis.browser;
  globalThis.browser = { runtime: { connect: () => {
    const pair = portPair(); pairs.push(pair);
    pair.server.onMessage.addListener(() => {
      if (pairs.length === 1) pair.server.disconnect();
      else pair.server.postMessage({ ok: true, value: 'restored' });
    });
    return pair.client;
  } } } as unknown as typeof browser;
  try {
    await assert.rejects(request({ type: 'snapshot' }), /Соединение с расширением закрылось/);
    assert.equal(await request({ type: 'snapshot' }), 'restored');
    assert.equal(pairs.length, 2);
    assert.ok(pairs.every(pair => pair.closed && pair.client.onMessage.size === 0));
  } finally { globalThis.browser = previous; }
});
test('malformed replies are rejected and synchronous postMessage failures clean up', async () => {
  const previous = globalThis.browser;
  const malformed = portPair();
  malformed.server.onMessage.addListener(() => malformed.server.postMessage({ unexpected: true }));
  globalThis.browser = { runtime: { connect: () => malformed.client } } as unknown as typeof browser;
  try {
    await assert.rejects(request({ type: 'snapshot' }), /некорректный ответ/);
    const failed = portPair();
    failed.client.postMessage = () => { throw new Error('serialization'); };
    globalThis.browser.runtime.connect = (() => failed.client) as unknown as typeof browser.runtime.connect;
    await assert.rejects(request({ type: 'save' }), /Не удалось отправить запрос/);
    assert.ok(failed.closed && failed.client.onMessage.size === 0 && failed.client.onDisconnect.size === 0);
  } finally { globalThis.browser = previous; }
});
