export const SCHEMA_VERSION = 2;
export const MAX_RULES = 100;
export type Kind = 'site' | 'section' | 'exact';
export interface Rule {
  id: string;
  name?: string;
  domain: string;
  includeSubdomains: boolean;
  kind: Kind;
  path?: string;
}
export interface Config { schemaVersion: 2; rules: Rule[] }
export const emptyConfig = (): Config => ({ schemaVersion: 2, rules: [] });
export class ValidationError extends Error {}
const fail = (message: string): never => { throw new ValidationError(message); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Ожидается JSON-объект.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Неизвестное поле конфигурации.');
}
export function normalizeDomain(value: unknown): string {
  if (typeof value !== 'string') return fail('Введите домен без протокола, порта и пути.');
  const input = value.trim();
  if (!input || /[\s/:@?#%\\*\[\]]/.test(input) || input.endsWith('.')) {
    return fail('Нужен домен без протокола, порта, пути, звёздочек и точки в конце.');
  }
  let domain: string;
  try { domain = new URL(`https://${input}/`).hostname; } catch { return fail('Некорректный домен.'); }
  if (domain.length > 253 || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return fail('Некорректные метки домена.');
  }
  // Reject ambiguous numeric hosts that the URL parser silently rewrites (octal/hex/short IPv4).
  if (/^[\d.]+$/.test(domain) && domain !== input) return fail('IPv4 нужно записать четырьмя десятичными числами.');
  return domain;
}
export function canonicalPath(path: string): string {
  return path.replace(/%[\da-f]{2}/gi, escape => escape.toUpperCase());
}
function normalizePath(value: unknown, domain: string, kind: Kind): string {
  if (typeof value !== 'string' || !value.startsWith('/') ||
      /[?#\\\u0000-\u0020\u007f]/.test(value) || /%(?![\da-f]{2})/i.test(value)) {
    return fail('Путь начинается с /; без query, fragment, пробелов, обратных слешей и ошибочных %XX.');
  }
  try { encodeURIComponent(value); } catch { return fail('Некорректный Unicode в пути.'); }
  let path = canonicalPath(new URL(`https://${domain}${value}`).pathname);
  if (kind === 'section') path = path.replace(/\/+$/, '') || '/';
  if (path.length > 256) return fail('Нормализованный путь длиннее 256 символов.');
  return path;
}
export function normalizeRule(value: unknown): Rule {
  const row = object(value);
  keys(row, ['id', 'name', 'domain', 'includeSubdomains', 'kind', 'path']);
  if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id)) return fail('Некорректный идентификатор правила.');
  const domain = normalizeDomain(row.domain);
  if (typeof row.includeSubdomains !== 'boolean') return fail('Укажите признак включения поддоменов.');
  if (row.includeSubdomains && /^[\d.]+$/.test(domain)) return fail('У IP-адреса нет поддоменов.');
  if (row.kind !== 'site' && row.kind !== 'section' && row.kind !== 'exact') return fail('Неизвестный тип правила.');
  const rule: Rule = { id: row.id, domain, includeSubdomains: row.includeSubdomains, kind: row.kind };
  if (row.name !== undefined) {
    if (typeof row.name !== 'string' || row.name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(row.name)) return fail('Название: до 100 символов без управляющих знаков.');
    if (row.name.trim()) rule.name = row.name.trim();
  }
  if (rule.kind === 'site') {
    if (row.path !== undefined) fail('У правила «Весь сайт» не должно быть пути.');
  } else rule.path = normalizePath(row.path, domain, rule.kind);
  return rule;
}
export function normalizeConfig(value: unknown): Config {
  const input = object(value);
  keys(input, ['schemaVersion', 'rules']);
  if (input.schemaVersion !== 2) return fail('Неподдерживаемая версия схемы. Ожидается 2.');
  if (!Array.isArray(input.rules) || input.rules.length > MAX_RULES) return fail(`Ожидается не более ${MAX_RULES} правил.`);
  const rules = input.rules.map(normalizeRule);
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) return fail('Идентификаторы правил должны быть уникальны.');
  return { schemaVersion: 2, rules };
}
// The sole supported old schema: v1 allowed omitted includeSubdomains, meaning false.
export function migrateConfig(value: unknown): Config {
  const input = object(value);
  if (input.schemaVersion !== 1) return normalizeConfig(input);
  keys(input, ['schemaVersion', 'rules']);
  if (!Array.isArray(input.rules)) return fail('В старой конфигурации отсутствует список правил.');
  return normalizeConfig({ schemaVersion: 2, rules: input.rules.map(value => {
    const rule = object(value);
    return { ...rule, includeSubdomains: rule.includeSubdomains ?? false };
  }) });
}
export function parseImport(text: string): Config {
  if (new TextEncoder().encode(text).length > 128 * 1024) return fail('Файл больше 128 КБ.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail('Некорректный JSON.'); }
  return migrateConfig(value);
}
export const exportConfig = (config: Config): string => JSON.stringify(normalizeConfig(config), null, 2) + '\n';
export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch { return null; }
}
export function domainMatches(rule: Rule, hostname: string): boolean {
  return hostname === rule.domain || (rule.includeSubdomains && hostname.endsWith(`.${rule.domain}`));
}
export function matchUrl(rules: readonly Rule[], value: string): Rule | null {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const path = canonicalPath(url.pathname);
  return rules.find(rule => domainMatches(rule, url.hostname) && (
    rule.kind === 'site' || path === rule.path ||
    (rule.kind === 'section' && (rule.path === '/' || path.startsWith(`${rule.path}/`)))
  )) ?? null;
}
export function originsFor(rule: Rule): string[] {
  const host = `${rule.includeSubdomains ? '*.' : ''}${rule.domain}`;
  return [`http://${host}/*`, `https://${host}/*`];
}
export const allOrigins = (rules: readonly Rule[]): string[] => [...new Set(rules.flatMap(originsFor))].sort();
export const ruleLabel = (rule: Rule): string => rule.name || `${rule.domain}${rule.path ?? ''}`;
