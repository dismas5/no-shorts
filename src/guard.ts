import { matchUrl, ruleLabel, type Rule } from './core/policy.ts';
import { request } from './runtime/contracts.ts';
interface GuardHandle { refresh(): Promise<void> }
const scope = globalThis as typeof globalThis & { __localBlocklistGuard?: GuardHandle };
if (scope.__localBlocklistGuard) void scope.__localBlocklistGuard.refresh();
else {
  let rules: Rule[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let blocked = false;
  let lastAddress = '';
  let generation = 0;
  function stopPlayers(root: Document | ShadowRoot): void {
    for (const element of root.querySelectorAll('*')) {
      if (element instanceof HTMLMediaElement) {
        try { element.pause(); element.muted = true; element.removeAttribute('autoplay'); } catch { /* Detached media. */ }
      }
      if (element.shadowRoot) stopPlayers(element.shadowRoot);
    }
    // Removing frames unloads embedded players without reading their contents.
    for (const frame of root.querySelectorAll('iframe')) frame.remove();
  }
  function stopScreen(rule: Rule, target: string): void {
    if (blocked) return;
    blocked = true;
    if (timer) clearTimeout(timer);
    stopPlayers(document);
    window.stop();
    const body = document.createElement('body');
    const title = document.createElement('h1');
    title.textContent = 'Доступ заблокирован';
    const reason = document.createElement('p');
    reason.textContent = `Правило: ${ruleLabel(rule)}`;
    const settings = document.createElement('button');
    settings.textContent = 'Настройки Local Blocklist';
    settings.addEventListener('click', () => { void request({ type: 'openOptions' }).catch(() => undefined); });
    body.append(title, reason, settings);
    body.style.cssText = 'display:block!important;background:#f6f7f3!important;color:#172820!important;padding:32px!important;font:18px system-ui!important;visibility:visible!important;';
    document.documentElement.replaceChildren(body);
    if (window === window.top) {
      void request<boolean>({ type: 'block', source: location.href, target }).catch(() => {
        reason.textContent += '. Не удалось заменить вкладку; просмотр остановлен. Перезагрузите расширение.';
      });
    }
  }
  function check(force = false): void {
    if (blocked || !rules.length) return;
    const address = location.href;
    if (!force && lastAddress === address) return;
    lastAddress = address;
    const rule = matchUrl(rules, address);
    if (rule) stopScreen(rule, address);
  }
  function schedule(): void {
    if (timer) clearTimeout(timer);
    if (!rules.length || blocked) return;
    timer = setTimeout(() => { check(); schedule(); }, document.hidden ? 3000 : 750);
  }
  const changed = () => { check(true); schedule(); };
  for (const event of ['local-blocklist:location', 'popstate', 'hashchange', 'pageshow', 'focus']) window.addEventListener(event, changed, true);
  document.addEventListener('visibilitychange', changed, true);
  document.addEventListener('click', event => {
    if (blocked || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target.toLowerCase() !== '_self')) return;
    const rule = matchUrl(rules, anchor.href);
    if (!rule) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopScreen(rule, anchor.href);
  }, true);
  async function refresh(): Promise<void> {
    const current = ++generation;
    try {
      const next = await request<Rule[]>({ type: 'guardRules' });
      if (current === generation) rules = next;
    } catch { if (current === generation) rules = []; }
    check(true);
    schedule();
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('policy' in changes || 'protectionEpoch' in changes)) void refresh();
  });
  scope.__localBlocklistGuard = { refresh };
  void refresh();
}
