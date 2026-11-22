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
  const profileName = document.querySelector('[data-profile-name]');
  if (profileName) {
    profileName.textContent = first;
    profileName.parentElement.setAttribute('aria-label', 'Profile, ' + first);
  }
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
if (today) {
  today.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

const notifications = document.getElementById('notif');
if (notifications) {
  notifications.addEventListener('click', () => {
    // Join requests waiting for the owner: jump to them
    if (reviewRequests.length) {
      const panel = document.getElementById('requests');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.location.href = 'dashboard.html#requests';
      return;
    }
    window.alert('You’re all caught up. Notifications will appear here once the notification feature is connected.');
  });
}

const profile = document.getElementById('profile');
if (profile) {
  profile.addEventListener('click', async () => {
    await window.kalinReady;
    if (currentUser) window.alert('Signed in as: ' + currentUser.email);
  });
}

/* =====================================================================
   Circles: rail + dashboard widget + "Create circle" dialog
   ===================================================================== */

/* Legacy hash colors: only used when a circle has no stored color yet
   (before the colors SQL update). calendar.js also reads this list. */
const CIRCLE_COLORS = ['#a8f0dc', '#b9b8ff', '#a5d4f7', '#ffd9b0', '#f7bcd0'];

/* Each person's circles get different colors. The database picks the color
   (next_circle_color in supabase/circles_join_setup.sql); this list only
   previews it, so keep the order identical to the SQL palette.
   Not called PALETTE: calendar.js already owns that name. */
const CIRCLE_PALETTE = [
  { hex: '#8fe3c8', name: 'Mint' },
  { hex: '#b9b8ff', name: 'Lavender' },
  { hex: '#8cc8f5', name: 'Sky' },
  { hex: '#ffc999', name: 'Peach' },
  { hex: '#f7a8c4', name: 'Pink' },
  { hex: '#f3dc7a', name: 'Lemon' },
  { hex: '#bfe58a', name: 'Lime' },
  { hex: '#f2958a', name: 'Coral' },
  { hex: '#7fdde4', name: 'Aqua' },
  { hex: '#d3a8f2', name: 'Violet' },
  { hex: '#d9c3a0', name: 'Sand' },
  { hex: '#a9b8cc', name: 'Slate' }
];
const ICON_CIRCLES = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_ALERT = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5M12 16h.01"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>';

let circles = [];
let myRequests = [];       // requests I sent that are still pending
let reviewRequests = [];   // requests from others to join circles I own
let circlesState = 'loading'; // 'loading' | 'ready' | 'error'
let circlesError = '';

/* Builds an element. Text is always set with textContent, never innerHTML,
   so circle names typed by users can't inject markup. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function colorFor(circle) {
  if (circle.color) return circle.color; // personal color stored in circle_members
  let sum = 0;
  for (const ch of String(circle.id)) sum += ch.charCodeAt(0);
  return CIRCLE_COLORS[sum % CIRCLE_COLORS.length];
}

function initialOf(name) {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

function isMissingTable(error) {
  const text = (error.message || '').toLowerCase();
  return error.code === 'PGRST205' || error.code === '42P01' ||
    text.includes('schema cache') || text.includes('does not exist');
}

function isMissingColumn(error) {
  const text = (error.message || '').toLowerCase();
  return error.code === '42703' || (text.includes('column') && text.includes('does not exist'));
}

function formatCode(code) {
  return code.slice(0, 4) + '-' + code.slice(4);
}

/* The color the next new circle will get: the first one not used by my circles.
   If all are used, the least-used one (same rule as the database). */
function nextColor() {
  const used = circles.map(circle => circle.color);
  const free = CIRCLE_PALETTE.find(p => !used.includes(p.hex));
  if (free) return free;

  const countOf = hex => used.filter(u => u === hex).length;
  return CIRCLE_PALETTE.reduce(
    (best, p) => (countOf(p.hex) < countOf(best.hex) ? p : best),
    CIRCLE_PALETTE[0]
  );
}

/* Invite-code chip: shows the code and copies it on click. Also used by circle.js. */
function codeChip(circle) {
  const code = formatCode(circle.invite_code);
  const chip = el('button', 'code-chip');
  chip.type = 'button';
  chip.title = 'Copy invite code';
  chip.innerHTML = ICON_COPY;
  const label = el('span', '', code);
  chip.appendChild(label);

  chip.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = code;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    label.textContent = 'Copied!';
    chip.classList.add('copied');
    setTimeout(() => {
      label.textContent = code;
      chip.classList.remove('copied');
    }, 1500);
  });

  return chip;
}

