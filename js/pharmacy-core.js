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

  /* ---------- Manila dates and times ---------- */

  function todayISO(date) {
    return KalinTime.manilaToday(date);
  }

  function dayNumber(iso) {
    return Date.parse(iso + 'T00:00:00Z') / 86400000;
  }

  function weekday(iso) {
    return new Date(iso + 'T00:00:00Z').getUTCDay();
  }

  function formatDay(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });
  }

  function formatTime(time) { // '07:00:00' -> '7:00 AM'
    const [h, m] = time.split(':').map(Number);
    return (h % 12 || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function formatStamp(value) { // a timestamp -> 'Nov 21, 7:45 PM' in Manila
    return new Date(value).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: KalinTime.zone
    });
  }

  function formatClock(value) { // a timestamp -> '7:45 PM' in Manila
    return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: KalinTime.zone });
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

  /* Tasks: is this task due on that day? A one-off task is due on its date; a repeating one follows
     the same rules as a medication schedule (starts on due_date, optional end_date). */
  function taskDueOn(task, iso) {
    const frequency = task.frequency || 'once';
    if (!task.due_date) return false;
    if (frequency === 'once') return task.due_date === iso;
    if (iso < task.due_date) return false;
    if (task.end_date && iso > task.end_date) return false;
    if (frequency === 'daily') return true;
    if (frequency === 'weekly') return (task.days_of_week || []).includes(weekday(iso));
    if (frequency === 'interval') {
      return (dayNumber(iso) - dayNumber(task.due_date)) % task.interval_days === 0;
    }
    return false;
  }

  /* Repeating tasks are ticked off per time of day (rows in circle_task_completions); a one-off task
     uses is_done. doneKeys is a Set of taskSlotKey() values for the day being looked at. */
  const taskSlotKey = (taskId, iso, time) => taskId + '|' + iso + '|' + time.slice(0, 5);

  function taskSlots(task) {
    if ((task.frequency || 'once') === 'once') return [];
    return task.times?.length ? task.times.map(time => time.slice(0, 5)) : ['00:00'];
  }

  function taskProgress(task, iso, doneKeys) {
    if ((task.frequency || 'once') === 'once') return { done: task.is_done ? 1 : 0, total: 1 };
    const slots = taskSlots(task);
    return { done: slots.filter(time => doneKeys.has(taskSlotKey(task.id, iso, time))).length, total: slots.length };
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

  const ERROR_COPY = new Map([
    ['shift_started', 'This shift has already started.'],
    ['not_a_member', 'You’re no longer a member of this circle. Refresh the circle or return to Home.'],
    ['shift_taken', 'This shift is no longer available to change.'],
    ['shift_in_past', 'Pick today or a later date.'],
    ['schedule_inactive', 'This medication schedule has been stopped.'],
    ['item_inactive', 'This medicine is inactive or unavailable.'],
    ['invalid_dose_slot', 'This time is no longer part of the schedule.'],
    ['dose_slot_in_future', 'You can’t record a dose for a future date.'],
    ['invalid_stock_amount', 'Enter a valid stock amount with up to two decimal places.'],
    ['invalid_stock_threshold', 'Enter a valid threshold with up to two decimal places.'],
    ['stock_limit_exceeded', 'This change is outside the supported stock range.'],
    ['circle_creator_immutable', 'Circle ownership cannot be transferred.'],
    ['circle_owner_immutable', 'The owner membership cannot be changed.'],
    ['circle_owner_must_be_creator', 'Only the creator can own this circle.'],
    ['circle_creator_must_be_owner', 'The creator must remain the owner.'],
    ['circle_owner_cannot_leave', 'Owners must delete the circle to remove their ownership.'],
    ['Schedule not found', 'This medication schedule could not be found.'],
    ['As-needed doses don’t have a time slot', 'As-needed doses don’t have a time slot.'],
    ['Dose not found', 'This dose could not be found.'],
    ['This dose was already undone', 'This dose was already undone.'],
    ['You can only undo doses you recorded', 'You can only undo doses you recorded.'],
    ['The 15-minute undo window has passed. Ask the circle owner to undo it',
      'The 15-minute undo window has passed. Ask the circle owner to undo it.'],
    ['Medicine not found', 'This medicine could not be found.'],
    ['Only the circle owner can add medicines', 'Only the circle owner can add medicines.'],
    ['Only the circle owner can change stock', 'Only the circle owner can change stock.'],
    ['Add a short note explaining the correction', 'Add a short note explaining the correction.'],
    ['That medicine is already in the pharmacy', 'That medicine is already in the pharmacy.'],
    ['Circle name must be between 1 and 60 characters.', 'Circle name must be between 1 and 60 characters.'],
    ['Circle description must be 120 characters or fewer.', 'Circle description must be 120 characters or fewer.'],
    ['This request is no longer pending or you cannot review it.', 'This request is no longer pending or you cannot review it.']
  ]);

  function databaseMessage(error, fallback = 'Something went wrong. Please try again.') {
    return ERROR_COPY.get(error?.message) || fallback;
  }

  function friendly(error, fallback) {
    if (isMissing(error)) return SETUP_MESSAGE;
    if (error?.code === '42501') return 'You don’t have permission to do that.';
    if (/^You can’t remove more than the current stock \(-?\d+(?:\.\d+)?\)$/.test(error?.message)) {
      return 'You can’t remove more than the current stock.';
    }
    return databaseMessage(error, fallback);
  }

  function possessive(name) {
    return name + '’s care circle';
  }

  return {
    FORMS, UNITS, DAY_NAMES, UNDO_MINUTES, SETUP_MESSAGE,
    number, unitWord, quantity, medicineName, formLabel,
    todayISO, dayNumber, weekday, formatDay, formatTime, formatStamp, formatClock,
    minutesOf, sameTime, dueOn, taskDueOn, taskSlotKey, taskSlots, taskProgress, frequencyText,
    stockState, expiryState, chip, statusChips,
    isMissing, friendly, databaseMessage, possessive
  };
})();
