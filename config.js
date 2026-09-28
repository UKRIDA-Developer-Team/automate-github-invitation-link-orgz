export const usernamePattern = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function readConfig(env = process.env) {
  const org = env.GITHUB_ORG?.trim();
  const token = env.GITHUB_TOKEN?.trim();
  const secret = env.INVITE_SECRET?.trim();
  if (!org || !usernamePattern.test(org)) throw new Error('Set GITHUB_ORG to your organization name.');
  if (!token) throw new Error('Set GITHUB_TOKEN to an organization owner token.');
  if (!secret || !/^[a-zA-Z0-9_-]{32,}$/.test(secret)) {
    throw new Error('Set INVITE_SECRET to at least 32 random URL-safe characters.');
  }
  const url = new URL(env.PUBLIC_URL || 'http://localhost:3000');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_URL must be an HTTPS origin (HTTP is allowed on localhost).');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  return { org, token, secret, origin: url.origin, port };
}
