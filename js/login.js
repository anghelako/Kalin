/* ===== CONFIG: replace with your project values ===== */
const SUPABASE_URL = 'https://tefxdwmuodhfosfrgcad.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2-TtsfmpYavprmwDJlx3TA_NwTvknJl';
const AFTER_LOGIN_URL = 'dashboard.html';
const RESET_REDIRECT_URL = window.location.origin + '/reset-password.html';
/* ==================================================== */

const $ = id => document.getElementById(id);
const form = $('auth-form'), msg = $('msg'), submitBtn = $('submit');
let mode = 'signin';

// "Remember this device": persist in localStorage if checked, otherwise sessionStorage
function getClient() {
  const store = $('remember').checked ? window.localStorage : window.sessionStorage;
  return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: store, persistSession: true, autoRefreshToken: true }
  });
}

function show(text, type) {
  msg.textContent = text;
  msg.className = 'msg show-msg ' + type;
}
function clearMsg() { msg.className = 'msg'; msg.textContent = ''; }

function setMode(next) {
  mode = next;
  const up = mode === 'signup';
  form.classList.toggle('signup', up);
  $('title').textContent = up ? 'Create your account' : 'Welcome to Kalin';
  $('subtitle').textContent = up ? 'Set up your family’s care hub in a minute.' : 'Please sign in to access your family’s care hub.';
  $('submit-text').textContent = up ? 'Create account' : 'Sign in';
  $('or-text').textContent = up ? 'Already have an account?' : 'New to Kalin?';
  $('switch-text').textContent = up ? 'Back to sign in' : 'Create new account';
  $('password').autocomplete = up ? 'new-password' : 'current-password';
  clearMsg();
}

$('switch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

$('toggle').addEventListener('click', () => {
  const p = $('password'), hidden = p.type === 'password';
  p.type = hidden ? 'text' : 'password';
  $('toggle').textContent = hidden ? 'Hide' : 'Show';
  $('toggle').setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
});

function friendly(error) {
  const m = (error.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'That email and password don’t match. Check them and try again.';
  if (m.includes('email not confirmed')) return 'Confirm your email first. We sent you a link when you signed up.';
  if (m.includes('already registered')) return 'An account with this email already exists. Try signing in instead.';
  if (m.includes('password should be')) return 'Use a password with at least 6 characters.';
  if (m.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.';
  return error.message || 'Something went wrong. Try again.';
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  clearMsg();
  const email = $('email').value.trim(), password = $('password').value, name = $('name').value.trim();

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return show('Enter a valid email address.', 'err');
  if (!password) return show('Enter your password.', 'err');
  if (mode === 'signup' && !name) return show('Enter your full name.', 'err');

  submitBtn.disabled = true;
  const label = $('submit-text').textContent;
  $('submit-text').textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';

  try {
    const client = getClient();
    if (mode === 'signup') {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { full_name: name }, emailRedirectTo: window.location.origin + '/' + AFTER_LOGIN_URL }
      });
      if (error) throw error;
      if (data.session) window.location.href = AFTER_LOGIN_URL;
      else show('Account created. Check your email to confirm it, then sign in.', 'ok');
    } else {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = AFTER_LOGIN_URL;
    }
  } catch (err) {
    show(friendly(err), 'err');
  } finally {
    submitBtn.disabled = false;
    $('submit-text').textContent = label;
  }
});

$('forgot').addEventListener('click', async () => {
  clearMsg();
  const email = $('email').value.trim();
  if (!email) return show('Enter your email above, then select “Forgot password?”.', 'err');
  const { error } = await getClient().auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT_URL });
  if (error) return show(friendly(error), 'err');
  show('If an account exists for ' + email + ', a reset link is on its way.', 'ok');
});

// Already signed in? Skip the form.
(async () => {
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      const c = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: store } });
      const { data } = await c.auth.getSession();
      if (data.session) { window.location.href = AFTER_LOGIN_URL; return; }
    }
  } catch (_) {}
})();
