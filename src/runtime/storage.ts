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
export async function loadState(api: typeof browser): Promise<StoredState> {
  let value: Awaited<ReturnType<typeof api.storage.local.get>>;
  try { value = await api.storage.local.get(['policy', 'revision']); }
  catch { throw new StorageStateError('read'); }
  let config: Config;
  try { config = value.policy === undefined ? emptyConfig() : migrateConfig(value.policy); }
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
