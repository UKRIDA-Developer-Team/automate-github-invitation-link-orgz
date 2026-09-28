# Shareable GitHub organization invitation

A small Node.js app for **UKRIDA-Developer-Team**, with no runtime dependencies.

Share one link. Each recipient enters their GitHub username, the server creates a member invitation, and the recipient accepts it on GitHub. GitHub does not offer a reusable organization invitation URL through this API; this app automates the individual invitation requests.

## Run locally

Requires Node.js 22.9 or newer.

1. Copy `.env.example` to `.env` if `.env` does not already exist.
2. In [GitHub token settings](https://github.com/settings/personal-access-tokens/new), create a fine-grained personal access token from an **organization owner account**. Choose **UKRIDA-Developer-Team** as the resource owner and give the organization permission **Members: Read and write**. Complete any required organization approval. Put it in `GITHUB_TOKEN` in `.env`.
3. Generate `INVITE_SECRET` if it is empty:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Paste that value into `INVITE_SECRET`. Keep the GitHub token and `.env` private.

4. Start the app:

   ```sh
   npm start
   ```

5. In another terminal, print the complete invitation link:

   ```sh
   npm run link
   ```

The local link works only on your computer. Open the complete link again after a page refresh: the app removes the secret from the address bar after loading and keeps it only in page memory.

## Publish the shareable link

Deploy this folder as a **single Node.js web service** on a host such as Render, Railway, or your server. Use `npm start` as the start command; there are no dependencies to install. Static-only hosting, including GitHub Pages, cannot run the invitation API.

Set these environment variables in the host's private environment settings:

| Variable | Value |
| --- | --- |
| `GITHUB_ORG` | `UKRIDA-Developer-Team` |
| `GITHUB_TOKEN` | Your organization-owner token with Members write access |
| `INVITE_SECRET` | The random secret generated above |
| `PUBLIC_URL` | Your deployed HTTPS origin, such as `https://your-app.example.com`, without a path |
| `PORT` | Use the host's supplied port, or `3000` |

Set the same `PUBLIC_URL` in your local `.env` and run `npm run link`. The output will have this shape:

```text
https://your-app.example.com/#YOUR_RANDOM_INVITE_SECRET
```

**That full URL is the link to share.** The hostname above is an example, not a deployed app. The GitHub token is never included in the URL or frontend. The fragment secret authorizes invitation requests; it is not sent in page requests or referrers.

Before distributing the link, test with one intended recipient: submit their username, verify they receive a pending invitation, and have them accept while signed in to that account.

## Access and GitHub behavior

- Anyone holding the link can request a regular member invitation for any personal GitHub username. The page does not authenticate the submitted username; GitHub controls who can accept the invitation. Share only with the intended audience. New members receive your organization's normal member access and may consume paid seats.
- Rotate `INVITE_SECRET` and restart/redeploy to revoke the shared link. Previously created invitations remain valid and must be canceled separately in GitHub if necessary.
- Active members and pending invitations are recognized before creating invitations. The app never changes existing members' roles. Concurrent requests for the same username share one operation within the process.
- The app limits authorized requests to 30 per minute per process and does not trust forwarded IP headers. Run one instance; multiple replicas would need a shared rate limiter. This does not override GitHub's limits.
- GitHub documents a limit of 50 organization invitations per 24 hours, or 500 if the organization is over one month old or on a paid plan. Organization policy, account restrictions, available seats, and secondary API limits can also prevent invitations.
- The owner token stays on the server. There is no database, analytics, or application request logging. Configure your hosting provider not to log authorization headers.

## API choice and verification

The [membership endpoint](https://docs.github.com/en/rest/orgs/members?apiVersion=2026-03-10#set-organization-membership-for-a-user) in the supplied documentation also updates roles. This app uses [Create an organization invitation](https://docs.github.com/en/rest/orgs/members?apiVersion=2026-03-10#create-an-organization-invitation), with `role: "direct_member"`, to avoid exposing role changes through a public form. It uses API version `2026-03-10`.

Run the focused tests with:

```sh
npm test
```

Tests run against stubbed GitHub responses; they do not send real invitations.
