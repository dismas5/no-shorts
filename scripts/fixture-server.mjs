import http from 'node:http';
import { readFile } from 'node:fs/promises';
export function tone() {
  const samples = 8000, out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(samples, 24); out.writeUInt32LE(samples * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / samples) * 3000), 44 + i * 2);
  return out;
}
export async function startFixtures(port = 0, host = '127.0.0.1') {
  const hits = new Map();
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://fixture.test').pathname;
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
    try {
      response.setHeader('Content-Type', pathname === '/fixture.js' ? 'text/javascript' : pathname === '/tone.wav' ? 'audio/wav' : 'text/html; charset=utf-8');
      response.end(pathname === '/tone.wav' ? tone() : await readFile(pathname === '/fixture.js' ? 'tests/fixtures/fixture.js' : 'tests/fixtures/site.html'));
    } catch { response.writeHead(500); response.end('Fixture error'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, hits, origin: `http://${host}:${server.address().port}` };
}
if (process.argv[1]?.endsWith('fixture-server.mjs')) {
  const { origin } = await startFixtures(Number(process.env.LB_FIXTURE_PORT ?? 8787), process.env.LB_FIXTURE_HOST ?? '127.0.0.1');
  console.log(`${origin}/allowed — test fixture only, no production permissions added`);
}
