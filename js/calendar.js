/* =========================================================
   KALIN CALENDAR
   One week at a time, Monday through Sunday.
   No demo data or generated sample shifts.
========================================================= */

/* Calendar time slots */
const SLOTS = [
  {
    key: 'morning',
    name: 'Morning shift',
    time: '7:00 AM – 3:00 PM',
    icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
  },
  {
    key: 'evening',
    name: 'Evening shift',
    time: '3:00 PM – 10:00 PM',
    icon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'
  }
];

/* Circle colors */
const PALETTE = [
  /* Same order as CIRCLE_COLORS in dashboard.js (mint, lavender, blue, peach, pink)
     so a circle keeps the same hue in the sidebar and in the calendar. */
  { c: '#0d9488', bg: '#f0fdfa', line: '#99f6e4' },
  { c: '#4f46e5', bg: '#eef2ff', line: '#c7d2fe' },
  { c: '#0284c7', bg: '#f0f9ff', line: '#bae6fd' },
  { c: '#ea580c', bg: '#fff7ed', line: '#fed7aa' },
  { c: '#e11d48', bg: '#fff1f2', line: '#fecdd3' }
];

/* Calendar state */
const state = {
  weekStart: startOfWeek(parseYmd(KalinTime.manilaToday())),
  filter: 'all',
  circles: [],
  circleList: [],   // [{ id, name, owned }]
  shifts: [],
  me: 'Member',
  colors: new Map()
};

/* Helpers */
const $ = (id) => document.getElementById(id);

const fmt = (d, options) =>
  d.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });

/* =========================================================
   DATE FUNCTIONS
========================================================= */

function startOfWeek(date) {
  return addDays(date, -((date.getUTCDay() + 6) % 7));
}

function addDays(date, amount) {
  return parseYmd(KalinTime.addDays(ymd(date), amount));
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function weekDates(start) {
  return Array.from(
    { length: 7 },
    (_, i) => addDays(start, i)
  );
}

/* =========================================================
   DATABASE
   No sample or generated data.
========================================================= */

let shiftBusy = false;
let calStatusTimer = null;

function calSetStatus(text, isError) {
  const box = $('cal-status');
  if (!box) return;

  clearTimeout(calStatusTimer);
  box.textContent = text || '';
  box.hidden = !text;
  box.classList.toggle('is-error', !!isError);

  if (text && !isError) {
    calStatusTimer = setTimeout(() => { box.hidden = true; box.textContent = ''; }, 4000);
  }
}

function calFriendlyError(error, fallback) {
  if (error && isMissingTable(error)) {
    return 'The shift tables are not set up in Supabase yet. Run supabase/shifts_setup.sql first.';
  }
  return KalinRx.databaseMessage(error, fallback);
}

function calLoadError(error, fallback) {
  const wrapped = new Error(fallback, { cause: error });
  wrapped.friendly = calFriendlyError(error, fallback);
  return wrapped;
}

async function loadShifts(dates) {
  /* RLS returns only shifts of circles the user belongs to. */
  const { data, error } = await client
    .from('shifts')
    .select('id, shift_date, slot, assigned_to, assigned_name, circle_id, circles(name), profiles:assigned_to(full_name)')
    .gte('shift_date', ymd(dates[0]))
    .lte('shift_date', ymd(dates[dates.length - 1]))
    .order('shift_date', { ascending: true });

  if (error) throw calLoadError(error, 'We could not load the calendar. Please refresh and try again.');

  const owned = new Set(state.circleList.filter((c) => c.owned).map((c) => c.id));

  return data.map((row) => ({
    id: row.id,
    shift_date: row.shift_date,
    slot: row.slot,
    circle: row.circles ? row.circles.name : 'Circle',
    circleId: row.circle_id,
    assigned_to: row.assigned_to,
    assigned_name: row.assigned_name,
    person: row.assigned_name?.trim() || row.profiles?.full_name?.trim(),
    mine: !!currentUser && row.assigned_to === currentUser.id,
    canManage: owned.has(row.circle_id)
  }));
}

async function loadCalendarCircles() {
  const { data, error } = await client
    .from('circles')
    .select('id, name, created_by')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) throw calLoadError(error, 'We could not load your circles. Please refresh and try again.');

  /* My personal color for each circle (circle_members.color). If the colors SQL
     update hasn't been run yet this fails quietly and the old colors are used. */
  const personal = new Map();
  if (currentUser) {
    const mine = await client
      .from('circle_members')
      .select('circle_id, color')
      .eq('user_id', currentUser.id);

    if (!mine.error) mine.data.forEach((row) => personal.set(row.circle_id, row.color));
  }

  return data.map((circle) => ({
    id: circle.id,
    name: circle.name,
    owned: !!currentUser && circle.created_by === currentUser.id,
    color: personal.get(circle.id) || null
  }));
}