function openCircle(circle) {
  window.location.href = 'circle.html?id=' + encodeURIComponent(circle.id);
}

/* ---------- Circle rail ---------- */

function buildCirclesDrawer() {
  const rail = document.querySelector('.side');
  if (!rail) return;

  const group = el('div', 'nav-group');
  group.id = 'circles-nav';
  group.innerHTML = `
    <div class="circle-drawer" id="circles-drawer">
      <ul class="circle-list" id="circle-list-items"></ul>
    </div>
    <button type="button" class="nav-item nav-toggle" id="circles-toggle"
            aria-haspopup="dialog" aria-controls="circle-dialog" title="Create circle"
            aria-label="Create circle">
      ${ICON_PLUS}
      <span>Create circle</span>
    </button>`;
  rail.prepend(group);
  group.querySelector('.nav-toggle').addEventListener('click', () => openCircleDialog('create'));

  const circleTab = document.querySelector('[data-circle-tab]');
  try {
    const lastCircle = window.localStorage.getItem('kalin.lastCircle');
    if (circleTab && lastCircle) circleTab.href = 'circle.html?id=' + encodeURIComponent(lastCircle);
  } catch (_) {
    // Keep the Home fallback if storage is unavailable.
  }
}

const activeCircleId = new URLSearchParams(window.location.search).get('id');

function renderDrawer() {
  const list = document.getElementById('circle-list-items');
  if (!list) return;

  list.replaceChildren();

  if (circlesState !== 'ready') {
    list.appendChild(el('li', 'circle-note', circlesState === 'loading' ? 'Loading…' : 'Couldn’t load circles'));
    return;
  }
  if (!circles.length) {
    list.appendChild(el('li', 'circle-note', 'No active circles yet'));
    return;
  }

  circles.forEach(circle => {
    const item = el('li');
    const button = el('button', 'circle-link');
    button.type = 'button';
    button.title = circle.name;
    button.setAttribute('aria-label', circle.name);
    if (circle.id === activeCircleId) {
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
    }

    const swatch = el('span', 'swatch', initialOf(circle.name));
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.background = colorFor(circle);

    button.append(swatch, el('span', 'circle-name', circle.name));
    button.addEventListener('click', () => openCircle(circle));
    item.appendChild(button);
    list.appendChild(item);
  });
}

/* ---------- Dashboard widget ---------- */

function stateBox(title, text, actions, icon) {
  const box = el('div', 'circle-state');
  const iconWrap = el('div', 'state-icon');
  iconWrap.innerHTML = icon;

  const row = el('div', 'state-actions');
  actions.forEach(action => {
    const button = el('button', action.ghost ? 'btn-ghost' : 'btn-create', action.label);
    button.type = 'button';
    button.addEventListener('click', action.onClick);
    row.appendChild(button);
  });

  box.append(iconWrap, el('h3', '', title), el('p', '', text), row);
  return box;
}

function circleCard(circle) {
  const card = el('button', 'circle-card');
  card.type = 'button';

  // Top row: who's on duty (placeholder until shifts are connected) + role pill
  const top = el('div', 'circle-top');
  const duty = el('span', 'duty');
  duty.append(el('span', 'duty-dot'), el('span', '', 'On duty: No one assigned'));
  top.appendChild(duty);
  if (currentUser && circle.created_by === currentUser.id) {
    top.appendChild(el('span', 'tag-owner', 'Owner'));
  }

  // Title row: the circle's personal color dot + name
  const info = el('div');
  const title = el('div', 'circle-title');
  const dot = el('span', 'circle-dot');
  dot.style.background = colorFor(circle);
  title.append(dot, el('h3', '', circle.name + '’s care circle'));
  info.appendChild(title);
  if (circle.description) info.appendChild(el('p', 'circle-desc', circle.description));

  card.append(top, info);
  card.addEventListener('click', () => openCircle(circle));
  return card;
}

function pendingCard(request) {
  const card = el('div', 'circle-card pending');

  const top = el('div', 'circle-top');
  top.appendChild(el('span', 'tag-wait', 'Waiting for approval'));

  const info = el('div');
  info.appendChild(el('h3', '', request.circle_name + '’s care circle'));

  card.append(top, info);
  return card;
}

