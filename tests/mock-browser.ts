import { allOrigins } from '../src/core/policy.ts';
export function mockBrowser() {
  const store: Record<string, unknown> = {};
  let grants: string[] = [];
  let network: browser.declarativeNetRequest.Rule[] = [];
  let scripts: browser.scripting.RegisteredContentScript[] = [];
  let failNetwork = false, failScripts = false, failStorage = false;
  const updates: { id: number; url: string }[] = [];
  const api = {
    storage: { local: {
      get: async () => structuredClone(store),
      set: async (value: object) => { if (failStorage) throw new Error('disk'); Object.assign(store, structuredClone(value)); }
    } },
    permissions: {
      getAll: async () => ({ origins: [...grants] }),
      contains: async ({ origins }: { origins: string[] }) => origins.every(origin => grants.includes(origin)),
      remove: async ({ origins }: { origins: string[] }) => { grants = grants.filter(origin => !origins.includes(origin)); return true; }
    },
    extension: { isAllowedIncognitoAccess: async () => false },
    declarativeNetRequest: {
      MAX_NUMBER_OF_DYNAMIC_RULES: 5000,
      isRegexSupported: async () => ({ isSupported: true }),
      getDynamicRules: async () => structuredClone(network),
      updateDynamicRules: async ({ addRules }: { addRules: browser.declarativeNetRequest.Rule[] }) => { if (failNetwork) throw new Error('DNR error with sensitive URL'); network = structuredClone(addRules); }
    },
    scripting: {
      getRegisteredContentScripts: async () => structuredClone(scripts),
      registerContentScripts: async (rows: browser.scripting.RegisteredContentScript[]) => { if (failScripts) throw new Error('scripts'); scripts.push(...structuredClone(rows)); },
      updateContentScripts: async (rows: browser.scripting.RegisteredContentScript[]) => { if (failScripts) throw new Error('scripts'); for (const row of rows) scripts = scripts.map(script => script.id === row.id ? structuredClone(row) : script); },
      unregisterContentScripts: async () => { if (failScripts) throw new Error('scripts'); scripts = []; },
      executeScript: async () => []
    },
    tabs: { query: async () => [], get: async () => ({ id: 7, url: 'https://focus.test/section' }),
      update: async (id: number, value: { url: string }) => { updates.push({ id, ...value }); } },
    runtime: { getURL: (path: string) => `moz-extension://local/${path}` }
  };
  return {
    api: api as unknown as typeof browser, store, updates,
    get network() { return network; }, get scripts() { return scripts; }, get grants() { return grants; },
    grant: (rules: Parameters<typeof allOrigins>[0]) => { grants = allOrigins(rules); },
    revoke: () => { grants = []; },
    fail: (layer: 'network' | 'scripts' | 'storage', value = true) => { if (layer === 'network') failNetwork = value; if (layer === 'scripts') failScripts = value; if (layer === 'storage') failStorage = value; }
  };
}