/* Volunteer (take = true) or release (take = false) */
async function setShift(id, take) {
  if (shiftBusy) return;
  const shift = state.shifts.find(row => row.id === id);
  if (shift && KalinTime.hasStarted(shift)) {
    calSetStatus(KalinRx.databaseMessage({ message: 'shift_started' }), true);
    await load();
    return;
  }
  shiftBusy = true;
  calSetStatus('');

  const { error } = await client.rpc(take ? 'claim_shift' : 'release_shift', { shift_id: id });
  shiftBusy = false;

  if (error) {
    console.error('Shift action failed:', error);
    calSetStatus(
      calFriendlyError(error, 'Something went wrong. Please try again.'),
      true
    );
  } else {
    calSetStatus(take ? 'You volunteered for this shift.' : 'Shift released.');
  }

  /* Reload either way so the grid always shows the current truth
     (for example when someone else took the shift first). */
  await load();
}

/* Owner only: remove a shift */
async function deleteShift(id) {
  if (shiftBusy) return;
  if (!window.confirm('Delete this shift? This cannot be undone.')) return;

  shiftBusy = true;
  const { data, error } = await client.from('shifts').delete().eq('id', id).select('id');
  shiftBusy = false;

  if (error || !data || !data.length) {
    console.error('Could not delete shift:', error);
    calSetStatus('You do not have permission to delete this shift.', true);
  } else {
    calSetStatus('Shift deleted.');
  }

  await load();
}

/* =========================================================
   CIRCLE COLORS
========================================================= */

/* Turns a pastel circle color into the three tones the calendar uses */
function calendarShades(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (amount, target) => '#' + channels
    .map((v) => Math.round(v + (target - v) * amount).toString(16).padStart(2, '0'))
    .join('');

  return { c: mix(0.55, 0), bg: mix(0.82, 255), line: mix(0.5, 255) };
}

function calendarColorFor(circle) {
  if (!state.colors.has(circle)) {
    const known = state.circleList.find((c) => c.name === circle);

    if (known && known.color) {
      /* Same personal color as the sidebar dot and the Home card */
      state.colors.set(circle, calendarShades(known.color));
    } else {
      /* No stored color yet: use the old hash so nothing breaks */
      let index = -1;
      if (known) index = CIRCLE_COLORS.indexOf(colorFor({ id: known.id }));
      if (index < 0) index = state.colors.size % PALETTE.length;
      state.colors.set(circle, PALETTE[index % PALETTE.length]);
    }
  }

  return state.colors.get(circle);
}

/* =========================================================
   FILTERS
========================================================= */

function isOpen(shift, now) {
  return !shift.assigned_to && !(shift.assigned_name && +now >= +KalinTime.shiftEnd(shift));
}

function visible(shift, now) {
  const filter = state.filter;

  if (filter === 'all') return true;

  if (filter === 'mine') return shift.mine;

  if (filter === 'open') return isOpen(shift, now);

  return filter === 'c:' + shift.circle;
}

