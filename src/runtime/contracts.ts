import type { Config } from '../core/policy.ts';
export interface RuleStatus { id: string; permission: boolean; network: boolean; script: boolean }
export interface ProtectionStatus { rules: RuleStatus[]; errors: string[]; extraOrigins: string[]; privateAllowed: boolean }
export interface Snapshot { config: Config; revision: number; status: ProtectionStatus }
export interface BackgroundDiagnostics {
  version: string;
  senderId: 'same' | 'missing' | 'different';
  optionsUrlMatches: boolean;
  senderUrlSource: 'url' | 'tab' | 'missing';
  stage: string;
}
export type Response<T> = { ok: true; value: T } | { ok: false; error: string };
export const requestPortName = 'local-blocklist-request-v1';
export function request<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: requestPortName });
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* The browser may have already closed it. */ }
      if (error) reject(error); else resolve(value as T);
    };
    const onMessage = (response: unknown) => {
      if (!response || typeof response !== 'object' || !('ok' in response) || typeof response.ok !== 'boolean') {
        finish(new Error('Расширение вернуло некорректный ответ.'));
        return;
      }
      const result = response as Response<T>;
      if (!result.ok) finish(new Error(result.error));
      else finish(undefined, result.value);
    };
    const onDisconnect = () => finish(new Error('Соединение с расширением закрылось до получения ответа. Обновите настройки и проверьте список: операция могла завершиться.'));
    const timer = setTimeout(() => finish(new Error('Расширение не ответило за 10 секунд. Обновите настройки и проверьте список: операция могла завершиться.')), 10_000);
    try {
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      // Exactly one operation per connection. Never retry a save implicitly.
      port.postMessage(message);
    } catch {
      finish(new Error('Не удалось отправить запрос расширению.'));
    }
  });
}
