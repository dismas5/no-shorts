import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyConfig, exportConfig, matchUrl, migrateConfig, normalizeConfig, normalizeDomain, normalizeRule, originsFor, parseImport, type Rule } from '../src/core/policy.ts';
import { compileNetworkRules, regexFor } from '../src/core/network.ts';
const rule = (patch: Partial<Rule> = {}): Rule => normalizeRule({ id: 'one', domain: 'focus.test', includeSubdomains: false, kind: 'section', path: '/section', ...patch });
test('empty first install and export/import are lossless; IDs survive', () => {
  assert.deepEqual(parseImport(exportConfig(emptyConfig())), emptyConfig());
  const config = { schemaVersion: 2 as const, rules: [rule({ name: 'Личный раздел' })] };
  assert.deepEqual(parseImport(exportConfig(config)), config);
});
test('normalize IDN, domain case, path dot segments, escapes and section slash', () => {
  assert.equal(normalizeDomain('  ПРИМЕР.РФ  '), 'xn--e1afmkfd.xn--p1ai');
  assert.equal(rule({ domain: 'FOCUS.TEST', path: '/a/../section/%d0%b0/' }).path, '/section/%D0%B0');
  assert.equal(rule({ path: '/a/%2e%2e/section///' }).path, '/section');
  assert.equal(rule({ kind: 'exact', path: '/section/' }).path, '/section/');
  assert.equal(rule({ kind: 'exact', path: '//section' }).path, '//section');
});
test('strict input validation, unknown fields and bounded import', () => {
  for (const domain of ['https://focus.test', 'focus.test/a', 'focus.test:80', 'bad..test', '*.focus.test', 'focus.test.', 'focus.test@evil.test', '-bad.test', '127.1', '0x7f000001', '[::1]']) {
    assert.throws(() => normalizeDomain(domain), domain);
  }
  for (const path of ['section', '/a?x', '/a#b', '/a\\b', '/a b', '/%', '/%xx', '/\n', '/' + 'a'.repeat(257)]) assert.throws(() => rule({ path }));
  assert.throws(() => normalizeRule({ ...rule(), includeSubdomains: 'false' }));
  assert.throws(() => normalizeRule({ ...rule(), id: 'bad#id' }));
  assert.throws(() => normalizeRule({ ...rule(), enabled: true }));
  assert.throws(() => rule({ kind: 'site' }));
  assert.throws(() => normalizeConfig({ schemaVersion: 2, rules: [rule(), rule()] }));
  assert.throws(() => normalizeConfig({ schemaVersion: 3, rules: [] }));
  assert.throws(() => normalizeConfig({ schemaVersion: 2, rules: [], anything: 1 }));
  assert.throws(() => parseImport('{broken'));
  assert.throws(() => parseImport(' '.repeat(131073)));
  assert.throws(() => normalizeConfig({ schemaVersion: 2, rules: Array.from({ length: 101 }, (_, i) => rule({ id: `r${i}` })) }));
});
test('v1 migration defaults subdomains false, keeps ID; unknown future version rejected', () => {
  const { includeSubdomains: _old, ...old } = rule();
  assert.deepEqual(migrateConfig({ schemaVersion: 1, rules: [old] }), { schemaVersion: 2, rules: [rule()] });
  assert.throws(() => migrateConfig({ schemaVersion: 999, rules: [] }));
});
const cases: [string, boolean][] = [
  ['https://focus.test/section', true], ['http://focus.test/section/', true],
  ['https://focus.test:8443/section/item?x=1#part', true], ['https://FOCUS.test/section?x=2', true],
  ['https://focus.test/section-example', false], ['https://focus.test/Section', false],
  ['https://focus.test/%73ection', false], ['https://focus.test/section%2Fitem', false],
  ['https://focus.test/a/../section', true], ['https://focus.test/%2e/section', true],
  ['https://sub.focus.test/section', false], ['https://focus.test.evil.test/section', false],
  ['https://notfocus.test/section', false], ['https://focus.test./section', false],
  ['https://focus.test/allowed?next=/section', false], ['file://focus.test/section', false],
  ['ftp://focus.test/section', false], ['about:blank', false], ['invalid', false],
  ['https://user:pass@focus.test/section', true], ['https://focus.test@evil.test/section', false]
];
for (const [url, expected] of cases) test(`section boundary: ${url}`, () => assert.equal(!!matchUrl([rule()], url), expected));
test('whole site, root section, exact slash, subdomains and escaped paths', () => {
  assert.ok(matchUrl([normalizeRule({ id: 's', kind: 'site', domain: 'focus.test', includeSubdomains: false })], 'http://focus.test/any?q=1'));
  assert.ok(matchUrl([rule({ path: '/' })], 'https://focus.test/anything'));
  assert.ok(matchUrl([rule({ includeSubdomains: true })], 'https://a.b.focus.test/section'));
  assert.equal(matchUrl([rule({ includeSubdomains: true })], 'https://evilfocus.test/section'), null);
  assert.ok(matchUrl([rule({ kind: 'exact' })], 'https://focus.test/section?x=1#f'));
  assert.equal(matchUrl([rule({ kind: 'exact' })], 'https://focus.test/section/'), null);
  assert.equal(matchUrl([rule({ kind: 'exact', path: '/section/' })], 'https://focus.test/section'), null);
  assert.ok(matchUrl([rule({ path: '/я/%2f' })], 'https://focus.test/%d1%8f/%2F/item'));
  assert.deepEqual(originsFor(rule()), ['http://focus.test/*', 'https://focus.test/*']);
  assert.deepEqual(originsFor(rule({ includeSubdomains: true })), ['http://*.focus.test/*', 'https://*.focus.test/*']);
});
test('network rules contain only portable fields and documents, stable numeric IDs', () => {
  const rules = [rule(), rule({ id: 'two', kind: 'exact' })];
  const forward = compileNetworkRules(rules), reverse = compileNetworkRules([...rules].reverse());
  assert.equal(forward[0]!.id, reverse[1]!.id);
  assert.equal(new Set(forward.map(r => r.id)).size, 2);
  for (const item of forward) {
    assert.ok(item.id > 0 && item.id <= 2147483647);
    assert.deepEqual(item.condition.resourceTypes, ['main_frame', 'sub_frame']);
    assert.equal(item.action.type, 'block');
    assert.ok(/^[\x00-\x7f]+$/.test(item.condition.regexFilter));
    assert.deepEqual(Object.keys(item.condition).sort(), ['isUrlFilterCaseSensitive', 'regexFilter', 'resourceTypes']);
  }
});
test('software matcher agrees with generated regex over URL normalization, paths and host adversaries', () => {
  let comparisons = 0;
  const paths = ['/section', '/section/', '/section/item', '/section-example', '/Section', '/%73ection', '/section%2fitem', '/x/../section', '/%d1%8f/%2f', '/a.b+(c)[d]$', '/'];
  for (const kind of ['site', 'section', 'exact'] as const) for (const includeSubdomains of [false, true]) {
    for (const path of paths) {
      const candidate = normalizeRule({ id: 'r', kind, includeSubdomains, domain: 'focus.test', ...(kind === 'site' ? {} : { path }) });
      const regex = new RegExp(regexFor(candidate));
      for (const host of ['focus.test', 'a.focus.test', 'a.b.focus.test', 'a_b.focus.test', 'a..focus.test', '.focus.test', 'a!b.focus.test', 'focus.test.evil.test', 'evilfocus.test', 'focus.test.']) {
        for (const target of paths) for (const suffix of ['', '?q=/section#f', '#a']) {
          const url = new URL(`https://${host}:8443${target}${suffix}`);
          assert.equal(regex.test(url.href), !!matchUrl([candidate], url.href), `${kind} ${path} vs ${url.href}`);
          comparisons++;
        }
      }
    }
  }
  assert.ok(comparisons > 10000);
});