/* =========================================================
   SHIFT CARDS
========================================================= */

function updateShiftButton(button, shift, now) {
  const started = KalinTime.hasStarted(shift, now);
  button.disabled = started;
  if (started) {
    button.title = 'This shift has already started.';
    button.setAttribute('aria-label', button.textContent + ' unavailable. This shift has already started.');
  } else {
    button.removeAttribute('title');
    button.removeAttribute('aria-label');
  }
}

function shiftCard(shift, now) {
  const color = calendarColorFor(shift.circle);
  const open = isOpen(shift, now);
  const card = el('article', open ? 'shift open' : 'shift');
  card.style.setProperty('--c', color.c);
  card.style.setProperty('--c-bg', color.bg);
  card.style.setProperty('--c-line', color.line);

  const top = el('div', 'shift-top');
  top.appendChild(el('span', 'sh-tag', shift.circle));
  if (shift.mine) top.appendChild(el('span', 'sh-you', 'YOU'));
  if (shift.canManage) {
    const remove = el('button', 'sh-del', '×');
    remove.type = 'button';
    remove.dataset.action = 'delete';
    remove.dataset.id = shift.id;
    remove.title = 'Delete shift';
    remove.setAttribute('aria-label', 'Delete shift');
    top.appendChild(remove);
  }

  let person = shift.person || 'Member';
  if (open) person = 'Open slot';
  if (shift.mine) person = 'You (' + (shift.person || state.me) + ')';
  card.append(top, el('div', 'sh-who', person));

  if (open || shift.mine) {
    const button = el('button', open ? 'shift-btn volunteer' : 'shift-btn', open ? 'Volunteer' : 'Release');
    button.type = 'button';
    button.dataset.action = open ? 'volunteer' : 'release';
    button.dataset.id = shift.id;
    updateShiftButton(button, shift, now);
    card.appendChild(button);
  } else {
    card.appendChild(el('div', 'sh-status', 'Covered'));
  }
  return card;
}

/* =========================================================
   CALENDAR RENDERING
========================================================= */

function render() {
  const dates = weekDates(state.weekStart);
  const now = KalinTime.now();
  const todayKey = KalinTime.manilaToday(now);

  /* Week label */
  $('week-label').textContent =
    fmt(dates[0], {
      month: 'short',
      day: 'numeric'
    }) +
    ' – ' +
    fmt(dates[6], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

  /* Schedule-view button + dropdown */
  renderView(now);

  /* Calendar header */
  let html = `
    <div class="wg-head">
      <div class="wg-corner">Time slot</div>
  `;

  html += dates.map((date) => `
    <div class="wg-day${ymd(date) === todayKey ? ' today' : ''}">
      <small>
        ${fmt(date, { weekday: 'short' })}
      </small>

      <strong>
        ${fmt(date, {
          month: 'short',
          day: 'numeric'
        })}
      </strong>
    </div>
  `).join('');

  html += '</div>';

  /* Calendar rows */
  let shown = 0;
  const shiftsByCell = [];

  for (const slot of SLOTS) {
    html += `
      <div class="wg-row">

        <div class="wg-slot">
          <b>
            <svg viewBox="0 0 24 24">
              ${slot.icon}
            </svg>
            ${slot.name}
          </b>

          <small>${slot.time}</small>
        </div>
    `;

    for (const date of dates) {
      const cards = state.shifts
        .filter((shift) =>
          shift.shift_date === ymd(date) &&
          shift.slot === slot.key &&
          visible(shift, now)
        )
        .sort((a, b) =>
          a.circle.localeCompare(b.circle)
        );

      shown += cards.length;
      shiftsByCell.push(cards);

      html += `<div class="wg-cell${ymd(date) === todayKey ? ' today' : ''}"></div>`;
    }

    html += '</div>';
  }

  const grid = $('week-grid');
  grid.innerHTML = html;
  grid.querySelectorAll('.wg-cell').forEach((cell, index) => {
    cell.append(...shiftsByCell[index].map(shift => shiftCard(shift, now)));
  });

  /* Empty calendar message */
  const note = $('cal-note');

  note.hidden = shown > 0;

  note.textContent = state.shifts.length
    ? 'No shifts match this filter this week.'
    : 'No shifts are scheduled this week.';
}

/* =========================================================
   SCHEDULE VIEW DROPDOWN
   Opens downward from the "Viewing" button and lets the person
   pick which schedule the calendar shows:
   all circles, one circle, only their shifts, or only open shifts.
========================================================= */

const VIEW_ICON_CHECK =
  '<svg class="opt-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function circleNames() {
  return [...new Set([
    ...state.circles,
    ...state.shifts.map((shift) => shift.circle)
  ])];
}

