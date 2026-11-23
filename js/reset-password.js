const $ = id => document.getElementById(id);
const client = createKalinClient();

const views = {
  checking: $('view-checking'),
  invalid: $('view-invalid'),
  form: $('reset-form'),
  done: $('view-done')
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

function showMsg(text, type) {
  $('msg').textContent = text;
  $('msg').className = 'msg show-msg ' + type;
}

let linkAccepted = false;

// Supabase fires PASSWORD_RECOVERY when the visitor arrives from a valid reset email
client.auth.onAuthStateChange(event => {
  if (event !== 'PASSWORD_RECOVERY') return;
  linkAccepted = true;
  history.replaceState(null, '', window.location.pathname); // hide tokens from the address bar
  showView('form');
  $('password').focus();
});

// If the email link carried an error (expired, already used), say so right away
const hashParams = new URLSearchParams(window.location.hash.slice(1));
if (hashParams.get('error')) {
  const code = hashParams.get('error_code');
  $('invalid-text').textContent = code === 'otp_expired'
    ? 'This reset link has expired. Request a new one from the sign-in page.'
    : 'We couldn’t verify this link. Request a new one from the sign-in page.';
  showView('invalid');
} else {
  // No recovery event shortly after load means the link is missing or invalid
  setTimeout(() => {
    if (!linkAccepted) showView('invalid');
  }, 4000);
}

function updateHint() {
  const hint = $('match-hint'), a = $('password').value, b = $('confirm').value;
  if (!b) {
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

const toggleBtn = $('toggle');
toggleBtn.textContent = 'Hold';
toggleBtn.setAttribute('aria-label', 'Hold to show password');

toggleBtn.addEventListener('pointerdown', e => {
  if (e.button !== undefined && e.button !== 0) return;
  setPasswordVisible(true);
});
['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(evt =>
  toggleBtn.addEventListener(evt, () => setPasswordVisible(false))
);

views.form.addEventListener('submit', async e => {
  e.preventDefault();
  $('msg').className = 'msg';

  const password = $('password').value;
  if (password.length < 8) return showMsg('Use a password with at least 8 characters.', 'err');
  if (password !== $('confirm').value) return showMsg('The two passwords don’t match.', 'err');

  const btn = $('submit');
  btn.disabled = true;
  $('submit-text').textContent = 'Updating…';

  const { error } = await client.auth.updateUser({ password });

  if (error) {
    const same = (error.message || '').toLowerCase().includes('different from the old password');
    showMsg(same ? 'Choose a password you haven’t used before.' : 'Something went wrong. Please try again.', 'err');
    btn.disabled = false;
    $('submit-text').textContent = 'Update password';
    return;
  }

  await client.auth.signOut(); // end the temporary recovery session
  showView('done');
});
