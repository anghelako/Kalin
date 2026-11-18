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
   Circles: sidebar drawer + dashboard widget + "Create circle" dialog
   ===================================================================== */

const CIRCLE_COLORS = ['#a8f0dc', '#b9b8ff', '#a5d4f7', '#ffd9b0', '#f7bcd0'];
const ICON_CIRCLES = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>';
const ICON_CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_ALERT = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5M12 16h.01"/></svg>';
const DRAWER_KEY = 'kalin.circlesOpen';

let circles = [];
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

function openCircle(circle) {
  // TODO: once circle pages exist, replace with:
  // window.location.href = 'circle.html?id=' + circle.id;
  window.alert('“' + circle.name + '” will open here once circle pages are built.');
}

/* ---------- Sidebar drawer ---------- */

function setDrawerOpen(group, open) {
  group.classList.toggle('collapsed', !open);
  group.querySelector('.nav-toggle').setAttribute('aria-expanded', String(open));
  try {
    window.localStorage.setItem(DRAWER_KEY, open ? '1' : '0');
  } catch (_) {
    // Storage unavailable: the drawer just won't remember its state
  }
}

function buildCirclesDrawer() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const group = el('div', 'nav-group');
  group.id = 'circles-nav';
  group.innerHTML = `
    <button type="button" class="nav-item nav-toggle" id="circles-toggle"
            aria-expanded="true" aria-controls="circles-drawer" title="Circles">
      ${ICON_CIRCLES}
      <span>Circles</span>
      <span class="count" id="circles-count">–</span>
      ${ICON_CHEVRON}
    </button>
    <div class="circle-drawer" id="circles-drawer">
      <ul class="circle-list" id="circle-list-items"></ul>
    </div>`;
  nav.appendChild(group);

  let open = true;
  try {
    open = window.localStorage.getItem(DRAWER_KEY) !== '0';
  } catch (_) {
    // Storage unavailable: stay open
  }
  setDrawerOpen(group, open);

  const narrow = window.matchMedia('(max-width: 860px)');
  group.querySelector('.nav-toggle').addEventListener('click', () => {
    if (narrow.matches) {
      // The slim icon-only sidebar has no room for a list, so jump to the widget
      window.location.href = 'dashboard.html#circles';
      return;
    }
    setDrawerOpen(group, group.classList.contains('collapsed'));
  });
}

function renderDrawer() {
  const list = document.getElementById('circle-list-items');
  const count = document.getElementById('circles-count');
  if (!list || !count) return;

  list.replaceChildren();
  count.textContent = circlesState === 'ready' ? String(circles.length) : '–';

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

    const swatch = el('span', 'swatch');
    swatch.style.background = colorFor(circle);

    button.append(swatch, el('span', 'circle-name', circle.name));
    button.addEventListener('click', () => openCircle(circle));
    item.appendChild(button);
    list.appendChild(item);
  });
}

/* ---------- Dashboard widget ---------- */

function stateBox(title, text, buttonLabel, onClick, icon) {
  const box = el('div', 'circle-state');
  const iconWrap = el('div', 'state-icon');
  iconWrap.innerHTML = icon;

  const button = el('button', 'btn-create', buttonLabel);
  button.type = 'button';
  button.addEventListener('click', onClick);

  box.append(iconWrap, el('h3', '', title), el('p', '', text), button);
  return box;
}

function circleCard(circle) {
  const card = el('button', 'circle-card');
  card.type = 'button';

  const badge = el('span', 'circle-badge', initialOf(circle.name));
  badge.style.background = colorFor(circle);

  const info = el('div');
  info.appendChild(el('h3', '', circle.name));
  if (circle.description) info.appendChild(el('p', 'circle-desc', circle.description));

  const meta = el('div', 'circle-meta');
  meta.appendChild(el('span', '', circle.members === 1 ? '1 member' : circle.members + ' members'));
  if (currentUser && circle.created_by === currentUser.id) {
    meta.appendChild(el('span', 'tag-owner', 'Owner'));
  }

  card.append(badge, info, meta);
  card.addEventListener('click', () => openCircle(circle));
  return card;
}