function viewLabel() {
  const filter = state.filter;

  if (filter === 'mine') return 'My shifts only';
  if (filter === 'open') return 'Open shifts only';
  if (filter.startsWith('c:')) return filter.slice(2);

  return 'All circles';
}

function viewOption(key, label, count, color) {
  const button = el('button', 'opt');
  button.type = 'button';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', String(state.filter === key));
  button.dataset.view = key;
  button.style.setProperty('--c', color);
  button.append(el('span', 'opt-dot'), el('span', 'opt-name', label), el('span', 'opt-count', count));
  button.insertAdjacentHTML('beforeend', VIEW_ICON_CHECK);
  return button;
}

function renderView(now = KalinTime.now()) {
  const names = circleNames();

  const countFor = (name) =>
    state.shifts.filter((shift) => shift.circle === name).length;

  /* Button label */
  $('view-label').textContent = viewLabel();

  /* Circle options */
  const drawer = $('drawer-list');
  drawer.innerHTML = `
    <section class="drawer-group">
      <h3>Circles</h3>
      <div class="drawer-list" role="radiogroup" aria-label="Circles"></div>
    </section>

    <section class="drawer-group">
      <h3>Quick views</h3>
      <div class="drawer-list" role="radiogroup" aria-label="Quick views"></div>
    </section>
  `;
  const [circleGroup, quickGroup] = drawer.querySelectorAll('.drawer-list');
  circleGroup.appendChild(viewOption('all', 'All circles', state.shifts.length, '#081224'));
  if (names.length) {
    circleGroup.append(...names.map(name => viewOption('c:' + name, name, countFor(name), calendarColorFor(name).c)));
  } else {
    circleGroup.appendChild(el('p', 'drawer-empty',
      "You haven't joined any circles yet. Circles you join will show up here."));
  }
  quickGroup.append(
    viewOption('mine', 'My shifts only', state.shifts.filter(shift => shift.mine).length, '#0d9488'),
    viewOption('open', 'Open shifts only', state.shifts.filter(shift => isOpen(shift, now)).length, '#f59e0b')
  );
}

function menuIsOpen() {
  return $('view-drawer').classList.contains('open');
}

function openMenu() {
  renderView();

  $('view-drawer').classList.add('open');
  $('view-drawer').setAttribute('aria-hidden', 'false');
  $('view-btn').setAttribute('aria-expanded', 'true');

  const selected = $('drawer-list').querySelector('[aria-checked="true"]');

  if (selected) selected.focus();
}

function closeMenu(returnFocus) {
  $('view-drawer').classList.remove('open');
  $('view-drawer').setAttribute('aria-hidden', 'true');
  $('view-btn').setAttribute('aria-expanded', 'false');

  if (returnFocus) $('view-btn').focus();
}

/* Button toggles the dropdown */
$('view-btn').addEventListener('click', () => {
  if (menuIsOpen()) {
    closeMenu(false);
  } else {
    openMenu();
  }
});

/* Choosing an option applies the filter and closes the dropdown */
$('drawer-list').addEventListener('click', (event) => {
  const option = event.target.closest('[data-view]');

  if (!option) return;

  state.filter = option.dataset.view;

  render();
  closeMenu(true);
});

