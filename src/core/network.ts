import type { Rule } from './policy.ts';
export interface NetworkRule {
  id: number;
  priority: number;
  action: { type: 'block' };
  condition: { regexFilter: string; isUrlFilterCaseSensitive: true; resourceTypes: ['main_frame', 'sub_frame'] };
}
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pathRegex(path: string): string {
  // Percent hex digits are case-insensitive; literal path letters remain case-sensitive.
  return path.split(/(%[\dA-F]{2})/).map(part => {
    if (!/^%[\dA-F]{2}$/.test(part)) return escapeRegex(part);
    return '%' + [...part.slice(1)].map(char => /[A-F]/.test(char) ? `[${char}${char.toLowerCase()}]` : char).join('');
  }).join('');
}
export function regexFor(rule: Rule): string {
  const host = `${rule.includeSubdomains ? '([^/:@?#]*\\.)?' : ''}${escapeRegex(rule.domain)}`;
  const origin = `^https?://([^/]*@)?${host}(:[0-9]+)?`;
  if (rule.kind === 'site' || (rule.kind === 'section' && rule.path === '/')) return `${origin}/`;
  // WebKit's URL filter parser rejects alternation (|). Optional suffixes
  // preserve the path boundary while keeping the end anchor at the very end.
  return origin + pathRegex(rule.path!) + (rule.kind === 'section' ? '([/?#].*)?$' : '([?#].*)?$');
}
export function compileNetworkRules(rules: readonly Rule[]): NetworkRule[] {
  const used = new Set<number>();
  const ids = new Map<string, number>();
  for (const rule of [...rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    let hash = 2166136261;
    for (const char of rule.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    let id = (hash >>> 1) || 1;
    while (used.has(id)) id = id === 2147483647 ? 1 : id + 1;
    used.add(id);
    ids.set(rule.id, id);
  }
  return rules.map(rule => ({ id: ids.get(rule.id)!, priority: 1, action: { type: 'block' },
    condition: { regexFilter: regexFor(rule), isUrlFilterCaseSensitive: true, resourceTypes: ['main_frame', 'sub_frame'] } }));
}