function addCard() {
  const card = el('button', 'circle-card add');
  card.type = 'button';
  card.innerHTML = ICON_PLUS;
  card.appendChild(el('span', '', 'New circle'));
  card.addEventListener('click', () => openCircleDialog('create'));
  return card;
}

function renderWidget() {
  const grid = document.getElementById('circle-grid');
  if (!grid) return;

  const badge = document.getElementById('widget-count');
  grid.replaceChildren();
  grid.setAttribute('aria-busy', String(circlesState === 'loading'));
  badge.hidden = circlesState !== 'ready' || !circles.length;
  badge.textContent = String(circles.length);

  if (circlesState === 'loading') {
    for (let i = 0; i < 3; i++) grid.appendChild(el('div', 'circle-skel'));
    return;
  }

  if (circlesState === 'error') {
    grid.appendChild(stateBox(
      'Couldn’t load your circles',
      circlesError,
      [{ label: 'Try again', onClick: () => loadCircles() }],
      ICON_ALERT
    ));
    return;
  }

  if (!circles.length && !myRequests.length) {
    grid.appendChild(stateBox(
      'No circles yet',
      'Create a circle to start coordinating care, or join one with an invite code.',
      [
        { label: 'Create circle', onClick: () => openCircleDialog('create') },
        { label: 'Join with a code', onClick: () => openCircleDialog('join'), ghost: true }
      ],
      ICON_CIRCLES
    ));
    return;
  }

  circles.forEach(circle => grid.appendChild(circleCard(circle)));
  myRequests.forEach(request => grid.appendChild(pendingCard(request)));
  grid.appendChild(addCard());
}

/* ---------- Join requests (shown to circle owners) ---------- */

function requestRow(request) {
  const row = el('div', 'request-row');
  row.appendChild(el('span', 'req-avatar', initialOf(request.requester_name)));

  const info = el('div', 'req-info');
  const title = el('p', 'req-title');
  title.append(
    el('strong', '', request.requester_name),
    ' wants to join ',
    el('strong', '', request.circle_name + '’s care circle')
  );
  info.appendChild(title);
  if (request.requester_email) info.appendChild(el('p', 'req-sub', request.requester_email));

  const problem = el('p', 'req-error');
  problem.hidden = true;
  info.appendChild(problem);

  const decline = el('button', 'btn-ghost small', 'Decline');
  const approve = el('button', 'btn-solid small', 'Approve');
  decline.type = 'button';
  approve.type = 'button';

  const respond = async approved => {
    decline.disabled = true;
    approve.disabled = true;
    problem.hidden = true;

    const { error } = await client.rpc('respond_to_join_request', {
      p_request: request.id,
      p_approve: approved
    });

    if (error) {
      console.error('Could not answer request:', error);
      problem.textContent = error.message;
      problem.hidden = false;
      decline.disabled = false;
      approve.disabled = false;
      return;
    }
    await loadCircles(true);
  };

  decline.addEventListener('click', () => respond(false));
  approve.addEventListener('click', () => respond(true));

  const actions = el('div', 'req-actions');
  actions.append(decline, approve);
  row.append(info, actions);
  return row;
}

function renderRequests() {
  const dot = document.querySelector('#notif .dot');
  if (dot) dot.hidden = reviewRequests.length === 0;

  const panel = document.getElementById('requests');
  if (!panel) return;

  const list = document.getElementById('request-list');
  list.replaceChildren();
  reviewRequests.forEach(request => list.appendChild(requestRow(request)));

  document.getElementById('request-count').textContent = String(reviewRequests.length);
  panel.hidden = reviewRequests.length === 0;

  if (!panel.hidden && window.location.hash === '#requests') panel.scrollIntoView();
}

function renderCircles() {
  renderDrawer();
  renderWidget();
  renderRequests();
}

/* ---------- Loading ---------- */

/* One circle as the rest of the app sees it */
function toCircle(circle, extra) {
  const counted = circle.circle_members && circle.circle_members[0];
  return {
    id: circle.id,
    name: circle.name,
    description: circle.description,
    invite_code: circle.invite_code,
    created_by: circle.created_by,
    created_at: circle.created_at,
    members: (counted && counted.count) || 1,
    ...extra
  };
}