/* Click anywhere outside the dropdown closes it */
document.addEventListener('click', (event) => {
  if (!menuIsOpen()) return;

  if (event.target.closest('#view-menu')) return;

  closeMenu(false);
});

/* Keyboard: Esc closes, arrow keys move between options, Tab leaves */
document.addEventListener('keydown', (event) => {
  if (!menuIsOpen()) return;

  if (event.key === 'Escape') {
    closeMenu(true);
    return;
  }

  if (event.key === 'Tab') {
    closeMenu(false);
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const options = [...$('drawer-list').querySelectorAll('.opt')];

    if (!options.length) return;

    event.preventDefault();

    const index = options.indexOf(document.activeElement);

    const next = event.key === 'ArrowDown'
      ? options[(index + 1) % options.length]
      : options[(index - 1 + options.length) % options.length];

    next.focus();
  }
});

/* =========================================================
   LOAD CALENDAR
========================================================= */

async function load() {
  const note = $('cal-note');

  note.hidden = false;
  note.textContent = 'Loading shifts…';

  try {
    state.circleList = await loadCalendarCircles();
    state.circles = state.circleList.map((circle) => circle.name);
    state.colors.clear();

    $('create-shift').hidden = !state.circleList.some((circle) => circle.owned);

    state.shifts = await loadShifts(
      weekDates(state.weekStart)
    );

    state.shifts.forEach((shift) => {
      calendarColorFor(shift.circle);
    });

    render();

  } catch (error) {
    console.error(
      'Kalin calendar load failed:',
      error
    );

    $('week-grid').innerHTML = '';

    note.hidden = false;

    note.textContent =
      error.friendly ||
      'We could not load the calendar. Please refresh and try again.';
  }
}

/* =========================================================
   WEEK NAVIGATION
========================================================= */

/* Previous week */
$('prev-week').addEventListener('click', () => {
  state.weekStart = addDays(
    state.weekStart,
    -7
  );

  load();
});

/* Next week */
$('next-week').addEventListener('click', () => {
  state.weekStart = addDays(
    state.weekStart,
    7
  );

  load();
});

/* Calendar icon: return to current week */
const thisWeekButton = $('this-week');

if (thisWeekButton) {
  thisWeekButton.addEventListener('click', () => {
    state.weekStart = startOfWeek(parseYmd(KalinTime.manilaToday()));

    load();
  });
}

/* =========================================================
   SHIFT EVENTS
========================================================= */

$('week-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');

  if (!button || button.disabled) return;

  const action = button.dataset.action;

  if (action === 'delete') {
    deleteShift(button.dataset.id);
    return;
  }

  setShift(button.dataset.id, action === 'volunteer');
});

KalinTime.onMinute(() => {
  const now = KalinTime.now();
  const shifts = new Map(state.shifts.map(shift => [shift.id, shift]));
  for (const button of $('week-grid').querySelectorAll('.shift-btn')) {
    const shift = shifts.get(button.dataset.id);
    if (!shift) continue;
    if (button.dataset.action === 'volunteer' && !isOpen(shift, now)) {
      render();
      return;
    }
    updateShiftButton(button, shift, now);
  }
});

/* =========================================================
   CREATE SHIFT (circle owners only)
========================================================= */

const shiftDialog = $('shift-dialog');
const shiftForm = $('shift-form');
const MAX_SHIFT_ROWS = 200;

function parseYmd(value) {
  return new Date(value + 'T00:00:00Z');
}

function shiftDatesFor(startValue, repeat, weeks) {
  const start = parseYmd(startValue);

  if (repeat === 'daily') {
    return Array.from({ length: weeks * 7 }, (_, i) => ymd(addDays(start, i)));
  }
  if (repeat === 'weekly') {
    return Array.from({ length: weeks }, (_, i) => ymd(addDays(start, i * 7)));
  }
  return [ymd(start)];
}

