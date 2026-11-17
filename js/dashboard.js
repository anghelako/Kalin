/* Kalin shared app bootstrap: resolves the active Supabase session for every app page. */
let client = null;
let currentUser = null;

async function signOut() {
  try {
    if (client) await client.auth.signOut();
  } finally {
    window.location.replace('login.html');
  }
}

function showUser(user) {
  const meta = user.user_metadata || {};
  const full = (meta.full_name || meta.name || (user.email || '').split('@')[0] || '').trim();
  const first = full.split(/\s+/)[0] || 'there';
  const nameEl = document.getElementById('first-name');
  const initialEl = document.getElementById('avatar-initial');
  if (nameEl) nameEl.textContent = first;
  if (initialEl) initialEl.textContent = first.charAt(0).toUpperCase();
  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.textContent = user.email || '';
}

/* Calendar and other pages wait for this promise instead of racing the session check. */
window.kalinReady = (async function bootstrapKalin() {
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const candidate = createKalinClient(storage);
      const { data, error } = await candidate.auth.getSession();
      if (error) throw error;
      if (data.session) {
        client = candidate;
        currentUser = data.session.user;
        showUser(currentUser);
        return currentUser;
      }
    }
    window.location.replace('login.html');
    return null;
  } catch (error) {
    console.error('Kalin session check failed:', error);
    const status = document.getElementById('app-error');
    if (status) status.textContent = 'We could not verify your session. Please refresh or sign in again.';
    return null;
  }
})();

const signOutButton = document.getElementById('signout');
if (signOutButton) signOutButton.addEventListener('click', signOut);

const today = document.getElementById('today-date');
if (today) today.textContent = new Date().toLocaleDateString(undefined, {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
});

/* Keep unfinished actions honest: no fake database writes or notification state. */
const createCircle = document.getElementById('create-circle');
if (createCircle) createCircle.addEventListener('click', () => {
  window.alert('Circle creation is not connected yet. It needs a circles table and membership permissions in Supabase before it can safely save shared family data.');
});
const notifications = document.getElementById('notif');
if (notifications) notifications.addEventListener('click', () => {
  window.alert('You’re all caught up. Notifications will appear here once the notification feature is connected.');
});
const profile = document.getElementById('profile');
if (profile) profile.addEventListener('click', async () => {
  await window.kalinReady;
  if (currentUser) window.alert('Signed in as: ' + currentUser.email);
});