async function fetchMyCircles(user) {
  // Normal path: my memberships, which carry my personal color
  const modern = await client
    .from('circle_members')
    .select('role, color, circles!inner(id, name, description, invite_code, created_by, created_at, circle_members(count))')
    .eq('user_id', user.id)
    .eq('circles.is_active', true)
    .order('joined_at', { ascending: true });

  if (!modern.error) {
    return { data: modern.data.map(row => toCircle(row.circles, { color: row.color, role: row.role })) };
  }
  if (!isMissingColumn(modern.error)) return { error: modern.error };

  // The colors/invite-code SQL update hasn't been run yet: keep the app working
  // with the old query. Delete this fallback once the update has been run.
  const legacy = await client
    .from('circles')
    .select('id, name, description, created_by, created_at, circle_members(count)')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (legacy.error) return { error: legacy.error };
  return {
    data: legacy.data.map(circle => toCircle(circle, {
      role: circle.created_by === user.id ? 'owner' : 'member'
    }))
  };
}

async function loadCircles(silent = false) {
  if (!silent) {
    circlesState = 'loading';
    renderCircles();
  }

  const user = await window.kalinReady;
  if (!user || !client) return;

  const [mine, requests] = await Promise.all([
    fetchMyCircles(user),
    client
      .from('circle_join_requests')
      .select('id, circle_id, user_id, circle_name, requester_name, requester_email, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
  ]);

  if (mine.error) {
    console.error('Could not load circles:', mine.error);
    if (silent) return; // keep showing what we already have
    circlesError = isMissingTable(mine.error)
      ? 'The circles tables don’t exist in Supabase yet. Run the SQL setup first.'
      : 'Something went wrong while loading. Check your connection and try again.';
    circlesState = 'error';
    renderCircles();
    return;
  }

  circles = mine.data;

  if (requests.error) {
    // Join requests aren't set up yet: circles still work without them
    console.warn('Could not load join requests:', requests.error);
    myRequests = [];
    reviewRequests = [];
  } else {
    myRequests = requests.data.filter(request => request.user_id === user.id);
    reviewRequests = requests.data.filter(request => request.user_id !== user.id);
  }

  circlesState = 'ready';
  renderCircles();
}

// Pick up approvals and new requests when coming back to the tab
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && circlesState === 'ready') loadCircles(true);
});

/* ---------- Create / join dialog ---------- */

const circleDialog = document.getElementById('circle-dialog');
const circleForm = document.getElementById('circle-form');
let dialogTab = 'create';
let joinSent = false;

function setCircleMessage(text, kind = 'err') {
  const box = document.getElementById('circle-error');
  if (!box) return;
  box.textContent = text;
  box.className = 'hint ' + (kind === 'ok' ? 'match' : 'nomatch');
}

function renderColorPicker() {
  const next = nextColor();
  const used = new Set(circles.map(circle => circle.color));
  const wrap = document.getElementById('swatches');
  wrap.replaceChildren();

  CIRCLE_PALETTE.forEach(p => {
    const dot = el('span', 'swatch-dot');
    dot.style.setProperty('--c', p.hex);
    dot.title = p.name + (used.has(p.hex) ? ' (already used)' : '');
    if (used.has(p.hex)) dot.classList.add('taken');
    if (p.hex === next.hex) dot.classList.add('next');
    wrap.appendChild(dot);
  });

  document.getElementById('color-name').textContent = next.name;
  document.getElementById('badge-preview').style.setProperty('--preview', next.hex);
}

function updateBadgePreview() {
  const name = document.getElementById('circle-name').value;
  document.getElementById('badge-preview').textContent = name.trim() ? initialOf(name) : '?';
}

function syncCircleFooter() {
  const sent = dialogTab === 'join' && joinSent;
  const save = document.getElementById('circle-save');

  save.hidden = sent;
  save.textContent = dialogTab === 'create' ? 'Create circle' : 'Request to join';
  document.getElementById('circle-cancel').textContent = sent ? 'Done' : 'Cancel';
  document.getElementById('join-entry').hidden = sent;
  document.getElementById('join-sent').hidden = !sent;
}

function setCircleTab(tab) {
  dialogTab = tab;
  const isCreate = tab === 'create';

  document.getElementById('tab-create').setAttribute('aria-selected', String(isCreate));
  document.getElementById('tab-create').tabIndex = isCreate ? 0 : -1;
  document.getElementById('tab-join').setAttribute('aria-selected', String(!isCreate));
  document.getElementById('tab-join').tabIndex = isCreate ? -1 : 0;
  document.getElementById('panel-create').hidden = !isCreate;
  document.getElementById('panel-join').hidden = isCreate;
  document.getElementById('circle-dialog-title').textContent = isCreate ? 'Create a circle' : 'Join a circle';

  setCircleMessage('');
  if (isCreate) renderColorPicker();
  syncCircleFooter();
}