function openShiftDialog() {
  const owned = state.circleList.filter((circle) => circle.owned);
  if (!owned.length) return;

  shiftForm.reset();
  $('shift-error').textContent = '';

  const select = $('shift-circle');
  select.replaceChildren();
  owned.forEach((circle) => {
    const option = document.createElement('option');
    option.value = circle.id;
    option.textContent = circle.name;
    select.appendChild(option);
  });

  /* Preselect the circle currently being viewed, if the person owns it */
  if (state.filter.startsWith('c:')) {
    const viewed = owned.find((circle) => 'c:' + circle.name === state.filter);
    if (viewed) select.value = viewed.id;
  }

  const today = KalinTime.manilaToday();
  $('shift-date').min = today;
  $('shift-date').value = today;
  $('shift-weeks-row').hidden = true;

  shiftDialog.showModal();
}

$('create-shift').addEventListener('click', openShiftDialog);
$('shift-close').addEventListener('click', () => shiftDialog.close());
$('shift-cancel').addEventListener('click', () => shiftDialog.close());
shiftDialog.addEventListener('click', (event) => {
  if (event.target === shiftDialog) shiftDialog.close();
});

$('shift-repeat').addEventListener('change', () => {
  $('shift-weeks-row').hidden = $('shift-repeat').value === 'none';
});

shiftForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const error = $('shift-error');
  error.textContent = '';

  const circleId = $('shift-circle').value;
  const dateValue = $('shift-date').value;
  const slotValue = $('shift-slot').value;
  const repeat = $('shift-repeat').value;
  const weeks = Math.min(12, Math.max(1, parseInt($('shift-weeks').value, 10) || 1));

  if (!circleId) { error.textContent = 'Choose a circle.'; return; }
  if (!dateValue) { error.textContent = 'Choose a date.'; return; }
  const today = KalinTime.manilaToday();
  $('shift-date').min = today;
  if (dateValue < today) { error.textContent = 'Pick today or a later date.'; return; }

  const slots = slotValue === 'both' ? ['morning', 'evening'] : [slotValue];
  const rows = [];

  shiftDatesFor(dateValue, repeat, weeks).forEach((date) => {
    slots.forEach((slot) => {
      rows.push({ circle_id: circleId, shift_date: date, slot });
    });
  });

  if (rows.length > MAX_SHIFT_ROWS) {
    error.textContent = 'That is too many shifts at once (maximum ' + MAX_SHIFT_ROWS + '). Try fewer weeks.';
    return;
  }

  const save = $('shift-save');
  save.disabled = true;
  save.textContent = 'Creating…';

  /* Shifts that already exist are skipped, not duplicated or overwritten */
  const { data, error: insertError } = await client
    .from('shifts')
    .upsert(rows, { onConflict: 'circle_id,shift_date,slot', ignoreDuplicates: true })
    .select('id');

  save.disabled = false;
  save.textContent = 'Create shift';

  if (insertError) {
    console.error('Could not create shifts:', insertError);
    error.textContent = calFriendlyError(insertError, 'Could not create the shifts. Please try again.');
    await load();
    return;
  }

  const created = data ? data.length : 0;
  const skipped = rows.length - created;

  shiftDialog.close();
  calSetStatus(
    (created === 1 ? '1 shift created.' : created + ' shifts created.') +
    (skipped > 0 ? ' ' + skipped + ' already existed.' : '')
  );

  /* Jump to the week of the first new shift */
  state.weekStart = startOfWeek(parseYmd(dateValue));
  await load();
});

/* =========================================================
   INITIALIZATION
========================================================= */

window.kalinReady.then((user) => {
  if (user) {
    const metadata = user.user_metadata || {};

    const fullName = metadata.full_name?.trim() || metadata.name?.trim() || 'Member';
    state.me = fullName.split(/\s+/)[0];
  }

  load();
});
