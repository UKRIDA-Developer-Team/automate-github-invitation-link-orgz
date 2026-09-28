const secret = location.hash.slice(1);
// The fragment is never sent in the page request; remove it from browser history too.
history.replaceState(null, '', location.pathname);
const form = document.querySelector('#invite-form');
const button = document.querySelector('#submit');
const status = document.querySelector('#status');
const accept = document.querySelector('#accept');

if (!/^[a-zA-Z0-9_-]{32,}$/.test(secret)) {
  status.textContent = 'Open the complete invitation link shared by the organization owner.';
} else {
  button.disabled = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  accept.hidden = true;
  status.textContent = 'Checking your account and requesting an invitation…';
  try {
    const response = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ username: form.elements.username.value.trim() }),
      signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not request an invitation. Please try again.');
    if (result.state === 'active') {
      status.textContent = 'This account is already a member of the organization.';
    } else {
      status.textContent = 'Your invitation is ready. Sign in to the matching GitHub account and accept it below.';
      accept.hidden = false;
    }
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error instanceof TypeError
      ? 'Connection interrupted. Please try again; any existing invitation will still be available.'
      : error.message;
  } finally { button.disabled = false; }
});
