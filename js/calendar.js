
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

function colorFor(circle) {
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
  const color = colorFor(shift.circle);

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

  /* Weekly statistics */
  $('stat-mine').textContent =
    state.shifts.filter((s) => s.mine).length;

  $('stat-open').textContent =
    state.shifts.filter((s) => !s.person).length;

  /* Circle filters */
  const circles = [...state.colors.keys()];

  const chips = [
    { key: 'all', label: 'All circles' },
    { key: 'mine', label: 'My shifts only' },
    { key: 'open', label: 'Open shifts only' },

    ...circles.map((circle) => ({
      key: 'c:' + circle,
      label: circle
    }))
  ];

  $('chips').innerHTML = chips.map((chip) => `
    <button
      type="button"
      class="chip${state.filter === chip.key ? ' active' : ''}"
      data-filter="${esc(chip.key)}">
      ${esc(chip.label)}
    </button>
  `).join('');

  /* Legend */
  $('legend').innerHTML =
    circles.map((circle) => `
      <span style="--c:${colorFor(circle).c}">
        <i></i>${esc(circle)}
      </span>
    `).join('') +
    `<span style="--c:#f59e0b"><i></i>Open shift</span>`;

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
        <div class="wg-cell">
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
   LOAD CALENDAR
========================================================= */

async function load() {
  const note = $('cal-note');

  note.hidden = false;
  note.textContent = 'Loading shifts…';

  try {
    state.shifts = await loadShifts(
      weekDates(state.weekStart)
    );

    state.shifts.forEach((shift) => {
      colorFor(shift.circle);
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
   FILTER EVENTS
========================================================= */

$('chips').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');

  if (!button) return;

  state.filter = button.dataset.filter;

  render();
});

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
