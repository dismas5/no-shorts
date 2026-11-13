import { emptyConfig, migrateConfig, type Config } from '../core/policy.ts';
export interface StoredState { config: Config; revision: number }
export class StorageStateError extends Error {
  constructor(public readonly operation: 'read' | 'validate' | 'write') {
    const messages = {
      read: 'Не удалось прочитать локальное хранилище Safari (storage.local.get). Проверьте, что расширение включено, и перезапустите Safari.',
      validate: 'Сохранённые правила имеют неподдерживаемый или повреждённый формат. Не удаляйте данные расширения: восстановите их из резервной копии или проверьте сохранённую конфигурацию.',
      write: 'Не удалось записать локальное хранилище Safari (storage.local.set). Проверьте доступность хранилища и перезапустите Safari.'
    };
    super(messages[operation]);
    this.name = 'StorageStateError';
  }
}
// Accept only unambiguously empty legacy placeholders. Never erase unknown or
// malformed nonempty policy data, which might contain recoverable user rules.
function isEmptyPlaceholder(policy: unknown): boolean {
  if (policy === null) return true;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
  const keys = Object.keys(policy);
  return keys.length === 0 ||
    (keys.length === 1 && keys[0] === 'rules' && Array.isArray((policy as { rules: unknown }).rules) &&
      (policy as { rules: unknown[] }).rules.length === 0);
}
export async function loadState(api: typeof browser): Promise<StoredState> {
  let value: Awaited<ReturnType<typeof api.storage.local.get>>;
  try { value = await api.storage.local.get(['policy', 'revision']); }
  catch { throw new StorageStateError('read'); }
  let config: Config;
  try { config = value.policy === undefined || isEmptyPlaceholder(value.policy) ? emptyConfig() : migrateConfig(value.policy); }
  catch { throw new StorageStateError('validate'); }
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision as number : 0;
  if (value.policy === undefined || JSON.stringify(value.policy) !== JSON.stringify(config)) {
    try { await api.storage.local.set({ policy: config, revision }); }
    catch { throw new StorageStateError('write'); }
  }
  return { config, revision };
}
export async function saveState(api: typeof browser, state: StoredState): Promise<void> {
  try { await api.storage.local.set({ policy: state.config, revision: state.revision }); }
  catch { throw new StorageStateError('write'); }
}