function addCard() {
  const card = el('button', 'circle-card add');
  card.type = 'button';
  card.innerHTML = ICON_PLUS;
  card.appendChild(el('span', '', 'New circle'));
  card.addEventListener('click', openCircleDialog);
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
    grid.appendChild(stateBox('Couldn’t load your circles', circlesError, 'Try again', loadCircles, ICON_ALERT));
    return;
  }

  if (!circles.length) {
    grid.appendChild(stateBox(
      'No circles yet',
      'Create a circle to start coordinating care with family and caregivers.',
      'Create circle',
      openCircleDialog,
      ICON_CIRCLES
    ));
    return;
  }

  circles.forEach(circle => grid.appendChild(circleCard(circle)));
  grid.appendChild(addCard());
}

function renderCircles() {
  renderDrawer();
  renderWidget();
}

/* ---------- Loading ---------- */

async function loadCircles() {
  circlesState = 'loading';
  renderCircles();

  const user = await window.kalinReady;
  if (!user || !client) return;

  const { data, error } = await client
    .from('circles')
    .select('id, name, description, created_by, created_at, circle_members(count)')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Could not load circles:', error);
    circlesError = isMissingTable(error)
      ? 'The circles tables don’t exist in Supabase yet. Run the SQL setup first.'
      : 'Something went wrong while loading. Check your connection and try again.';
    circlesState = 'error';
    renderCircles();
    return;
  }

  circles = data.map(circle => ({
    ...circle,
    members: (circle.circle_members && circle.circle_members[0] && circle.circle_members[0].count) || 1
  }));
  circlesState = 'ready';
  renderCircles();
}

/* ---------- Create-circle dialog ---------- */

const circleDialog = document.getElementById('circle-dialog');
const circleForm = document.getElementById('circle-form');

function setCircleError(text) {
  const box = document.getElementById('circle-error');
  if (box) box.textContent = text;
}

function openCircleDialog() {
  if (!circleDialog) return;
  circleForm.reset();
  setCircleError('');
  circleDialog.showModal();
  document.getElementById('circle-name').focus();
}

if (circleDialog && circleForm) {
  const saveButton = document.getElementById('circle-save');

  document.getElementById('circle-close').addEventListener('click', () => circleDialog.close());
  document.getElementById('circle-cancel').addEventListener('click', () => circleDialog.close());

  // Clicking the dimmed backdrop closes it
  circleDialog.addEventListener('click', e => {
    if (e.target === circleDialog) circleDialog.close();
  });

  circleForm.addEventListener('submit', async e => {
    e.preventDefault();
    setCircleError('');

    const name = document.getElementById('circle-name').value.trim();
    const description = document.getElementById('circle-desc').value.trim();

    if (!name) return setCircleError('Give your circle a name.');
    if (!client) return setCircleError('You’re not signed in. Refresh the page and try again.');

    saveButton.disabled = true;
    saveButton.textContent = 'Creating…';

    const { data, error } = await client
      .from('circles')
      .insert({ name, description: description || null })
      .select('id, name, description, created_by, created_at')
      .single();

    saveButton.disabled = false;
    saveButton.textContent = 'Create circle';

    if (error) {
      console.error('Could not create circle:', error);
      return setCircleError(isMissingTable(error)
        ? 'The circles tables don’t exist in Supabase yet. Run the SQL setup first.'
        : error.message);
    }

    circles.push({ ...data, members: 1 });
    circlesState = 'ready';
    renderCircles();
    circleDialog.close();
  });
}

const createCircleButton = document.getElementById('create-circle');
if (createCircleButton) createCircleButton.addEventListener('click', openCircleDialog);

buildCirclesDrawer();
loadCircles();