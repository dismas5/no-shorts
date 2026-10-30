import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Controller } from '../src/runtime/controller.ts';
import { mockBrowser } from './mock-browser.ts';
import { harness, settle, source } from './dom-harness.ts';
import { connectTo } from './mock-port.ts';
const code = await source('src/ui/options.ts');
async function setup(startup?: 'reject' | 'pending' | 'no-listener') {
  const dom = harness(await readFile('public/options.html', 'utf8'));
  const mock = mockBrowser(); const controller = new Controller(mock.api);
  let grant = false; const requested: string[][] = [];
  dom.context.browser = {
    permissions: { request: async ({ origins }: { origins: string[] }) => { requested.push(origins); if (grant) {
      const { config } = await controller.snapshot();
      // The UI requests exactly the form's origins; the test records the request before saving.
      mock.api.permissions.contains = async ({ origins: values }) => values?.every(origin => requested.flat().includes(origin)) ?? false;
      mock.grant(config.rules);
    } return grant; } },
    runtime: { connect: connectTo(async (message: Record<string, unknown>) => {
      if (startup === 'no-listener') { startup = undefined; return undefined; }
      if (message.type === 'diagnostics') return { ok: true, value: {
        version: '1.0.2', senderId: 'same', optionsUrlMatches: true, senderUrlSource: 'url', stage: 'ready'
      } };
      if (startup) {
        const failure = startup;
        startup = undefined;
        if (failure === 'pending') return new Promise(() => undefined);
        throw dom.run("new Error('Background startup failed')");
      }
      try {
        const value = await controller.run(async () => message.type === 'save' ? controller.save(message.config, message.revision) : controller.reconcile());
        return { ok: true, value };
      } catch (error) { return { ok: false, error: (error as Error).message }; }
    }) }
  };
  dom.run(code); await settle();
  const input = (id: string, value: string) => { (dom.window.document.getElementById(id) as HTMLInputElement).value = value; };
  const click = (id: string) => dom.fire(dom.window.document.getElementById(id)!, 'click');
  const submit = () => dom.fire(dom.window.document.getElementById('rule-form')!, 'submit');
  return { ...dom, mock, controller, input, click, submit, requested, allow: () => { grant = true; } };
}
test('failed initialization explains why saving is unavailable and allows a retry', async () => {
  const dom = await setup('reject');
  assert.match(dom.window.document.getElementById('status')!.textContent, /Не удалось загрузить/);
  assert.match(dom.window.document.getElementById('notice')!.textContent, /Background startup failed/);
  assert.match(dom.window.document.getElementById('startup-diagnostics')!.textContent, /Загрузка остановлена: Background startup failed/);
  assert.equal(dom.timers.size, 0, 'failed requests must release their timers');
  dom.input('domain', 'focus.test'); dom.submit(); await settle();
  assert.match(dom.window.document.getElementById('form-error')!.textContent, /Состояние расширения не загружено/);
  assert.equal(dom.requested.length, 0, 'do not request permissions without a loaded configuration');
  dom.click('refresh'); await settle();
  dom.submit(); await settle();
  assert.equal((await dom.controller.snapshot()).config.rules[0]!.domain, 'focus.test');
  assert.equal(dom.timers.size, 0, 'successful requests must release their timers');
});
test('a background that never responds times out and releases the settings form', async () => {
  const dom = await setup('pending');
  assert.equal(dom.window.document.getElementById('save-rule')!.hasAttribute('disabled'), true);
  assert.match(dom.window.document.getElementById('startup-diagnostics')!.textContent, /Фон ответил\. Ожидание состояния защиты/);
  assert.equal(dom.timers.size, 1);
  for (const callback of [...dom.timers.values()]) callback();
  await settle();
  assert.match(dom.window.document.getElementById('status')!.textContent, /Не удалось загрузить/);
  assert.match(dom.window.document.getElementById('notice')!.textContent, /10 секунд/);
  assert.match(dom.window.document.getElementById('startup-diagnostics')!.textContent, /Загрузка остановлена:.*10 секунд/);
  assert.equal(dom.window.document.getElementById('save-rule')!.hasAttribute('disabled'), false);
  dom.click('refresh'); await settle();
  assert.match(dom.window.document.getElementById('status')!.textContent, /Список пуст/);
  assert.match(dom.window.document.getElementById('startup-diagnostics')!.textContent, /Начальное состояние получено/);
});
test('missing background handshake reports a startup failure and can be retried', async () => {
  const dom = await setup('no-listener');
  assert.match(dom.window.document.getElementById('status')!.textContent, /Не удалось загрузить/);
  assert.match(dom.window.document.getElementById('startup-diagnostics')!.textContent, /Загрузка остановлена: Соединение с расширением закрылось/);
  assert.equal(dom.timers.size, 0);
  assert.equal(dom.requested.length, 0);
  dom.click('refresh'); await settle();
  assert.match(dom.window.document.getElementById('startup-diagnostics')!.textContent, /Начальное состояние получено.*Фон: 1\.0\.2/);
});
test('settings start empty, validate, add with denied access, edit same ID, grant and delete', async () => {
  const dom = await setup();
  assert.ok(dom.window.document.getElementById('rule-list')!.textContent.includes('Пока здесь свободно'));
  dom.input('domain', 'https://wrong.test'); dom.submit(); await settle();
  assert.equal((await dom.controller.snapshot()).config.rules.length, 0);
  assert.ok(dom.window.document.getElementById('form-error')!.textContent);
  dom.input('domain', 'focus.test'); dom.input('rule-name', 'Мой список'); dom.submit(); await settle();
  let snapshot = await dom.controller.snapshot(); const id = snapshot.config.rules[0]!.id;
  assert.deepEqual(structuredClone(dom.requested), [['http://focus.test/*', 'https://focus.test/*']]);
  assert.ok(dom.window.document.getElementById('rule-list')!.textContent.includes('Нет доступа'));
  const edit = dom.window.document.querySelector<HTMLButtonElement>('.rule-row button')!;
  dom.fire(edit, 'click'); dom.input('rule-name', 'Новое название'); dom.submit(); await settle();
  snapshot = await dom.controller.snapshot(); assert.equal(snapshot.config.rules[0]!.id, id); assert.equal(snapshot.config.rules[0]!.name, 'Новое название');
  dom.allow(); const grantButton = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Запросить доступ')!;
  dom.fire(grantButton, 'click'); await settle(); assert.equal((await dom.controller.snapshot()).status.rules[0]!.network, true);
  assert.match(dom.window.document.getElementById('rule-list')!.textContent, /скрипты: зарегистрированы/);
  assert.match(dom.window.document.getElementById('reload-note')!.textContent, /перезагрузите уже открытые вкладки/);
  const remove = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Удалить')!;
  dom.fire(remove, 'click'); await settle(); assert.equal((await dom.controller.snapshot()).config.rules.length, 0);
});
test('JSON import is previewed before replacement; invalid import leaves list unchanged; export roundtrips', async () => {
  const dom = await setup();
  const input = dom.window.document.getElementById('import-file')!;
  const json = JSON.stringify({ schemaVersion: 2, rules: [{ id: 'import-id', domain: 'focus.test', kind: 'exact', path: '/page/', includeSubdomains: false }] });
  Object.assign(input, { files: [{ size: json.length, text: async () => json }] });
  dom.fire(input, 'change'); await settle();
  assert.equal((await dom.controller.snapshot()).config.rules.length, 0);
  assert.equal(dom.window.document.getElementById('json-panel')!.hidden, false);
  dom.click('import-apply'); await settle(); assert.equal((await dom.controller.snapshot()).config.rules[0]!.id, 'import-id');
  Object.assign(input, { files: [{ size: 1, text: async () => '{' }] }); dom.fire(input, 'change'); await settle();
  assert.ok(dom.window.document.getElementById('import-error')!.textContent);
  assert.equal((await dom.controller.snapshot()).config.rules[0]!.id, 'import-id');
  dom.click('export'); await settle();
  const exported = JSON.parse((dom.window.document.getElementById('json-preview') as HTMLTextAreaElement).value);
  assert.deepEqual(exported, (await dom.controller.snapshot()).config);
  dom.input('test-url', 'https://focus.test/page/'); dom.fire(dom.window.document.getElementById('test-form')!, 'submit');
  assert.ok(dom.window.document.getElementById('test-result')!.textContent.includes('не подтверждена'));
});
