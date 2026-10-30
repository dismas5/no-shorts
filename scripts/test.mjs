import { build } from 'esbuild';
import { readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = (await readdir('tests')).filter(file => file.endsWith('.test.ts')).map(file => `tests/${file}`);
await mkdir('.test-output', { recursive: true });
await build({ entryPoints: files, outdir: '.test-output', bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' });
const result = spawnSync(process.execPath, ['--experimental-test-isolation=none', '--test', ...files.map(file => file.replace('tests/', '.test-output/').replace(/\.ts$/, '.js'))], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
