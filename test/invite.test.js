import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readConfig } from '../config.js';
import { createApp } from '../server.js';

const env = {
  GITHUB_ORG: 'UKRIDA-Developer-Team',
  GITHUB_TOKEN: 'test-server-token',
  INVITE_SECRET: 'a'.repeat(64),
  PUBLIC_URL: 'https://join.example.com',
};
const config = readConfig(env);
const reply = (status, body, headers) => new Response(JSON.stringify(body), { status, headers });

async function fixture(t, responses = []) {
  const calls = [];
  const server = await createApp(config, { fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    assert.ok(responses.length, `Unexpected GitHub request: ${url}`);
    const response = responses.shift();
    return typeof response === 'function' ? response() : response;
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = { username: 'octocat' }, headers = {}) => fetch(`${base}/api/invite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.secret}`, Origin: config.origin, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { calls, base, post };
}

test('configuration requires credentials, a strong-length secret and an HTTPS origin', () => {
  for (const override of [
    { GITHUB_TOKEN: '' }, { GITHUB_ORG: '../evil' }, { INVITE_SECRET: 'short' },
    { PUBLIC_URL: 'http://example.com' }, { PUBLIC_URL: 'https://example.com/path' },
    { PUBLIC_URL: 'https://user:pass@example.com' }, { PORT: 'NaN' },
  ]) assert.throws(() => readConfig({ ...env, ...override }));
  assert.equal(readConfig({ ...env, PUBLIC_URL: 'http://localhost:3000' }).origin, 'http://localhost:3000');
});

test('page renders organization without exposing secrets and serves accessible form/assets', async t => {
  const { base, calls } = await fixture(t);
  for (const path of ['/', '/app.js', '/style.css']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const body = await response.text();
    assert.ok(!body.includes(config.secret));
    assert.ok(!body.includes(config.token));
    if (path === '/') {
      assert.match(body, /Join UKRIDA-Developer-Team/);
      assert.match(body, /label for="username"/);
      assert.match(body, /aria-live="polite"/);
    }
  }
  assert.equal(calls.length, 0);
});

test('invalid link, origin, username, content type and malformed or oversized bodies cannot call GitHub', async t => {
  const { post, calls } = await fixture(t);
  for (const [body, headers, expected] of [
    [{ username: 'octocat' }, { Authorization: 'Bearer wrong' }, 401],
    [{ username: 'octocat' }, { Origin: 'https://evil.example' }, 403],
    [{ username: 'octocat' }, { 'Content-Type': 'text/plain' }, 415],
    [{ username: '../admin' }, {}, 400],
    [{ username: 'two--hyphens' }, {}, 400],
    ['null', {}, 400], ['{', {}, 400], ['x'.repeat(1025), {}, 413],
  ]) assert.equal((await post(body, headers)).status, expected);
  assert.equal(calls.length, 0);
});

test('new recipient gets a direct-member invitation and acceptance link', async t => {
  const { post, calls } = await fixture(t, [reply(404, {}), reply(200, { id: 123, type: 'User' }), reply(201, { id: 42 })]);
  const response = await post({ username: ' OctoCat ', role: 'admin' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'pending', url: 'https://github.com/orgs/UKRIDA-Developer-Team/invitation' });
  assert.ok(calls[0].url.endsWith('/memberships/octocat'));
  assert.ok(calls[1].url.endsWith('/users/octocat'));
  assert.ok(calls[2].url.endsWith('/orgs/UKRIDA-Developer-Team/invitations'));
  assert.equal(calls[2].method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].body), { invitee_id: 123, role: 'direct_member' });
  assert.equal(calls[2].headers.Authorization, `Bearer ${config.token}`);
  assert.equal(calls[2].headers['X-GitHub-Api-Version'], '2026-03-10');
});

for (const state of ['active', 'pending']) {
  test(`${state} members are returned without mutations, including existing owners`, async t => {
    const { post, calls } = await fixture(t, [reply(200, { state, role: 'admin' })]);
    assert.equal((await (await post()).json()).state, state);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  });
}

test('simultaneous submissions for the same username create one invitation', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { post, calls } = await fixture(t, [
    async () => { await gate; return reply(404, {}); },
    reply(200, { id: 123, type: 'User' }), reply(201, {}),
  ]);
  const first = post();
  const second = post({ username: 'OCTOCAT' });
  // Keep the upstream operation open until both HTTP requests are being handled.
  await new Promise(resolve => setTimeout(resolve, 100));
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('concurrent invitation created outside this process is recognized after 422', async t => {
  const { post } = await fixture(t, [reply(404, {}), reply(200, { id: 123, type: 'User' }), reply(422, {}), reply(200, { state: 'pending' })]);
  assert.equal((await (await post()).json()).state, 'pending');
});

test('missing users and organization accounts cannot be invited', async t => {
  for (const [response, expected] of [[reply(404, {}), 404], [reply(200, { id: 123, type: 'Organization' }), 400]]) {
    const { post, calls } = await fixture(t, [reply(404, {}), response]);
    assert.equal((await post()).status, expected);
    assert.equal(calls.length, 2);
  }
});

test('GitHub authentication, rate limiting and invitation failures produce safe errors', async t => {
  for (const [response, expected] of [
    [reply(401, { message: config.token }), 503],
    [reply(403, {}, { 'x-ratelimit-remaining': '0' }), 429],
    [reply(403, {}, { 'retry-after': '60' }), 429],
    [reply(500, {}), 502],
  ]) {
    const { post } = await fixture(t, [response]);
    const result = await post();
    assert.equal(result.status, expected);
    assert.ok(!(await result.text()).includes(config.token));
  }
  const { post } = await fixture(t, [reply(404, {}), reply(200, { id: 123, type: 'User' }), reply(422, {}), reply(404, {})]);
  assert.equal((await post()).status, 422);
});

test('upstream network errors are handled and a later request can retry', async t => {
  const { post } = await fixture(t, [() => { throw new Error(config.token); }, reply(200, { state: 'pending' })]);
  const response = await post();
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(config.token));
  assert.equal((await post()).status, 200);
});

test('global request budget cannot be bypassed with forwarded IP headers', async t => {
  const { post, calls } = await fixture(t, Array.from({ length: 30 }, () => reply(200, { state: 'active' })));
  for (let i = 0; i < 30; i++) assert.equal((await post()).status, 200);
  const limited = await post({ username: 'different-user' }, { 'X-Forwarded-For': '1.2.3.4' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(calls.length, 30);
});
