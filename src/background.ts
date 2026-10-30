import { Controller } from './runtime/controller.ts';
import { requestPortName, type BackgroundDiagnostics } from './runtime/contracts.ts';
const controller = new Controller(browser);
const reply = <T>(task: () => Promise<T>) => controller.run(task).then(value => ({ ok: true, value }),
  () => ({ ok: false, error: 'Операция не завершена. Проверьте конфигурацию, разрешения и перезапустите расширение.' }));
const optionsUrl = browser.runtime.getURL('options.html');
function handleMessage(message: unknown, sender: browser.runtime.MessageSender) {
  if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
  const input = message as Record<string, unknown>;
  const senderUrl = sender.url ?? sender.tab?.url;
  const optionsUrlMatches = senderUrl?.split(/[?#]/)[0] === optionsUrl;
  // An exact browser-supplied extension URL authenticates settings even if the
  // browser omits the optional sender.id. An explicitly different ID is rejected.
  const trustedOptions = optionsUrlMatches && (sender.id === undefined || sender.id === browser.runtime.id);
  if (input.type === 'diagnostics') {
    // No policy, URLs, identifiers or browsing data in this read-only response.
    const value: BackgroundDiagnostics = {
      version: browser.runtime.getManifest().version,
      senderId: sender.id === undefined ? 'missing' : sender.id === browser.runtime.id ? 'same' : 'different',
      optionsUrlMatches,
      senderUrlSource: sender.url !== undefined ? 'url' : sender.tab?.url !== undefined ? 'tab' : 'missing',
      stage: controller.diagnosticsStage
    };
    return { ok: true, value };
  }
  let response: Promise<unknown> | undefined;
  if (input.type === 'snapshot' || input.type === 'reconcile' || input.type === 'save') {
    if (!trustedOptions) {
      return { ok: false, error: 'Фон получил запрос, но не подтвердил, что он пришёл со страницы настроек. Откройте настройки заново через значок расширения.' };
    }
    if (input.type === 'snapshot') response = reply(() => controller.snapshot());
    if (input.type === 'reconcile') response = reply(() => controller.reconcile());
    if (input.type === 'save') response = controller.run(() => controller.save(input.config, input.revision)).then(value => ({ ok: true, value }),
      error => ({ ok: false, error: error instanceof Error ? error.message : 'Не удалось сохранить список.' }));
  }
  if (sender.id === browser.runtime.id && sender.tab) {
    if (input.type === 'guardRules') response = reply(() => controller.guardRules(senderUrl ?? ''));
    if (input.type === 'block') response = reply(() => controller.block(sender, input.source, input.target));
    if (input.type === 'openOptions') response = reply(() => browser.runtime.openOptionsPage());
  }
  if (response) {
    // Let the event-page lifecycle track the asynchronous work itself. Keep
    // synchronous sendResponse only for diagnostics and authorization failures.
    return response.catch(() => ({ ok: false, error: 'Фоновый компонент не смог обработать запрос.' }));
  }
  return undefined;
}
// Retain one-shot messages for scripts from an already open, older document.
browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const response = handleMessage(message, sender);
  if (response instanceof Promise) return response;
  if (response !== undefined) sendResponse(response);
  return undefined;
});
browser.runtime.onConnect.addListener(port => {
  if (port.name !== requestPortName) return;
  let received = false, closed = false;
  const respond = (response: unknown) => {
    if (closed) return;
    try { port.postMessage(response); }
    catch {
      try { port.postMessage({ ok: false, error: 'Не удалось передать результат операции из расширения.' }); }
      catch { /* The page disconnected while the operation completed. */ }
    }
  };
  const onMessage = (message: unknown) => {
    if (received) return;
    received = true;
    try {
      const response = handleMessage(message, port.sender ?? {});
      void Promise.resolve(response).then(value => respond(value ?? { ok: false, error: 'Запрос не поддерживается или отправитель не подтверждён.' }),
        () => respond({ ok: false, error: 'Не удалось выполнить запрос расширения.' }));
    } catch { respond({ ok: false, error: 'Не удалось обработать запрос расширения.' }); }
  };
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    closed = true;
    port.onMessage.removeListener(onMessage);
  });
});
const reconcile = () => { void controller.run(() => controller.reconcile()).catch(() => undefined); };
browser.runtime.onInstalled.addListener(reconcile);
browser.runtime.onStartup.addListener(reconcile);
browser.permissions.onAdded.addListener(reconcile);
browser.permissions.onRemoved.addListener(reconcile);
browser.action.onClicked.addListener(() => { void browser.runtime.openOptionsPage(); });
// Listeners are installed synchronously, before initialization of a disposable background page.
reconcile();
