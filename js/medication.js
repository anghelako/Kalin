/* Medication panel on the circle page: today's doses with Mark taken / Undo, as-needed medicines,
   and (owners) Add medication + the list of schedules.
   Loaded after dashboard.js and pharmacy-core.js, before circle.js, which calls
   window.KalinMedication.card(circle, isOwner). Wrapped in a function so it adds one global only. */
(function () {
  const Rx = KalinRx;

  let circleId = null;
  let owner = false;
  let state = 'loading'; // 'loading' | 'ready' | 'error'
  let errorText = '';
  let items = [];
  let schedules = [];
  let doses = [];
  let loadedDay = '';

  let panel = null;
  let statusEl = null;
  let bodyEl = null;

  const dialog = document.getElementById('med-dialog');
  const form = document.getElementById('med-form');

  /* ---------- Small helpers ---------- */

  function say(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'rx-status' + (isError ? ' is-error' : '');
  }

  function itemOf(id) {
    return items.find(item => item.id === id);
  }

  function canUndo(dose) {
    if (owner) return true;
    if (!currentUser || dose.taken_by !== currentUser.id) return false;
    return Date.now() - Date.parse(dose.taken_at) <= Rx.UNDO_MINUTES * 60000;
  }

  /* ---------- Loading ---------- */

  async function load(silent) {
    if (!silent) {
      state = 'loading';
      render();
    }

    const today = Rx.todayISO();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [itemsRes, schedulesRes, dosesRes] = await Promise.all([
      client
        .from('pharmacy_items')
        .select('id, name, strength, form, unit, stock, low_stock_threshold, expires_on, is_active')
        .eq('circle_id', circleId),
      client
        .from('medication_schedules')
        .select('id, item_id, dose_amount, frequency, days_of_week, interval_days, times, start_date, end_date, instructions, is_active')
        .eq('circle_id', circleId)
        .eq('is_active', true)
        .order('created_at', { ascending: true }),
      client
        .from('medication_doses')
        .select('id, schedule_id, item_id, amount, slot_date, slot_time, taken_by, taken_by_name, taken_at, flagged, stock_after')
        .eq('circle_id', circleId)
        .eq('status', 'taken')
        .or('slot_date.eq.' + today + ',taken_at.gte.' + startOfDay.toISOString())
        .order('taken_at', { ascending: true })
    ]);

    const failed = itemsRes.error || schedulesRes.error || dosesRes.error;
    if (failed) {
      console.error('Could not load medication:', failed);
      if (silent) return; // keep what's already on screen
      errorText = Rx.isMissing(failed)
        ? Rx.SETUP_MESSAGE
        : 'Couldn’t load medication. Try refreshing the page.';
      state = 'error';
      render();
      return;
    }

    items = itemsRes.data;
    schedules = schedulesRes.data;
    doses = dosesRes.data;
    loadedDay = today;
    state = 'ready';
    render();
  }

  /* ---------- Actions ---------- */

  async function markTaken(row, button) {
    button.disabled = true;
    say('');

    const { data, error } = await client.rpc('mark_dose_taken', {
      p_schedule: row.schedule.id,
      p_slot_date: row.date || null,
      p_slot_time: row.time || null
    });

    if (error) {
      console.error('Could not record dose:', error);
      say(Rx.friendly(error), true);
      button.disabled = false;
      return;
    }

    const name = Rx.medicineName(row.item);
    if (data.status === 'already_taken') {
      say(data.by + ' already recorded this dose.');
    } else if (data.flagged) {
      say('Recorded ' + name + '. Stock is at ' + Rx.quantity(data.stock_after, row.item.unit) +
        ', so please ask the circle owner to check the count.');
    } else {
      say('Recorded ' + name + '. ' + Rx.quantity(data.stock_after, row.item.unit) + ' left.');
    }
    await load(true);
  }

  async function undo(dose, button) {
    button.disabled = true;
    say('');

    const { data, error } = await client.rpc('undo_dose', { p_dose: dose.id });
    if (error) {
      console.error('Could not undo dose:', error);
      say(Rx.friendly(error), true);
      button.disabled = false;
      return;
    }

    const item = itemOf(dose.item_id);
    say('Dose undone.' + (item ? ' ' + Rx.quantity(data.stock_after, item.unit) + ' left.' : ''));
    await load(true);
  }

  async function stopSchedule(schedule, item) {
    const ok = window.confirm(
      'Stop giving ' + Rx.medicineName(item) + ' on this schedule? Past doses stay in the history.'
    );
    if (!ok) return;

    const { data, error } = await client
      .from('medication_schedules')
      .update({ is_active: false })
      .eq('id', schedule.id)
      .select('id');

    if (error || !data || !data.length) {
      console.error('Could not stop schedule:', error);
      say(error ? Rx.friendly(error) : 'Only the circle owner can stop a schedule.', true);
      return;
    }
    say('Schedule stopped.');
    await load(true);
  }

  /* ---------- Rendering ---------- */

  function buildRows(today) {
    const rows = [];
    schedules.forEach(schedule => {
      const item = itemOf(schedule.item_id);
      if (!item || schedule.frequency === 'as_needed' || !Rx.dueOn(schedule, today)) return;

      schedule.times.forEach(time => {
        const dose = doses.find(d =>
          d.schedule_id === schedule.id && d.slot_date === today && Rx.sameTime(d.slot_time, time)
        );
        rows.push({ schedule, item, time, date: today, dose });
      });
    });

    rows.sort((a, b) =>
      Rx.minutesOf(a.time) - Rx.minutesOf(b.time) || a.item.name.localeCompare(b.item.name)
    );
    return rows;
  }

  function stockChips(item) {
    const chips = [];
    const stock = Rx.stockState(item);
    if (stock === 'out') chips.push(Rx.chip('Out of stock', 'out'));
    else if (stock === 'low') chips.push(Rx.chip('Low · ' + Rx.quantity(item.stock, item.unit) + ' left', 'low'));
    if (Rx.expiryState(item) === 'expired') chips.push(Rx.chip('Expired', 'expired'));
    return chips;
  }

  function undoButton(dose) {
    const button = el('button', 'btn-ghost small', 'Undo');
    button.type = 'button';
    button.addEventListener('click', () => undo(dose, button));
    return button;
  }

  function doseRow(row, nowMinutes) {
    const { schedule, item, time, dose } = row;
    const box = el('div', 'rx-dose' + (dose ? ' is-taken' : ''));

    const info = el('div', 'rx-info');
    info.appendChild(el('p', 'rx-name', Rx.medicineName(item)));
    info.appendChild(el('p', 'rx-sub',
      Rx.quantity(schedule.dose_amount, item.unit) + (schedule.instructions ? ' · ' + schedule.instructions : '')
    ));

    const chips = el('div', 'rx-chips');
    const action = el('div', 'rx-action');

    if (dose) {
      chips.appendChild(Rx.chip('Taken', 'taken'));
      info.appendChild(el('p', 'rx-sub', dose.taken_by_name + ' · ' + Rx.formatClock(dose.taken_at)));
      if (dose.flagged) chips.appendChild(Rx.chip('No stock on record', 'flag'));
      if (canUndo(dose)) action.appendChild(undoButton(dose));
    } else if (!item.is_active) {
      chips.appendChild(Rx.chip('Medicine inactive', 'inactive'));
    } else {
      const slot = Rx.minutesOf(time);
      if (nowMinutes >= slot + 60) chips.appendChild(Rx.chip('Overdue', 'overdue'));
      else if (nowMinutes >= slot) chips.appendChild(Rx.chip('Due now', 'due'));
      stockChips(item).forEach(c => chips.appendChild(c));

      const button = el('button', 'btn-solid small', 'Mark taken');
      button.type = 'button';
      button.addEventListener('click', () => markTaken(row, button));
      action.appendChild(button);
    }

    if (chips.children.length) info.appendChild(chips);
    box.append(el('div', 'rx-time', Rx.formatTime(time)), info, action);
    return box;
  }

  function asNeededSection() {
    const list = schedules.filter(s => s.frequency === 'as_needed' && itemOf(s.item_id));
    if (!list.length) return null;

    const section = el('div', 'rx-group');
    section.appendChild(el('p', 'rx-group-title', 'As needed'));

    list.forEach(schedule => {
      const item = itemOf(schedule.item_id);
      const box = el('div', 'rx-dose rx-prn');

      const info = el('div', 'rx-info');
      info.appendChild(el('p', 'rx-name', Rx.medicineName(item)));
      info.appendChild(el('p', 'rx-sub',
        Rx.quantity(schedule.dose_amount, item.unit) + (schedule.instructions ? ' · ' + schedule.instructions : '')
      ));
      const chips = el('div', 'rx-chips');
      if (!item.is_active) chips.appendChild(Rx.chip('Medicine inactive', 'inactive'));
      else stockChips(item).forEach(c => chips.appendChild(c));
      if (chips.children.length) info.appendChild(chips);

      const action = el('div', 'rx-action');
      if (item.is_active) {
        const button = el('button', 'btn-solid small', 'Give now');
        button.type = 'button';
        button.addEventListener('click', () => markTaken({ schedule, item }, button));
        action.appendChild(button);
      }
      box.append(info, action);
      section.appendChild(box);

      // Doses already given today for this medicine
      doses.filter(d => d.schedule_id === schedule.id && d.slot_date === null).forEach(dose => {
        const given = el('div', 'rx-given');
        given.appendChild(el('span', '', dose.taken_by_name + ' gave ' + Rx.quantity(dose.amount, item.unit) +
          ' · ' + Rx.formatClock(dose.taken_at) + (dose.flagged ? ' · no stock on record' : '')));
        if (canUndo(dose)) given.appendChild(undoButton(dose));
        section.appendChild(given);
      });
    });
    return section;
  }

  function scheduleList() {
    const details = el('details', 'rx-schedules');
    details.appendChild(el('summary', '', 'Schedules (' + schedules.length + ')'));

    schedules.forEach(schedule => {
      const item = itemOf(schedule.item_id);
      if (!item) return;

      const row = el('div', 'rx-schedule');
      const text = el('div', 'rx-info');
      text.appendChild(el('p', 'rx-name', Rx.medicineName(item)));

      const when = schedule.frequency === 'as_needed'
        ? 'Only when needed'
        : schedule.times.map(Rx.formatTime).join(', ') + ' · ' + Rx.frequencyText(schedule);
      text.appendChild(el('p', 'rx-sub', Rx.quantity(schedule.dose_amount, item.unit) + ' · ' + when));
      if (!item.is_active) text.appendChild(el('div', 'rx-chips')).appendChild(Rx.chip('Paused: medicine inactive', 'inactive'));

      const stop = el('button', 'btn-ghost small', 'Stop');
      stop.type = 'button';
      stop.addEventListener('click', () => stopSchedule(schedule, item));
      row.append(text, stop);
      details.appendChild(row);
    });
    return details;
  }

  function render() {
    if (!bodyEl) return;
    bodyEl.replaceChildren();

    if (state === 'loading') {
      bodyEl.appendChild(el('p', 'rx-note', 'Loading…'));
      return;
    }
    if (state === 'error') {
      bodyEl.appendChild(el('p', 'rx-note is-error', errorText));
      return;
    }

    const now = new Date();
    const today = Rx.todayISO(now);
    if (loadedDay && loadedDay !== today) load(true); // a new day started: refresh

    const activeItems = items.filter(item => item.is_active);
    if (!items.length) {
      bodyEl.appendChild(el('p', 'empty', owner
        ? 'Add medicines to the Virtual Pharmacy first, then schedule them here.'
        : 'No medicines are in the pharmacy yet. The circle owner can add them.'));
      return;
    }
    if (!schedules.length) {
      bodyEl.appendChild(el('p', 'empty', owner
        ? 'Nothing is scheduled yet. Use “Add medication” to schedule a medicine from the pharmacy.'
        : 'Nothing is scheduled yet.'));
      return;
    }

    const rows = buildRows(today);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (rows.length) {
      const taken = rows.filter(row => row.dose).length;
      bodyEl.appendChild(el('p', 'rx-progress', taken + ' of ' + rows.length + ' scheduled doses taken today'));
      rows.forEach(row => bodyEl.appendChild(doseRow(row, nowMinutes)));
    } else if (!schedules.some(s => s.frequency === 'as_needed')) {
      bodyEl.appendChild(el('p', 'empty', 'No doses are due today.'));
    }

    const prn = asNeededSection();
    if (prn) bodyEl.appendChild(prn);
    if (owner && schedules.length) bodyEl.appendChild(scheduleList());
    if (owner && !activeItems.length) {
      bodyEl.appendChild(el('p', 'rx-note', 'All medicines are inactive. Reactivate one in the pharmacy to schedule it.'));
    }
  }

  /* ---------- Add medication dialog (owner) ---------- */

  const dayButtons = [];
  let selectedDays = new Set();

  function setDay(day, on) {
    if (on) selectedDays.add(day);
    else selectedDays.delete(day);
    dayButtons[day].setAttribute('aria-pressed', String(on));
  }

  function timeRow(value) {
    const row = el('div', 'rx-time-row');
    const input = document.createElement('input');
    input.type = 'time';
    input.className = 'rx-control';
    input.value = value || '08:00';
    input.setAttribute('aria-label', 'Time of day');

    const remove = el('button', 'btn-ghost small', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      row.remove();
      syncTimeButtons();
    });

    row.append(input, remove);
    return row;
  }

  function syncTimeButtons() {
    const rows = document.getElementById('med-times').children;
    Array.from(rows).forEach(row => {
      row.querySelector('button').hidden = rows.length === 1;
    });
    document.getElementById('med-add-time').hidden = rows.length >= 8;
  }

  function syncFrequency() {
    const frequency = document.getElementById('med-frequency').value;
    document.getElementById('med-days-field').hidden = frequency !== 'weekly';
    document.getElementById('med-interval-field').hidden = frequency !== 'interval';
    document.getElementById('med-times-field').hidden = frequency === 'as_needed';
  }

  function syncUnit() {
    const item = itemOf(document.getElementById('med-item').value);
    document.getElementById('med-unit').textContent = item ? item.unit : '';
  }

  function setDialogError(text) {
    document.getElementById('med-error').textContent = text;
  }

  function openDialog() {
    if (!dialog) return;
    form.reset();
    setDialogError('');

    const select = document.getElementById('med-item');
    select.replaceChildren();
    const active = items.filter(item => item.is_active);
    active.forEach(item => {
      const option = el('option', '', Rx.medicineName(item) + ' · ' + Rx.quantity(item.stock, item.unit) + ' left');
      option.value = item.id;
      select.appendChild(option);
    });

    document.getElementById('med-empty').hidden = active.length > 0;
    document.getElementById('med-pharmacy-link').href = 'pharmacy.html?id=' + encodeURIComponent(circleId);
    document.getElementById('med-save').disabled = active.length === 0;
    select.disabled = active.length === 0;

    document.getElementById('med-amount').value = '1';
    document.getElementById('med-frequency').value = 'daily';
    document.getElementById('med-start').value = Rx.todayISO();
    document.getElementById('med-times').replaceChildren(timeRow('08:00'));
    selectedDays = new Set();
    dayButtons.forEach((_, day) => setDay(day, false));

    syncFrequency();
    syncTimeButtons();
    syncUnit();
    dialog.showModal();
    (active.length ? document.getElementById('med-amount') : document.getElementById('med-cancel')).focus();
  }

  async function submitDialog(e) {
    e.preventDefault();
    setDialogError('');

    const itemId = document.getElementById('med-item').value;
    const amount = parseFloat(document.getElementById('med-amount').value);
    const frequency = document.getElementById('med-frequency').value;
    const start = document.getElementById('med-start').value;
    const end = document.getElementById('med-end').value;
    const instructions = document.getElementById('med-instructions').value.trim();
    const interval = parseInt(document.getElementById('med-interval').value, 10);

    if (!itemId) return setDialogError('Choose a medicine from the pharmacy.');
    if (!(amount > 0)) return setDialogError('Enter how much to give each time, like 1 or 0.5.');
    if (!start) return setDialogError('Pick a start date.');
    if (end && end < start) return setDialogError('The end date can’t be before the start date.');
    if (frequency === 'weekly' && !selectedDays.size) return setDialogError('Pick at least one day of the week.');
    if (frequency === 'interval' && !(interval >= 2 && interval <= 60)) {
      return setDialogError('Enter a number of days between 2 and 60.');
    }

    let times = [];
    if (frequency !== 'as_needed') {
      times = Array.from(document.querySelectorAll('#med-times input')).map(input => input.value);
      if (times.some(t => !t)) return setDialogError('Fill in every time, or remove the empty one.');
      times = Array.from(new Set(times)).sort();
    }

    const save = document.getElementById('med-save');
    save.disabled = true;
    save.textContent = 'Saving…';

    const { error } = await client.from('medication_schedules').insert({
      circle_id: circleId,
      item_id: itemId,
      dose_amount: amount,
      frequency,
      days_of_week: frequency === 'weekly' ? Array.from(selectedDays).sort() : [],
      interval_days: frequency === 'interval' ? interval : null,
      times,
      start_date: start,
      end_date: end || null,
      instructions: instructions || null
    });

    save.disabled = false;
    save.textContent = 'Add medication';

    if (error) {
      console.error('Could not add medication:', error);
      return setDialogError(Rx.friendly(error));
    }

    dialog.close();
    say('Medication added. It won’t change stock until a dose is marked taken.');
    await load(true);
  }

  function setupDialog() {
    if (!dialog || !form) return;

    const daysBox = document.getElementById('med-days');
    Rx.DAY_NAMES.forEach((name, day) => {
      const button = el('button', 'rx-day', name);
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => setDay(day, !selectedDays.has(day)));
      dayButtons.push(button);
      daysBox.appendChild(button);
    });

    document.getElementById('med-item').addEventListener('change', syncUnit);
    document.getElementById('med-frequency').addEventListener('change', syncFrequency);
    document.getElementById('med-add-time').addEventListener('click', () => {
      document.getElementById('med-times').appendChild(timeRow(''));
      syncTimeButtons();
    });

    form.addEventListener('submit', submitDialog);
    document.getElementById('med-close').addEventListener('click', () => dialog.close());
    document.getElementById('med-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => {
      if (e.target === dialog) dialog.close();
    });
  }

  /* ---------- The card circle.js puts on the page ---------- */

  function card(circle, isOwner) {
    circleId = circle.id;
    owner = !!isOwner;
    state = 'loading';

    panel = el('section', 'panel slot slot-meds');

    const head = el('header', 'panel-head');
    const text = el('div');
    text.append(el('h2', '', 'Today’s medication'));

    const actions = el('div', 'rx-head-actions');
    const pharmacy = el('a', 'btn-ghost small link-btn', 'Pharmacy');
    pharmacy.href = 'pharmacy.html?id=' + encodeURIComponent(circleId);
    actions.appendChild(pharmacy);

    if (owner) {
      const add = el('button', 'btn-solid small', 'Add medication');
      add.type = 'button';
      add.addEventListener('click', () => {
        if (state === 'ready') openDialog();
      });
      actions.appendChild(add);
    }
    head.append(text, actions);

    statusEl = el('p', 'rx-status');
    statusEl.setAttribute('role', 'status');
    bodyEl = el('div', 'rx-doses');
    panel.append(head, statusEl, bodyEl);

    render();
    load(false);
    return panel;
  }

  // Keep "Due now / Overdue" current, and pick up other people's changes
  setInterval(() => {
    if (state === 'ready' && document.body.contains(bodyEl)) render();
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state === 'ready' && circleId) load(true);
  });

  setupDialog();
  window.KalinMedication = { card };
})();