import { allOrigins, exportConfig, matchUrl, normalizeRule, normalizeConfig, originsFor, parseHttpUrl, parseImport, ruleLabel, type Config, type Rule } from '../core/policy.ts';
import { request } from '../runtime/contracts.ts';
import type { BackgroundDiagnostics, Snapshot } from '../runtime/contracts.ts';
import { el, errorText, text } from './dom.ts';
let snapshot: Snapshot | undefined;
let editing: string | undefined;
let imported: Config | undefined;
let busy = false;
const kinds = { site: 'Весь сайт', section: 'Раздел', exact: 'Точная страница' };
const form = el<HTMLFormElement>('rule-form');
const domain = el<HTMLInputElement>('domain');
const name = el<HTMLInputElement>('rule-name');
const subdomains = el<HTMLInputElement>('subdomains');
const kind = el<HTMLSelectElement>('kind');
const path = el<HTMLInputElement>('path');
const announce = (message: string) => { el('notice').textContent = message; };
function button(label: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button'; node.textContent = label; node.addEventListener('click', action);
  return node;
}
function render(): void {
  if (!snapshot) return;
  const { config, status } = snapshot;
  const complete = status.rules.filter(rule => rule.permission && rule.network && rule.script).length;
  el('status').textContent = !config.rules.length ? 'Список пуст. Сайты не блокируются.' :
    `${complete} из ${config.rules.length} правил: доступ, сетевые правила и скрипты настроены.${status.errors.length ? ' Есть ошибки применения.' : ''}`;
  el('errors').replaceChildren(...status.errors.map(error => text('li', error)));
  el('private-status').textContent = status.privateAllowed ? 'Приватный режим: расширению разрешена работа. Доступ к сайтам также необходим.' : 'Приватный режим: доступ не подтверждён. Разрешите работу расширения в приватных окнах в настройках браузера.';
  el('extra-grants').textContent = status.extraOrigins.length ? 'Сохранены дополнительные разрешения, которые могут покрывать другие правила. Проверить и сузить их можно в настройках браузера.' : '';
  el('count').textContent = `${config.rules.length} / 100`;
  const rows = config.rules.map(rule => {
    const row = text('article', '', 'rule-row');
    row.append(text('h3', ruleLabel(rule)), text('p', `${kinds[rule.kind]} · ${rule.domain}${rule.path ?? ''}${rule.includeSubdomains ? ' · с поддоменами' : ''}`, 'rule-address'));
    const state = status.rules.find(state => state.id === rule.id);
    row.append(text('p', !state?.permission ? 'Нет доступа · правило не активно' :
      `Сеть: ${state.network ? 'активна' : 'ошибка'} · скрипты: ${state.script ? 'зарегистрированы' : 'не зарегистрированы'}`, 'rule-status'));
    const actions = text('div', '', 'actions');
    actions.append(button('Изменить', () => edit(rule)), button('Удалить', () => { void remove(rule.id); }));
    if (!state?.permission) actions.append(button('Запросить доступ', () => { void grant(rule); }));
    row.append(actions); return row;
  });
  if (!rows.length) {
    const empty = text('div', '', 'empty');
    empty.append(text('strong', 'Пока здесь свободно.'), text('p', 'Добавьте первое правило. Сайты и разделы не заданы заранее.', 'muted'));
    rows.push(empty);
  }
  el('rule-list').replaceChildren(...rows);
}
function startupDiagnostics(stage: string, background?: BackgroundDiagnostics): void {
  const available = typeof browser !== 'undefined';
  const details = [stage, `browser: ${available ? 'доступен' : 'недоступен'}`];
  if (available) {
    details.push(`runtime.connect: ${typeof browser.runtime?.connect}`,
      `permissions.getAll: ${typeof browser.permissions?.getAll}`,
      `storage.local.get: ${typeof browser.storage?.local?.get}`);
    try { details.push(`Версия сборки: ${browser.runtime.getManifest().version}`); }
    catch { details.push('Версия сборки недоступна.'); }
  }
  if (background) details.push(`Фон: ${background.version}`, `ID отправителя: ${background.senderId}`,
    `Адрес настроек совпадает: ${background.optionsUrlMatches ? 'да' : 'нет'}`, `Источник адреса: ${background.senderUrlSource}`, `Этап операции: ${background.stage}`);
  el('startup-diagnostics').textContent = details.join(' · ');
}
async function refreshProtection(): Promise<void> {
  el('status').textContent = 'Проверка…';
  startupDiagnostics('JavaScript запущен. Ожидание начального состояния от фона.');
  let background: BackgroundDiagnostics | undefined;
  try {
    background = await request<BackgroundDiagnostics>({ type: 'diagnostics' });
    startupDiagnostics('Фон ответил. Ожидание состояния защиты.', background);
    snapshot = await request<Snapshot>({ type: 'reconcile' });
    render();
    startupDiagnostics('Начальное состояние получено.', background);
  } catch (error) {
    el('status').textContent = 'Не удалось загрузить состояние защиты.';
    startupDiagnostics(`Загрузка остановлена: ${errorText(error)}`, background);
    // Diagnostics bypass the controller queue, including a hung browser API.
    if (background) {
      try { background = await request<BackgroundDiagnostics>({ type: 'diagnostics' }); }
      catch { /* Keep the last successful diagnostic response. */ }
      startupDiagnostics(`Загрузка остановлена: ${errorText(error)}`, background);
    }
    throw error;
  }
}
function resetEditor(): void {
  editing = undefined; form.reset(); el('editor-title').textContent = 'Добавить правило';
  el('cancel-edit').hidden = true; el('form-error').textContent = ''; updatePath();
}
function edit(rule: Rule): void {
  editing = rule.id; name.value = rule.name ?? ''; domain.value = rule.domain;
  subdomains.checked = rule.includeSubdomains; kind.value = rule.kind; path.value = rule.path ?? '';
  el('editor-title').textContent = 'Изменить правило'; el('cancel-edit').hidden = false;
  el('form-error').textContent = ''; updatePath(); name.focus();
}
function updatePath(): void { el('path-field').hidden = kind.value === 'site'; path.required = kind.value !== 'site'; }
kind.addEventListener('change', updatePath);
el('cancel-edit').addEventListener('click', resetEditor);
async function saveConfig(config: Config): Promise<void> {
  if (!snapshot) throw new Error('Сначала загрузите состояние расширения.');
  snapshot = await request<Snapshot>({ type: 'save', config, revision: snapshot.revision });
  render();
}
async function perform(task: () => Promise<void>, errorId = 'notice'): Promise<void> {
  if (busy) return;
  busy = true;
  el<HTMLButtonElement>('save-rule').disabled = true;
  try { await task(); } catch (error) { el(errorId).textContent = errorText(error); }
  finally { busy = false; el<HTMLButtonElement>('save-rule').disabled = false; }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  if (!snapshot) {
    el('form-error').textContent = 'Состояние расширения не загружено. Нажмите «Перепроверить защиту»; если ошибка повторится, перезапустите расширение.';
    return;
  }
  let rule: Rule;
  try {
    rule = normalizeRule({ id: editing ?? crypto.randomUUID(), name: name.value, domain: domain.value,
      includeSubdomains: subdomains.checked, kind: kind.value, ...(kind.value !== 'site' ? { path: path.value } : {}) });
  } catch (error) { el('form-error').textContent = errorText(error); return; }
  const rules = snapshot.config.rules.filter(row => row.id !== rule.id);
  const index = snapshot.config.rules.findIndex(row => row.id === rule.id);
  rules.splice(index < 0 ? rules.length : index, 0, rule);
  let config: Config;
  try { config = normalizeConfig({ schemaVersion: 2, rules }); }
  catch (error) { el('form-error').textContent = errorText(error); return; }
  // Call permissions.request in the original user gesture, before any asynchronous storage/message work.
  const permission = browser.permissions.request({ origins: originsFor(rule) }).catch(() => false);
  void perform(async () => {
    const granted = await permission;
    await saveConfig(config); resetEditor();
    announce(granted ? 'Правило сохранено. Фактическое состояние показано в списке.' : 'Правило сохранено без подтверждённого доступа. Разрешите этот сайт в браузере и перепроверьте защиту.');
  }, 'form-error');
});
async function grant(rule: Rule): Promise<void> {
  if (busy) return;
  const permission = browser.permissions.request({ origins: originsFor(rule) }).catch(() => false);
  await perform(async () => {
    const granted = await permission;
    snapshot = await request<Snapshot>({ type: 'reconcile' }); render();
    announce(granted ? 'Запрос завершён. Проверьте состояние защиты.' : 'Доступ не подтверждён. В Safari проверьте разрешение для этого сайта через меню расширений.');
  });
}
async function remove(id: string): Promise<void> {
  await perform(async () => {
    await saveConfig({ schemaVersion: 2, rules: snapshot!.config.rules.filter(rule => rule.id !== id) });
    if (editing === id) resetEditor(); announce('Правило удалено. Ненужные разрешения освобождены, если это не затрагивает другие правила.');
  });
}
el('refresh').addEventListener('click', () => { void perform(async () => {
  await refreshProtection(); announce('Состояние обновлено.');
}); });
el('test-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = el<HTMLInputElement>('test-url').value;
  if (!parseHttpUrl(value)) { el('test-result').textContent = 'Нужен полный URL по HTTP или HTTPS.'; return; }
  if (!snapshot) return;
  const rule = matchUrl(snapshot.config.rules, value);
  const network = matchUrl(snapshot.config.rules.filter(rule => snapshot!.status.rules.some(status => status.id === rule.id && status.network)), value);
  const script = matchUrl(snapshot.config.rules.filter(rule => snapshot!.status.rules.some(status => status.id === rule.id && status.script)), value);
  el('test-result').textContent = rule ? `Совпадение: ${ruleLabel(rule)}. Сеть: ${network ? ruleLabel(network) : 'не подтверждена'}. Внутри страницы: ${script ? ruleLabel(script) : 'не подтверждено'}.` : 'Совпадений нет. Адрес разрешён этим списком.';
});
el('export').addEventListener('click', () => {
  if (!snapshot) return;
  imported = undefined; const content = exportConfig(snapshot.config);
  showJson(content, 'Экспорт текущего списка. Можно сохранить файл или скопировать JSON.');
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'local-blocklist.json';
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
function showJson(content: string, summary: string): void {
  el('json-panel').hidden = false; el<HTMLTextAreaElement>('json-preview').value = content;
  el('import-summary').textContent = summary; el('import-apply').hidden = !imported;
}
el<HTMLInputElement>('import-file').addEventListener('change', event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  imported = undefined; el('json-panel').hidden = true; el('import-error').textContent = '';
  void perform(async () => {
    if (file.size > 128 * 1024) throw new Error('Файл больше 128 КБ.');
    imported = parseImport(await file.text());
    showJson(exportConfig(imported), `Проверка пройдена: ${imported.rules.length} правил; ${allOrigins(imported.rules).length} шаблонов HTTP/HTTPS. Текущий список будет полностью заменён. Новые разрешения при импорте не запрашиваются.`);
    el('import-apply').textContent = `Заменить список (${imported.rules.length})`;
  }, 'import-error');
});
el('import-apply').addEventListener('click', () => { void perform(async () => {
  if (!imported) return;
  await saveConfig(imported); imported = undefined; el('json-panel').hidden = true; resetEditor();
  announce('Список импортирован. Для правил без доступа нажмите «Запросить доступ» отдельно.');
}, 'import-error'); });
el('import-cancel').addEventListener('click', () => { imported = undefined; el('json-panel').hidden = true; });
void perform(refreshProtection);
