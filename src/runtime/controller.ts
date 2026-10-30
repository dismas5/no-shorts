import { allOrigins, domainMatches, matchUrl, normalizeConfig, originsFor, parseHttpUrl, type Rule } from '../core/policy.ts';
import { compileNetworkRules } from '../core/network.ts';
import { loadState, saveState, type StoredState } from './storage.ts';
import type { ProtectionStatus, Snapshot } from './contracts.ts';

const scriptIds = ['lb-guard', 'lb-history'];
function sameNetwork(a: browser.declarativeNetRequest.Rule, b: browser.declarativeNetRequest.Rule): boolean {
  return a.id === b.id && a.action.type === b.action.type && a.priority === b.priority &&
    a.condition.regexFilter === b.condition.regexFilter && a.condition.isUrlFilterCaseSensitive === b.condition.isUrlFilterCaseSensitive &&
    [...(a.condition.resourceTypes ?? [])].sort().join() === [...(b.condition.resourceTypes ?? [])].sort().join();
}
// A grant may cover narrower requested origins. Keep it if removing it would revoke another rule's access.
export function grantNeeded(origin: string, desired: string[]): boolean {
  const parse = (pattern: string): { scheme: string; host: string } | null => {
    const found = /^(https?|\*):\/\/([^/]+)\/\*$/.exec(pattern);
    return found ? { scheme: found[1]!, host: found[2]! } : null;
  };
  const grant = parse(origin);
  if (!grant) return true; // Never remove an unfamiliar browser-managed grant.
  return desired.some(pattern => {
    const need = parse(pattern);
    if (!need || (grant.scheme !== '*' && need.scheme !== '*' && grant.scheme !== need.scheme)) return false;
    const base = (host: string): string => host.replace(/^\*\./, '');
    const covers = (a: string, b: string): boolean => a === '*' || base(a) === base(b) ||
      (a.startsWith('*.') && base(b).endsWith(`.${base(a)}`));
    return covers(grant.host, need.host) || covers(need.host, grant.host);
  });
}
export class Controller {
  private state: StoredState | undefined;
  private status: ProtectionStatus = { rules: [], errors: [], extraOrigins: [], privateAllowed: false };
  private queue: Promise<unknown> = Promise.resolve();
  private stage = 'idle';
  get diagnosticsStage(): string { return this.stage; }
  constructor(private readonly api: typeof browser) {}
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async snapshot(): Promise<Snapshot> {
    if (!this.state) this.stage = 'storage:load';
    this.state ??= await loadState(this.api);
    return { ...this.state, status: this.status };
  }
  async save(value: unknown, revision: unknown): Promise<Snapshot> {
    this.stage = 'storage:load';
    this.state ??= await loadState(this.api);
    if (revision !== this.state.revision) throw new Error('Список изменён в другой вкладке. Обновите настройки и повторите изменение.');
    const config = normalizeConfig(value);
    const next = { config, revision: this.state.revision + 1 };
    this.stage = 'storage:save';
    await saveState(this.api, next);
    this.state = next;
    await this.reconcile(true);
    return this.snapshot();
  }
  async reconcile(cleanUnused = false): Promise<Snapshot> {
    this.stage = 'storage:load';
    this.state = await loadState(this.api);
    this.status = { rules: this.state.config.rules.map(rule => ({ id: rule.id, permission: false, network: false, script: false })),
      errors: [], extraOrigins: [], privateAllowed: false };
    try {
      const result = await this.apply(cleanUnused);
      this.stage = 'ready';
      return result;
    }
    catch {
      this.stage = 'apply:failed';
      for (const status of this.status.rules) status.script = false;
      this.status.errors.push('Перепроверка не завершена: API браузера недоступно. Список сохранён, защита не подтверждена. Повторите проверку или перезапустите расширение.');
      return this.snapshot();
    }
  }
  private async apply(cleanUnused: boolean): Promise<Snapshot> {
    const { rules } = this.state!.config;
    const errors: string[] = [];
    const desiredOrigins = allOrigins(rules);
    this.stage = 'permissions:getAll';
    const grants = await this.api.permissions.getAll();
    const unused = (grants.origins ?? []).filter(origin => !grantNeeded(origin, desiredOrigins));
    if (cleanUnused && unused.length) {
      try { await this.api.permissions.remove({ origins: unused }); }
      catch { errors.push('Не удалось освободить ненужные разрешения. Отзовите их в настройках браузера.'); }
    }
    this.stage = 'permissions:contains';
    const statuses = await Promise.all(rules.map(async rule => ({ id: rule.id,
      permission: await this.api.permissions.contains({ origins: originsFor(rule) }), network: false, script: false })));
    const permitted = rules.filter(rule => statuses.find(status => status.id === rule.id)!.permission);
    const network = compileNetworkRules(permitted);
    let networkStage = 'dnr:limits';
    try {
      const dnr = this.api.declarativeNetRequest;
      const limit = dnr.MAX_NUMBER_OF_DYNAMIC_RULES ?? dnr.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES;
      if (limit !== undefined && network.length > limit) throw new Error('limit');
      for (const rule of network) {
        networkStage = 'dnr:regex-check';
        this.stage = networkStage;
        const result = await dnr.isRegexSupported({ regex: rule.condition.regexFilter, isCaseSensitive: true });
        if (!result.isSupported) {
          networkStage = result.reason === 'syntaxError' ? 'dnr:regex-syntax' : result.reason === 'memoryLimitExceeded' ? 'dnr:regex-memory' : 'dnr:regex-unsupported';
          throw new Error('regex');
        }
      }
      networkStage = 'dnr:read-existing';
      this.stage = networkStage;
      const previous = await dnr.getDynamicRules();
      networkStage = 'dnr:update';
      this.stage = networkStage;
      if (previous.length !== network.length || !network.every(expected => previous.some(actual => sameNetwork(actual, expected)))) await dnr.updateDynamicRules({ removeRuleIds: previous.map(rule => rule.id), addRules: network });
      networkStage = 'dnr:readback';
      this.stage = networkStage;
      const actual = await dnr.getDynamicRules();
      for (const status of statuses) {
        const expected = network[permitted.findIndex(row => row.id === status.id)];
        status.network = !!expected && actual.some(rule => sameNetwork(rule, expected));
      }
      if (statuses.some(status => status.permission && !status.network)) throw new Error('readback');
    } catch { errors.push(`Сетевая политика не применена полностью (${networkStage}). Старые сетевые правила могли сохраниться; нажмите «Перепроверить» или перезапустите расширение.`); }
    const matches = allOrigins(permitted);
    this.stage = 'scripts:registration';
    try {
      const existing = await this.api.scripting.getRegisteredContentScripts();
      if (!matches.length) {
        const ids = existing.filter(script => scriptIds.includes(script.id)).map(script => script.id);
        if (ids.length) await this.api.scripting.unregisterContentScripts({ ids });
      } else {
        const specs: browser.scripting.RegisteredContentScript[] = [
          { id: scriptIds[0]!, js: ['guard.js'], world: 'ISOLATED', matches, runAt: 'document_start', allFrames: true, persistAcrossSessions: true },
          { id: scriptIds[1]!, js: ['history.js'], world: 'MAIN', matches, runAt: 'document_start', allFrames: true, persistAcrossSessions: true }
        ];
        // Register page-world notification first; guard always checks the address itself on startup.
        for (const spec of [...specs].reverse()) {
          const previous = existing.find(script => script.id === spec.id);
          if (!previous) await this.api.scripting.registerContentScripts([spec]);
          else if (spec.matches?.join() !== previous.matches?.join() || previous.world !== spec.world || previous.runAt !== spec.runAt) {
            await this.api.scripting.updateContentScripts([spec]);
          }
        }
        const actual = await this.api.scripting.getRegisteredContentScripts({ ids: scriptIds });
        const valid = specs.every(spec => actual.some(script => script.id === spec.id &&
          script.matches?.join() === matches.join() && script.world === spec.world && script.runAt === 'document_start' && script.allFrames === true));
        if (!valid) throw new Error('readback');
        for (const status of statuses) status.script = status.permission;
      }
    } catch { errors.push('Защита внутри страниц не зарегистрирована полностью. Сетевая блокировка и SPA могут иметь разное состояние.'); }
    this.stage = 'permissions:verify';
    this.status = { rules: statuses, errors, extraOrigins: (await this.api.permissions.getAll()).origins?.filter(origin => !desiredOrigins.includes(origin)) ?? [],
      privateAllowed: await this.api.extension.isAllowedIncognitoAccess() };
    // A non-policy notification also invalidates running guards after permission revocation.
    this.stage = 'storage:notify';
    await this.api.storage.local.set({ protectionEpoch: crypto.randomUUID() });
    // Do not execute page scripts while holding the controller queue. Safari can
    // leave executeScript pending, and injected guards need this same queue to
    // fetch their policy. Registration takes effect when a document loads;
    // guards that are already running refresh through protectionEpoch above.
    return this.snapshot();
  }
  async guardRules(source: string): Promise<Rule[]> {
    const { config } = await this.snapshot();
    const url = parseHttpUrl(source);
    if (!url) return [];
    const applicable = config.rules.filter(rule => domainMatches(rule, url.hostname));
    const access = await Promise.all(applicable.map(rule => this.api.permissions.contains({ origins: originsFor(rule) })));
    return applicable.filter((_, index) => access[index]);
  }
  async block(sender: browser.runtime.MessageSender, source: unknown, target: unknown): Promise<boolean> {
    if (sender.tab?.id === undefined || typeof source !== 'string' || typeof target !== 'string') return false;
    const current = await this.api.tabs.get(sender.tab.id);
    // A stale document must not redirect a newer page. Frame guards use a local stop screen.
    if (sender.frameId !== 0 || current.url !== source) return false;
    const url = parseHttpUrl(target);
    if (!url || url.hostname !== parseHttpUrl(source)?.hostname) return false;
    const rule = matchUrl(await this.guardRules(source), target);
    if (!rule) return false;
    await this.api.tabs.update(sender.tab.id, { url: this.api.runtime.getURL(`blocked.html#${encodeURIComponent(rule.id)}`) });
    return true;
  }
}
