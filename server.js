import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readConfig, usernamePattern } from './config.js';
import { createInviter, InviteError } from './github.js';

export async function createApp(config, { fetchImpl = fetch } = {}) {
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([route, file, type]) => [route, {
    type, body: (await readFile(new URL(`./public/${file}`, import.meta.url), 'utf8')).replaceAll('{{ORG}}', config.org),
  }])));
  const invite = createInviter(config, fetchImpl);
  const inFlight = new Map();
  // A single process-wide budget cannot be bypassed with forged proxy/IP headers.
  let windowStart = Date.now();
  let attempts = 0;
  const expected = Buffer.from(`Bearer ${config.secret}`);

  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      const asset = assets.get(req.url);
      if (asset && ['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(200, { 'Content-Type': asset.type });
        res.end(req.method === 'HEAD' ? undefined : asset.body);
        return;
      }
      if (req.url !== '/api/invite') return json(404, { error: 'Not found.' });
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(405, { error: 'Use POST.' });
      }
      const provided = Buffer.from(req.headers.authorization || '');
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        return json(401, { error: 'This invitation link is missing or invalid. Ask the owner for a new link.' });
      }
      if (req.headers.origin !== config.origin) return json(403, { error: 'Invalid request origin.' });
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        return json(415, { error: 'Expected JSON.' });
      }
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); attempts = 0; }
      if (++attempts > 30) {
        res.setHeader('Retry-After', '60');
        return json(429, { error: 'Too many requests. Please wait a minute and try again.' });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024) { json(413, { error: 'Request too large.' }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return json(400, { error: 'Invalid JSON.' }); }
      const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
      if (!usernamePattern.test(username)) return json(400, { error: 'Enter a valid GitHub username (up to 39 letters, numbers, or single hyphens).' });
      let pending = inFlight.get(username);
      if (!pending) {
        pending = invite(username).finally(() => inFlight.delete(username));
        inFlight.set(username, pending);
      }
      const result = await pending;
      json(200, { ...result, url: `https://github.com/orgs/${config.org}/invitation` });
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      json(error instanceof InviteError ? error.status : 502, {
        error: error instanceof InviteError ? error.message : 'The invitation service could not reach GitHub. Please try again later.',
      });
    }
  });
}

let serverPromise;
function getServer() {
  serverPromise ??= createApp(readConfig()).then((server) => {
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    return server;
  });
  return serverPromise;
}

export default async function handler(req, res) {
  const server = await getServer();
  server.emit('request', req, res);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readConfig();
    const server = await getServer();
    server.listen(config.port, '0.0.0.0', () => console.log(`Invitation page ready at ${config.origin}. Run npm run link to get the shareable link.`));
    server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
