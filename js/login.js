const $ = id => document.getElementById(id);
const form = $('auth-form'), msg = $('msg'), submitBtn = $('submit');
let mode = 'signin';

// "Remember this device": persist in localStorage if checked, otherwise sessionStorage
function getClient() {
  return createKalinClient($('remember').checked ? window.localStorage : window.sessionStorage);
}

function show(text, type) {
  msg.textContent = text;
  msg.className = 'msg show-msg ' + type;
}
function clearMsg() { msg.className = 'msg'; msg.textContent = ''; }

function updateHint() {
  const hint = $('match-hint'), a = $('password').value, b = $('confirm').value;
  if (mode !== 'signup' || !b) {
    hint.textContent = '';
    hint.className = 'hint';
  } else if (a === b) {
    hint.textContent = 'Passwords match.';
    hint.className = 'hint match';
  } else {
    hint.textContent = 'Passwords don’t match yet.';
    hint.className = 'hint nomatch';
  }
}

$('password').addEventListener('input', updateHint);
$('confirm').addEventListener('input', updateHint);

function setPasswordVisible(visible) {
  const type = visible ? 'text' : 'password';
  $('password').type = type;
  $('confirm').type = type;
  $('toggle').textContent = visible ? 'Showing' : 'Hold';
  $('toggle').setAttribute('aria-pressed', String(visible));
}

function clearFields() {
  form.reset();
  $('name').value = '';
  $('email').value = '';
  $('password').value = '';
  $('confirm').value = '';
  $('remember').checked = false;
  setPasswordVisible(false);
  updateHint();
}

function setMode(next, keepMessage = false) {
  mode = next;
  const up = mode === 'signup';
  clearFields();
  form.classList.toggle('signup', up);
  $('title').textContent = up ? 'Create your account' : 'Welcome to Kalin';
  $('subtitle').textContent = up ? 'Set up your family’s care hub in a minute.' : 'Please sign in to access your family’s care hub.';
  $('submit-text').textContent = up ? 'Create account' : 'Sign in';
  $('or-text').textContent = up ? 'Already have an account?' : 'New to Kalin?';
  $('switch-text').textContent = up ? 'Back to sign in' : 'Create new account';
  $('password').autocomplete = up ? 'new-password' : 'off';
  if (!keepMessage) clearMsg();
}

$('switch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

// Hold-to-show password button
const toggleBtn = $('toggle');
toggleBtn.textContent = 'Hold';
toggleBtn.setAttribute('aria-label', 'Hold to show password');

const reveal = e => {
  if (e.button !== undefined && e.button !== 0) return;
  setPasswordVisible(true);
};
const conceal = () => setPasswordVisible(false);

toggleBtn.addEventListener('pointerdown', reveal);
toggleBtn.addEventListener('pointerup', conceal);
toggleBtn.addEventListener('pointerleave', conceal);
toggleBtn.addEventListener('pointercancel', conceal);
toggleBtn.addEventListener('blur', conceal);
toggleBtn.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    setPasswordVisible(true);
  }
});
toggleBtn.addEventListener('keyup', e => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    setPasswordVisible(false);
  }
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
  if (mode === 'signup' && password.length < 8) return show('Use a password with at least 8 characters.', 'err');
  if (mode === 'signup' && password !== $('confirm').value) return show('The two passwords don’t match.', 'err');

  submitBtn.disabled = true;
  const isSignup = mode === 'signup';
  $('submit-text').textContent = isSignup ? 'Creating account…' : 'Signing in…';

  try {
    const client = getClient();
    if (isSignup) {
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { full_name: name }, emailRedirectTo: window.location.origin + '/' + AFTER_LOGIN_URL }
      });
      if (error) throw error;
      if (data.session) {
        window.location.href = AFTER_LOGIN_URL;
        return;
      }
      // Switch back to sign-in view, clear all inputs, and show confirmation
      setMode('signin', true);
      show('Account created! Check your email to confirm it, then sign in.', 'ok');
    } else {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = AFTER_LOGIN_URL;
    }
  } catch (err) {
    show(friendly(err), 'err');
    $('submit-text').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  } finally {
    submitBtn.disabled = false;
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
      const c = createKalinClient(store);
      const { data } = await c.auth.getSession();
      if (data.session) { window.location.href = AFTER_LOGIN_URL; return; }
    }
  } catch (_) {}
})();

/* ===== Info pop-up (Privacy / Terms / Security / Help) ===== */
const dialog = $('info-dialog');

function openInfo(key) {
  dialog.querySelectorAll('[data-panel]').forEach(panel => {
    const match = panel.dataset.panel === key;
    panel.hidden = !match;
    if (match) $('info-title').textContent = panel.dataset.title;
  });
  dialog.querySelector('.dlg-body').scrollTop = 0;
  dialog.showModal();
}

document.querySelectorAll('[data-info]').forEach(btn => {
  btn.addEventListener('click', () => openInfo(btn.dataset.info));
});

$('info-close').addEventListener('click', () => dialog.close());
$('info-done').addEventListener('click', () => dialog.close());

// Click on the dimmed backdrop closes it
dialog.addEventListener('click', e => {
  if (e.target === dialog) dialog.close();
});