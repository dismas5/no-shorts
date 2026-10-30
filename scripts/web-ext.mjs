import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const binary = join(dirname(require.resolve('web-ext')), 'bin', 'web-ext.js');
const result = spawnSync(process.execPath, [binary, ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
