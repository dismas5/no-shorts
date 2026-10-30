import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { icon } from './icon.mjs';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const base = {
  manifest_version: 3, name: 'Local Blocklist', version,
  description: 'Локальная блокировка сайтов и разделов по вашим правилам. Без аналитики и синхронизации.',
  permissions: ['storage', 'scripting', 'declarativeNetRequestWithHostAccess'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  background: { scripts: ['background.js'], persistent: false },
  action: { default_title: 'Настройки Local Blocklist', default_icon: { 16: 'icon-16.png', 32: 'icon-32.png' } },
  icons: { 48: 'icon-48.png', 64: 'icon-64.png', 96: 'icon-96.png', 128: 'icon-128.png', 256: 'icon-256.png', 512: 'icon-512.png' },
  options_ui: { page: 'options.html', open_in_tab: true },
  content_security_policy: { extension_pages: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" }
};
for (const target of ['firefox', 'safari']) {
  const outdir = `dist/${target}`;
  await rm(outdir, { recursive: true, force: true }); await mkdir(outdir, { recursive: true });
  await cp('public', outdir, { recursive: true });
  for (const size of [16, 32, 48, 64, 96, 128, 256, 512]) await writeFile(`${outdir}/icon-${size}.png`, icon(size));
  await build({ entryPoints: { background: 'src/background.ts', guard: 'src/guard.ts', history: 'src/history.ts', options: 'src/ui/options.ts', blocked: 'src/ui/blocked.ts' },
    outdir, bundle: true, format: 'iife', target: ['firefox128', 'safari18'], charset: 'ascii', legalComments: 'none', sourcemap: false, minify: false });
  const manifest = structuredClone(base);
  if (target === 'firefox') manifest.browser_specific_settings = { gecko: {
    id: 'local-blocklist@local.invalid', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] }
  }, gecko_android: { strict_min_version: '142.0' } };
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
}
console.log('Built dist/firefox and dist/safari (no runtime dependencies).');