function openCircleDialog(tab = 'create') {
  if (!circleDialog) return;
  circleForm.reset();
  joinSent = false;
  setCircleTab(tab);
  updateBadgePreview();
  circleDialog.showModal();
  document.getElementById(tab === 'create' ? 'circle-name' : 'join-code').focus();
}

if (circleDialog && circleForm) {
  const saveButton = document.getElementById('circle-save');

  const setBusy = (busy, label) => {
    saveButton.disabled = busy;
    if (busy) saveButton.textContent = label;
    else syncCircleFooter();
  };

  const submitCreate = async () => {
    const name = document.getElementById('circle-name').value.trim();
    const description = document.getElementById('circle-desc').value.trim();
    if (!name) return setCircleMessage('Give your circle a name.');

    setBusy(true, 'Creating…');
    const { error } = await client
      .from('circles')
      .insert({ name, description: description || null });
    setBusy(false);

    if (error) {
      console.error('Could not create circle:', error);
      return setCircleMessage(isMissingTable(error)
        ? 'The circles tables don’t exist in Supabase yet. Run the SQL setup first.'
        : error.message);
    }

    circleDialog.close();
    await loadCircles(true); // the database picks the color, so reload to show it
  };

  const submitJoin = async () => {
    const code = document.getElementById('join-code').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code.length < 8) return setCircleMessage('Enter the full 8-character code.');

    setBusy(true, 'Sending…');
    const { data, error } = await client.rpc('request_to_join', { p_code: code });
    setBusy(false);

    if (error) {
      console.error('Could not send request:', error);
      return setCircleMessage(isMissingTable(error)
        ? 'Joining isn’t set up in Supabase yet. Run supabase/circles_join_setup.sql first.'
        : error.message);
    }

    const name = data.circle_name;
    if (data.status === 'pending') {
      joinSent = true;
      document.getElementById('join-sent-text').textContent =
        'Your request to join ' + name + '’s care circle is with the owner. You’ll see the circle here once they approve it.';
      syncCircleFooter();
      await loadCircles(true);
    } else if (data.status === 'member') {
      setCircleMessage('You’re already in ' + name + '’s care circle.');
    } else if (data.status === 'denied') {
      setCircleMessage('The owner of ' + name + '’s care circle declined your earlier request.');
    } else {
      setCircleMessage('That code doesn’t match any circle. Check it and try again.');
    }
  };

  circleForm.addEventListener('submit', async e => {
    e.preventDefault();
    setCircleMessage('');
    if (!client) return setCircleMessage('You’re not signed in. Refresh the page and try again.');

    if (dialogTab === 'create') await submitCreate();
    else await submitJoin();
  });

  ['create', 'join'].forEach(tab => {
    const button = document.getElementById('tab-' + tab);

    button.addEventListener('click', () => {
      setCircleTab(tab);
      document.getElementById(tab === 'create' ? 'circle-name' : 'join-code').focus();
    });

    // Arrow keys move between the two tabs
    button.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const other = tab === 'create' ? 'join' : 'create';
      setCircleTab(other);
      document.getElementById('tab-' + other).focus();
    });
  });

  document.getElementById('circle-name').addEventListener('input', updateBadgePreview);

  // Format the code as XXXX-XXXX while typing
  document.getElementById('join-code').addEventListener('input', e => {
    const clean = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
    e.target.value = clean.length > 4 ? clean.slice(0, 4) + '-' + clean.slice(4) : clean;
  });

  document.getElementById('circle-close').addEventListener('click', () => circleDialog.close());
  document.getElementById('circle-cancel').addEventListener('click', () => circleDialog.close());

  // Clicking the dimmed backdrop closes it
  circleDialog.addEventListener('click', e => {
    if (e.target === circleDialog) circleDialog.close();
  });
}

const createCircleButton = document.getElementById('create-circle');
if (createCircleButton) createCircleButton.addEventListener('click', () => openCircleDialog('create'));

const joinCircleButton = document.getElementById('join-circle');
if (joinCircleButton) joinCircleButton.addEventListener('click', () => openCircleDialog('join'));

buildCirclesDrawer();
loadCircles();