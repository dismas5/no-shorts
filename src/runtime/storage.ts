import { emptyConfig, migrateConfig, type Config } from '../core/policy.ts';
export interface StoredState { config: Config; revision: number }
export async function loadState(api: typeof browser): Promise<StoredState> {
  const value = await api.storage.local.get(['policy', 'revision']);
  const config = value.policy === undefined ? emptyConfig() : migrateConfig(value.policy);
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision as number : 0;
  if (value.policy === undefined || JSON.stringify(value.policy) !== JSON.stringify(config)) {
    await api.storage.local.set({ policy: config, revision });
  }
  return { config, revision };
}
export async function saveState(api: typeof browser, state: StoredState): Promise<void> {
  await api.storage.local.set({ policy: state.config, revision: state.revision });
}
