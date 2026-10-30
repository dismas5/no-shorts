import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, settle, source } from './dom-harness.ts';
import { connectTo } from './mock-port.ts';
const policy = [{ id: 'guard-rule', name: 'Мой раздел', kind: 'section', domain: 'focus.test', path: '/section', includeSubdomains: false }];
const historySource = await source('src/history.ts'), guardSource = await source('src/guard.ts');
async function setup(href?: string) {
  const dom = harness('<html><head></head><body><a id="link" href="https://focus.test/section">Link</a><video autoplay></video><div id="content">Allowed content</div></body></html>', href);
  let allowed = true, pauses = 0;
  const messages: Record<string, unknown>[] = [];
  let storageChanged: () => void = () => undefined;
  const video = dom.window.document.querySelector('video')!;
  Object.assign(video, { pause: () => { pauses++; } });
  dom.context.browser = { runtime: { connect: connectTo(async (message: Record<string, unknown>) => {
    messages.push(message);
    return { ok: true, value: message.type === 'guardRules' ? (allowed ? policy : []) : true };
  }) }, storage: { onChanged: { addListener: (fn: (changes: object, area: string) => void) => { storageChanged = () => fn({ protectionEpoch: {} }, 'local'); } } } };
  dom.run(historySource); dom.run(guardSource); await settle();
  return { ...dom, messages, get pauses() { return pauses; }, revoke: async () => { allowed = false; storageChanged(); await settle(); } };
}
test('allowed pages retain their content; page-world pushState blocks immediately and pauses media', async () => {
  const dom = await setup(); assert.ok(dom.window.document.getElementById('content'));
  dom.run("history.pushState({}, '', '/allowed-again')"); assert.ok(dom.window.document.getElementById('content'));
  dom.run("history.pushState({}, '', '/section/item?q=private')"); await settle();
  assert.equal(dom.pauses, 1); assert.equal(dom.window.document.getElementById('content'), null);
  assert.ok(dom.window.document.body.textContent.includes('Мой раздел'));
  assert.equal(dom.messages.filter(message => message.type === 'block').length, 1);
});
test('replaceState and popstate/pageshow catch URL changes; restored document rechecks rules', async () => {
  for (const action of ['replace', 'popstate', 'pageshow', 'focus', 'fallback']) {
    const dom = await setup();
    if (action === 'replace') dom.run("history.replaceState({}, '', '/section')");
    else {
      dom.location.href = 'https://focus.test/section';
      if (action === 'fallback') { const fn = [...dom.timers.values()][0]!; fn(); }
      else dom.fire(dom.window, action);
    }
    await settle(); assert.equal(dom.messages.filter(message => message.type === 'block').length, 1, action);
  }
});
test('captured same-tab link is stopped before page listener and produces a block request', async () => {
  const dom = await setup(); const link = dom.window.document.getElementById('link')!;
  const event = new dom.window.Event('click', { bubbles: true, cancelable: true });
  Object.assign(event, { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  link.dispatchEvent(event); await settle();
  assert.equal(event.defaultPrevented, true);
  assert.equal(dom.messages.find(message => message.type === 'block')?.target, 'https://focus.test/section');
});
test('double injection keeps one set of handlers and bounded fallback; revocation stops guard', async () => {
  const dom = await setup(); dom.run(historySource); dom.run(guardSource); await settle();
  assert.equal(dom.timers.size, 1);
  await dom.revoke(); assert.equal(dom.timers.size, 0);
  dom.run("history.pushState({}, '', '/section')"); await settle();
  assert.ok(dom.window.document.getElementById('content'));
  assert.equal(dom.messages.filter(message => message.type === 'block').length, 0);
});
test('page-world notifications are hints: a forged event cannot choose a blocked URL', async () => {
  const dom = await setup(); dom.fire(dom.window, 'local-blocklist:location'); await settle();
  assert.equal(dom.messages.filter(message => message.type === 'block').length, 0);
  assert.ok(dom.window.document.getElementById('content'));
});
