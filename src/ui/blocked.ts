import { migrateConfig, ruleLabel } from '../core/policy.ts';
import { el } from './dom.ts';
void (async () => {
  try {
    const stored = await browser.storage.local.get('policy');
    const rules = migrateConfig(stored.policy).rules;
    const rule = rules.find(rule => rule.id === decodeURIComponent(location.hash.slice(1)));
    el('reason').textContent = rule ? `Сработало правило «${ruleLabel(rule)}».` : 'Сработало правило Local Blocklist. Возможно, список уже изменён.';
  } catch { el('reason').textContent = 'Список правил недоступен. Откройте настройки расширения.'; }
})();
el('open-settings').addEventListener('click', () => { void browser.runtime.openOptionsPage(); });
