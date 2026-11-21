/* Shared helpers for the Virtual Pharmacy (pharmacy.html) and the Medication panel (circle.html).
   Everything lives on one global, KalinRx, so nothing collides with dashboard.js, calendar.js or circle.js.
   Needs from dashboard.js: el(), isMissingTable(). */
const KalinRx = (() => {
  const FORMS = [
    { value: 'tablet', label: 'Tablet', unit: 'tablets' },
    { value: 'capsule', label: 'Capsule', unit: 'capsules' },
    { value: 'liquid', label: 'Liquid', unit: 'mL' },
    { value: 'drops', label: 'Drops', unit: 'drops' },
    { value: 'patch', label: 'Patch', unit: 'patches' },
    { value: 'injection', label: 'Injection', unit: 'doses' },
    { value: 'inhaler', label: 'Inhaler', unit: 'puffs' },
    { value: 'cream', label: 'Cream / ointment', unit: 'g' },
    { value: 'other', label: 'Other', unit: 'units' }
  ];
  const UNITS = ['tablets', 'capsules', 'mL', 'drops', 'patches', 'doses', 'puffs', 'g', 'units'];
  const SINGULAR = {
    tablets: 'tablet', capsules: 'capsule', patches: 'patch',
    doses: 'dose', puffs: 'puff', units: 'unit', drops: 'drop'
  };
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const UNDO_MINUTES = 15; // keep in sync with undo_dose() in supabase/pharmacy_setup.sql

  const pad = n => String(n).padStart(2, '0');

  /* ---------- Numbers and names ---------- */

  function number(value) {
    const n = Number(value);
    return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
  }

  // "tablet" for exactly 1, otherwise "tablets" (mL and g never change)
  function unitWord(value, unit) {
    return Number(value) === 1 ? (SINGULAR[unit] || unit) : unit;
  }

  // "1 tablet", "0.5 tablets", "29 tablets", "5 mL"
  function quantity(value, unit) {
    return number(value) + ' ' + unitWord(value, unit);
  }

  // "Biogesic 500 mg"
  function medicineName(item) {
    return item.strength ? item.name + ' ' + item.strength : item.name;
  }

  function formLabel(value) {
    const found = FORMS.find(f => f.value === value);
    return found ? found.label : 'Other';
  }

  /* ---------- Dates and times (all wall-clock, in the viewer's own time zone) ---------- */

  function todayISO(date = new Date()) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function dayNumber(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  function weekday(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function formatDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });
  }

  function formatTime(time) { // '07:00:00' -> '7:00 AM'
    const [h, m] = time.split(':').map(Number);
    return (h % 12 || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function formatStamp(value) { // a timestamp -> 'Nov 21, 7:45 PM' (local)
    return new Date(value).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function formatClock(value) { // a timestamp -> '7:45 PM' (local)
    return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function minutesOf(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  function sameTime(a, b) {
    return a.slice(0, 5) === b.slice(0, 5);
  }

  /* Is this schedule due on that day? (as-needed schedules are never "due") */
  function dueOn(schedule, iso) {
    if (!schedule.is_active || schedule.frequency === 'as_needed') return false;
    if (iso < schedule.start_date) return false;
    if (schedule.end_date && iso > schedule.end_date) return false;
    if (schedule.frequency === 'daily') return true;
    if (schedule.frequency === 'weekly') return schedule.days_of_week.includes(weekday(iso));
    if (schedule.frequency === 'interval') {
      return (dayNumber(iso) - dayNumber(schedule.start_date)) % schedule.interval_days === 0;
    }
    return false;
  }

  function frequencyText(schedule) {
    if (schedule.frequency === 'daily') return 'Every day';
    if (schedule.frequency === 'weekly') {
      return schedule.days_of_week.slice().sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(', ');
    }
    if (schedule.frequency === 'interval') return 'Every ' + schedule.interval_days + ' days';
    return 'Only when needed';
  }

  /* ---------- Stock status ---------- */

  function stockState(item) {
    const stock = Number(item.stock);
    const low = Number(item.low_stock_threshold);
    if (stock <= 0) return 'out';
    if (low > 0 && stock <= low) return 'low';
    return 'ok';
  }

  function expiryState(item, iso = todayISO()) {
    if (!item.expires_on) return null;
    if (item.expires_on < iso) return 'expired';
    return dayNumber(item.expires_on) - dayNumber(iso) <= 30 ? 'soon' : null;
  }

  /* ---------- Small UI pieces ---------- */

  function chip(text, kind) {
    return el('span', 'rx-chip rx-chip-' + kind, text);
  }

  function statusChips(item) {
    const chips = [];
    if (!item.is_active) chips.push(chip('Inactive', 'inactive'));

    const stock = stockState(item);
    if (stock === 'out') chips.push(chip('Out of stock', 'out'));
    else if (stock === 'low') chips.push(chip('Low stock', 'low'));
    else chips.push(chip('In stock', 'ok'));

    const expiry = expiryState(item);
    if (expiry === 'expired') chips.push(chip('Expired', 'expired'));
    else if (expiry === 'soon') chips.push(chip('Expires soon', 'soon'));
    return chips;
  }

  /* ---------- Errors ---------- */

  function isMissing(error) {
    return !!error && (isMissingTable(error) || error.code === 'PGRST202');
  }

  const SETUP_MESSAGE = 'The pharmacy isn’t set up in Supabase yet. Run supabase/pharmacy_setup.sql first.';

  function friendly(error, fallback) {
    if (!error) return fallback || 'Something went wrong. Try again.';
    if (isMissing(error)) return SETUP_MESSAGE;
    const text = error.message || '';
    if (text.includes('row-level security')) return 'Only the circle owner can do that.';
    if (text.includes('permission denied')) return 'You don’t have permission to do that.';
    return text || fallback || 'Something went wrong. Try again.';
  }

  function possessive(name) {
    return name + '’s care circle';
  }

  return {
    FORMS, UNITS, DAY_NAMES, UNDO_MINUTES, SETUP_MESSAGE,
    number, unitWord, quantity, medicineName, formLabel,
    todayISO, dayNumber, weekday, formatDay, formatTime, formatStamp, formatClock,
    minutesOf, sameTime, dueOn, frequencyText,
    stockState, expiryState, chip, statusChips,
    isMissing, friendly, possessive
  };
})();
