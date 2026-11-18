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
  { c: '#0d9488', bg: '#f0fdfa', line: '#99f6e4' },
  { c: '#4f46e5', bg: '#eef2ff', line: '#c7d2fe' },
  { c: '#e11d48', bg: '#fff1f2', line: '#fecdd3' },
  { c: '#0284c7', bg: '#f0f9ff', line: '#bae6fd' },
  { c: '#7c3aed', bg: '#f5f3ff', line: '#ddd6fe' }
];

/* Calendar state */
const state = {
  weekStart: startOfWeek(new Date()),
  filter: 'all',
  circles: [],
  shifts: [],
  me: 'You',
  colors: new Map()
};

/* Helpers */
const $ = (id) => document.getElementById(id);

const fmt = (d, options) =>
  d.toLocaleDateString('en-US', options);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

/* =========================================================
   DATE FUNCTIONS
========================================================= */

function startOfWeek(date) {
  const d = new Date(date);

  d.setHours(0, 0, 0, 0);

  d.setDate(
    d.getDate() - ((d.getDay() + 6) % 7)
  );

  return d;
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function ymd(date) {
  return (
    date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
  );
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

async function loadShifts(dates) {
  /*
    Connect your actual Supabase shifts table here.

    Expected shift structure:

    {
      id: "shift-id",
      date: "2026-11-18",
      slot: "morning",
      circle: "Circle name",
      person: "Volunteer name",
      mine: false
    }

    Until the real database query is configured,
    the calendar remains empty.
  */

  return [];
}

async function loadCalendarCircles() {
  /*
    Connect this to the circles the signed-in user belongs to.

    Expected structure:

    [
      { id: "circle-id", name: "Patient 1" },
      { id: "circle-id", name: "Patient 2" }
    ]

    Every circle returned here appears in the "Viewing" dropdown,
    even if it has no shifts this week.
  */

  return [];
}

/* Volunteer / release action */
async function setShift(id, take) {
  /*
    Connect this function to your actual
    Supabase volunteer and release operations.
  */

  console.warn(
    'Volunteer/release database action is not configured.',
    { id, take }
  );
}

/* =========================================================
   CIRCLE COLORS
========================================================= */

function calendarColorFor(circle) {
  if (!state.colors.has(circle)) {
    state.colors.set(
      circle,
      PALETTE[
        state.colors.size % PALETTE.length
      ]
    );
  }

  return state.colors.get(circle);
}

/* =========================================================
   FILTERS
========================================================= */

function visible(shift) {
  const filter = state.filter;

  if (filter === 'all') return true;

  if (filter === 'mine') return shift.mine;

  if (filter === 'open') return !shift.person;

  return filter === 'c:' + shift.circle;
}

/* =========================================================
   SHIFT CARDS
========================================================= */

function cardHtml(shift) {
  const color = calendarColorFor(shift.circle);

  const style =
    `--c:${color.c};` +
    `--c-bg:${color.bg};` +
    `--c-line:${color.line}`;

  const tag =
    `<span class="sh-tag">${esc(shift.circle)}</span>`;

  if (!shift.person) {
    return `
      <article class="shift open" style="${style}">
        <div class="shift-top">${tag}</div>
        <div class="sh-who">Open slot</div>
        <button
          type="button"
          class="shift-btn volunteer"
          data-action="volunteer"
          data-id="${esc(shift.id)}">
          Volunteer
        </button>
      </article>
    `;
  }

  if (shift.mine) {
    return `
      <article class="shift" style="${style}">
        <div class="shift-top">
          ${tag}
          <span class="sh-you">YOU</span>
        </div>

        <div class="sh-who">
          You (${esc(state.me)})
        </div>

        <button
          type="button"
          class="shift-btn"
          data-action="release"
          data-id="${esc(shift.id)}">
          Release
        </button>
      </article>
    `;
  }

  return `
    <article class="shift" style="${style}">
      <div class="shift-top">${tag}</div>
      <div class="sh-who">${esc(shift.person)}</div>
      <div class="sh-status">Covered</div>
    </article>
  `;
}

/* =========================================================
   CALENDAR RENDERING
========================================================= */

function render() {
  const dates = weekDates(state.weekStart);

  const todayKey = ymd(new Date());

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
  renderView();

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
          shift.date === ymd(date) &&
          shift.slot === slot.key &&
          visible(shift)
        )
        .sort((a, b) =>
          a.circle.localeCompare(b.circle)
        );

      shown += cards.length;

      html += `
        <div class="wg-cell${ymd(date) === todayKey ? ' today' : ''}">
          ${cards.map(cardHtml).join('')}
        </div>
      `;
    }

    html += '</div>';
  }

  $('week-grid').innerHTML = html;

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

function optionHtml(key, label, count, color) {
  const selected = state.filter === key;

  return `
    <button
      type="button"
      class="opt"
      role="radio"
      aria-checked="${selected}"
      data-view="${esc(key)}"
      style="--c:${color}">
      <span class="opt-dot"></span>
      <span class="opt-name">${esc(label)}</span>
      <span class="opt-count">${count}</span>
      ${VIEW_ICON_CHECK}
    </button>
  `;
}

function renderView() {
  const names = circleNames();

  const countFor = (name) =>
    state.shifts.filter((shift) => shift.circle === name).length;

  /* Button label */
  $('view-label').textContent = viewLabel();

  /* Circle options */
  const circleOptions = names.length
    ? names.map((name) =>
        optionHtml('c:' + name, name, countFor(name), calendarColorFor(name).c)
      ).join('')
    : `<p class="drawer-empty">
         You haven't joined any circles yet.
         Circles you join will show up here.
       </p>`;

  $('drawer-list').innerHTML = `
    <section class="drawer-group">
      <h3>Circles</h3>
      <div class="drawer-list" role="radiogroup" aria-label="Circles">
        ${optionHtml('all', 'All circles', state.shifts.length, '#081224')}
        ${circleOptions}
      </div>
    </section>

    <section class="drawer-group">
      <h3>Quick views</h3>
      <div class="drawer-list" role="radiogroup" aria-label="Quick views">
        ${optionHtml('mine', 'My shifts only', state.shifts.filter((s) => s.mine).length, '#0d9488')}
        ${optionHtml('open', 'Open shifts only', state.shifts.filter((s) => !s.person).length, '#f59e0b')}
      </div>
    </section>
  `;
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
    state.circles = (await loadCalendarCircles()).map((circle) => circle.name);

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
    state.weekStart = startOfWeek(new Date());

    load();
  });
}

/* =========================================================
   SHIFT EVENTS
========================================================= */

$('week-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');

  if (!button) return;

  setShift(
    button.dataset.id,
    button.dataset.action === 'volunteer'
  );
});

/* =========================================================
   INITIALIZATION
========================================================= */

window.kalinReady.then((user) => {
  if (user) {
    const metadata = user.user_metadata || {};

    const fullName = (
      metadata.full_name ||
      metadata.name ||
      (user.email || '').split('@')[0] ||
      ''
    ).trim();

    state.me = fullName.split(/\s+/)[0] || 'You';
  }

  load();
});