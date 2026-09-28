export class InviteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createInviter({ org, token }, fetchImpl = fetch) {
  async function request(path, method = 'GET', body) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'github-organization-invite-link',
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    if (response.status === 429 || response.headers.get('retry-after') ||
        (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      throw new InviteError(429, 'GitHub is limiting invitations. Please try again later.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new InviteError(503, 'GitHub could not authorize the invitation. Contact the organization owner.');
    }
    return response;
  }

  async function membership(username) {
    const response = await request(`/orgs/${org}/memberships/${username}`);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new InviteError(502, 'Could not check GitHub membership. Please try again later.');
    const data = await response.json();
    if (!['active', 'pending'].includes(data.state)) throw new InviteError(502, 'Unexpected GitHub membership response.');
    return data.state;
  }

  return async function invite(username) {
    const existing = await membership(username);
    if (existing) return { state: existing };
    const userResponse = await request(`/users/${username}`);
    if (userResponse.status === 404) throw new InviteError(404, 'That GitHub username was not found.');
    if (userResponse.status !== 200) throw new InviteError(502, 'Could not look up the GitHub account. Please try again later.');
    const user = await userResponse.json();
    if (user.type !== 'User' || !Number.isSafeInteger(user.id) || user.id < 1) {
      throw new InviteError(400, 'Enter a personal GitHub username, not an organization or bot account.');
    }
    const response = await request(`/orgs/${org}/invitations`, 'POST', {
      invitee_id: user.id,
      role: 'direct_member',
    });
    if (response.status === 201) return { state: 'pending' };
    if (response.status === 422) {
      // A second process or the owner may have invited this account concurrently.
      const state = await membership(username);
      if (state) return { state };
      throw new InviteError(422, 'GitHub could not create the invitation. The owner should check invitation limits, available seats, and organization policies.');
    }
    if (response.status === 404) throw new InviteError(503, 'The organization is unavailable to the invitation service. Contact its owner.');
    throw new InviteError(502, 'GitHub could not create the invitation. Please try again later.');
  };
}
