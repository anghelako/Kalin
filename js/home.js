/* Care alerts and Home dashboard. The shared bootstrap owns the session and circle mutations. */
(function () {
  const Rx = KalinRx;
  const Time = KalinTime;
  const byId = id => document.getElementById(id);
  const dayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: Time.zone
  });

  function makeButton(label, className = 'btn-ghost small') {
    const button = el('button', className, label);
    button.type = 'button';
    return button;
  }

  function icon(pathData) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function circleLink(circle, label, classes) {
    const link = el('a', classes, label);
    link.href = 'circle.html?id=' + encodeURIComponent(circle.id);
    link.setAttribute('aria-label', 'Open ' + circle.name);
    return link;
  }

  function chevron(circle) {
    const link = circleLink(circle, '', 'home-next');
    link.appendChild(icon('m9 6 6 6-6 6'));
    return link;
  }

  function dot(circle) {
    const node = el('span', 'home-dot');
    node.style.backgroundColor = colorFor(circle);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function chip(label, kind, symbol) {
    const node = el('span', 'home-chip home-chip-' + kind);
    const glyph = el('span', '', symbol);
    glyph.setAttribute('aria-hidden', 'true');
    node.append(glyph, label);
    return node;
  }

  function rowText(label, description) {
    const text = el('div', 'home-row-text');
    text.appendChild(el('p', '', label));
    if (description) text.appendChild(el('p', 'home-row-meta', description));
    return text;
  }

  function empty(label) {
    return el('p', 'home-empty', label);
  }

  function failed(label, retry) {
    const row = el('div', 'home-failure');
    const button = makeButton('Retry');
    button.addEventListener('click', retry);
    row.append(empty(label), button);
    return row;
  }

  const shiftStart = Time.shiftStart;

  function orderedShifts(rows) {
    return rows.filter(row => row.starts_at && row.ends_at).slice().sort((a, b) => shiftStart(a) - shiftStart(b));
  }

  function createSnapshot(user, previous) {
    const now = Time.now();
    const today = Time.manilaToday(now);
    const weekEnd = Time.addDays(today, 6);
    // Shifts start and end at any minute, so the shift cards are re-rendered every minute (from cached rows).
    const shiftWindow = today + '|' + Time.manilaNow(now).time.slice(0, 5);
    const membership = previous?.membership ?? new Map(circles.map(circle => [circle.id, circle]));
    const ids = [...membership.keys()];
    const owners = [...membership.values()].filter(circle => circle.role === 'owner').map(circle => circle.id);
    const cache = previous?.cache ?? new Map();

    function query(key, table, columns, refine, { limit, circleIds = ids, scope } = {}) {
      const cached = cache.get(key);
      if (cached && cached.scope === scope) return cached.promise;
      const promise = (async () => {
        if (!circleIds.length) return [];
        const results = [];
        const pageSize = 200;
        for (let start = 0; ; start += pageSize) {
          const base = refine(client.from(table).select(columns).in('circle_id', circleIds)).order('id');
          const { data, error } = await (limit ? base.limit(limit) : base.range(start, start + pageSize - 1));
          if (error) throw error;
          results.push(...data);
          if (limit || data.length < pageSize) return results;
        }
      })().catch(error => {
        if (cache.get(key)?.promise === promise) cache.delete(key);
        throw error;
      });
      cache.set(key, { promise, scope });
      return promise;
    }

    return {
      user, now, today, shiftWindow, cache, membership, pending: previous?.pending ?? myRequests.slice(),
      items: () => query('items', 'pharmacy_items',
        'id,circle_id,name,stock,low_stock_threshold,expires_on,is_active', row => row),
      schedules: () => query('schedules', 'medication_schedules',
        'id,circle_id,item_id,frequency,days_of_week,interval_days,times,start_date,end_date,is_active',
        row => row.eq('is_active', true)),
      doses: () => query('doses', 'medication_doses', 'id,circle_id,schedule_id,slot_date,slot_time',
        row => row.eq('status', 'taken').eq('slot_date', today), { scope: today }),
      tasks: () => query('tasks', 'circle_tasks', 'id,circle_id,title,due_date,is_done,frequency,days_of_week,interval_days,times,end_date',
        row => row.lte('due_date', today), { scope: today }),
      taskSlots: () => query('taskSlots', 'circle_task_completions', 'id,circle_id,task_id,slot_time',
        row => row.eq('slot_date', today), { scope: today }),
      shifts: () => query('shifts', 'shifts', 'id,circle_id,shift_date,starts_at,ends_at,assigned_to,assigned_name,profiles:assigned_to(full_name)',
        // from yesterday, so a night shift that is still running shows as on duty
        row => row.gte('shift_date', Time.addDays(today, -1)).lte('shift_date', weekEnd), { scope: today }),
      // Started shifts are filtered out when rendering, so ask for a few extra rows.
      nextShifts: () => query('nextShifts', 'shifts', 'id,circle_id,shift_date,starts_at,ends_at,assigned_to,assigned_name',
        row => row.eq('assigned_to', user.id).gte('shift_date', today).order('shift_date').order('starts_at'),
        { limit: 12, scope: today }),
      requests: () => query('requests', 'circle_join_requests',
        'id,circle_id,user_id,circle_name,requester_name,requester_email,created_at',
        row => row.eq('status', 'pending').neq('user_id', user.id).order('created_at'), { circleIds: owners }),
      activity: {
        notes: () => query('notes', 'care_notes', 'id,circle_id,created_at',
          row => row.order('created_at', { ascending: false }), { limit: 10 }),
        doses: () => query('doseActivity', 'medication_doses', 'id,circle_id,taken_by_name,taken_at',
          row => row.eq('status', 'taken').order('taken_at', { ascending: false }), { limit: 10 }),
        tasks: () => query('taskActivity', 'circle_tasks', 'id,circle_id,created_at',
          row => row.order('created_at', { ascending: false }), { limit: 10 })
      }
    };
  }

  async function medication(data) {
    const [items, schedules, taken] = await Promise.all([data.items(), data.schedules(), data.doses()]);
    const byItem = new Map(items.map(item => [item.id, item]));
    const timeKey = (scheduleId, time) => scheduleId + '|' + time.slice(0, 5);
    const takenSlots = new Set(taken.filter(dose => dose.slot_time).map(dose => timeKey(dose.schedule_id, dose.slot_time)));
    const doses = schedules.flatMap(schedule => {
      const item = byItem.get(schedule.item_id);
      if (!item || !Rx.dueOn(schedule, data.today)) return [];
      return schedule.times.map(time => ({
        circleId: schedule.circle_id,
        item,
        time,
        taken: takenSlots.has(timeKey(schedule.id, time))
      }));
    }).sort((a, b) => Rx.minutesOf(a.time) - Rx.minutesOf(b.time) || a.item.name.localeCompare(b.item.name));
    return { items, doses };
  }

  async function careFlags(data) {
    const [{ items, doses }, tasks, shifts] = await Promise.all([medication(data), data.tasks(), data.shifts()]);
    const nowMinutes = Time.manilaNow(data.now).minutes;
    const overdueDoses = [];
    const dueDoses = [];
    for (const dose of doses) {
      if (dose.taken || !dose.item.is_active) continue;
      const minutesPast = nowMinutes - Rx.minutesOf(dose.time);
      if (minutesPast >= 60) overdueDoses.push(dose);
      else if (minutesPast >= 0) dueDoses.push(dose);
    }
    const overdueTasks = tasks.filter(task => (task.frequency || 'once') === 'once' && !task.is_done && task.due_date && task.due_date < data.today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const stock = items.filter(item => item.is_active).flatMap(item => {
      const inventory = Rx.stockState(item);
      const expiry = Rx.expiryState(item, data.today);
      if (inventory === 'ok' && !expiry) return [];
      const label = inventory === 'out' ? 'Out of stock' : inventory === 'low' ? 'Low stock' :
        expiry === 'expired' ? 'Expired' : 'Expiring';
      return [{ item, label }];
    });
    const end = +data.now + 48 * 60 * 60 * 1000;
    const openShifts = orderedShifts(shifts).filter(shift => {
      return !shift.assigned_to && !Time.hasStarted(shift, data.now) && +shiftStart(shift) <= end;
    });
    return { overdueDoses, dueDoses, overdueTasks, stock, openShifts };
  }

  async function readAttention(data) {
    const [requests, care] = await Promise.allSettled([data.requests(), careFlags(data)]);
    const flags = care.status === 'fulfilled' ? care.value : {
      overdueDoses: [], dueDoses: [], overdueTasks: [], stock: [], openShifts: []
    };
    return {
      requests: requests.status === 'fulfilled' ? requests.value : [],
      flags,
      rows: attentionRows(flags),
      incomplete: requests.status === 'rejected' || care.status === 'rejected'
    };
  }

  function attentionRows(flags) {
    const entry = (circleId, label, status, kind, symbol, title, page = 'circle.html') =>
      ({ circleId, label, status, kind, symbol, title, page });
    return [
      ...flags.overdueDoses.map(({ circleId, item, time }) =>
        entry(circleId, item.name + ' · ' + Rx.formatTime(time), 'Overdue', 'overdue', '!', 'Overdue dose')),
      ...flags.dueDoses.map(({ circleId, item, time }) =>
        entry(circleId, item.name + ' · ' + Rx.formatTime(time), 'Due now', 'due', '◷', 'Dose due')),
      ...flags.overdueTasks.map(task =>
        entry(task.circle_id, task.title, 'Overdue', 'overdue', '!', 'Overdue task')),
      ...flags.stock.map(({ item, label }) =>
        entry(item.circle_id, item.name, label, 'due', '!', label, 'pharmacy.html')),
      ...flags.openShifts.map(shift =>
        entry(shift.circle_id, dayLabel.format(shiftStart(shift)) + ' · ' + Time.shiftRange(shift),
          'Open shift', 'open', '◇', 'Open shift'))
    ];
  }

  const bell = byId('notif');
  const notificationDot = bell.querySelector('.dot');
  const notificationPanel = byId('notification-panel');
  const notificationFeed = byId('notification-feed');
  let notificationLoad = 0;
  let notificationsPending = false;

  function notificationLink(href, title, detail) {
    const link = el('a', 'notification-link');
    link.href = href;
    link.append(el('strong', '', title), el('span', '', detail));
    return link;
  }

  function renderNotifications(data, { requests, rows, incomplete } = { requests: [], rows: [], incomplete: true }) {
    const links = [
      ...requests.map(request => notificationLink('dashboard.html#requests', 'Join request',
        request.requester_name + ' · ' + request.circle_name)),
      ...rows.map(({ circleId, label, title, page }) =>
        notificationLink(page + '?id=' + encodeURIComponent(circleId), title,
          label + ' · ' + data.membership.get(circleId).name))
    ];
    const count = links.length;
    notificationDot.hidden = !count;
    bell.setAttribute('aria-label', count ? 'Notifications (' + count + ' active)' : 'Notifications');
    notificationFeed.replaceChildren(...links);
    if (incomplete) {
      const retry = makeButton('Retry');
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          if (circlesState === 'ready') await refreshNotifications();
          else await loadCircles();
        } finally {
          retry.disabled = false;
        }
      });
      notificationFeed.append(el('p', 'notification-status',
        count ? 'Some notifications couldn’t load.' : 'Couldn’t load notifications.'), retry);
    } else if (!count) {
      notificationFeed.appendChild(el('p', 'notification-status', 'You’re all caught up.'));
    }
  }

  async function loadNotificationAttention(data) {
    const load = ++notificationLoad;
    notificationsPending = true;
    try {
      const result = await readAttention(data);
      if (notificationLoad === load) renderNotifications(data, result);
      return result;
    } catch (error) {
      if (notificationLoad === load) renderNotifications();
      throw error;
    } finally {
      if (notificationLoad === load) notificationsPending = false;
    }
  }

  function showNotificationError() {
    notificationLoad++;
    notificationsPending = false;
    renderNotifications();
  }

  async function refreshNotifications() {
    if (circlesState === 'error') showNotificationError();
    if (circlesState !== 'ready') return;
    try {
      await loadNotificationAttention(createSnapshot(currentUser));
    } catch (error) {
      console.error('Could not load notifications:', error);
    }
  }

  notificationFeed.addEventListener('click', event => {
    if (event.target.closest('a')) notificationPanel.hidePopover();
  });
  notificationPanel.addEventListener('toggle', event => {
    if (event.newState === 'open' && !notificationsPending) refreshNotifications();
  });

  if (!byId('home-attention-body')) {
    window.addEventListener('kalin:circles', refreshNotifications);
    window.kalinReady.then(user => {
      if (user && !notificationLoad) refreshNotifications();
    });
    return;
  }

  const activityDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: Time.zone });
  const media = matchMedia('(max-width: 680px)');
  const activityPanel = byId('home-activity-panel');
  const activityMore = byId('home-activity-more');
  const activityCollapse = byId('home-activity-collapse');
  const activityBody = byId('home-activity-body');
  let activityExpanded = false;
  let phoneActivityOpen = false;
  let activityRows = [];
  let snapshot;

  function attentionRow(circle, label, status, kind, symbol) {
    const row = el('div', 'home-attention-row');
    row.append(dot(circle), rowText(label, circle.name), chip(status, kind, symbol), chevron(circle));
    return row;
  }

  function joinRow(request, circle) {
    const row = requestRow(request);
    const avatar = row.querySelector('.req-avatar');
    avatar.classList.add('home-person-icon');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.replaceChildren(icon('M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM19 8v8m-4-4h8'));
    const tail = el('div', 'home-request-tail');
    tail.append(chip('Join request', 'neutral', '+'), chevron(circle));
    row.appendChild(tail);
    return row;
  }

  const attentionBody = byId('home-attention-body');
  const attentionCount = byId('home-attention-count');
  const requestsPanel = byId('requests');
  const requestList = byId('request-list');
  let renderedRequests;

  function renderAttention(data, requests, rows) {
    const total = requests.length + rows.length;
    attentionCount.textContent = String(total);
    attentionCount.hidden = false;
    if (renderedRequests !== requests) {
      renderedRequests = requests;
      requestsPanel.hidden = !requests.length;
      requestList.replaceChildren(...requests.slice(0, 5).map(request => joinRow(request, data.membership.get(request.circle_id))));
      if (requests.length && location.hash === '#requests') requestsPanel.scrollIntoView();
    }
    attentionBody.replaceChildren(...rows.slice(0, Math.max(0, 5 - requests.length))
      .map(({ circleId, label, status, kind, symbol }) =>
        attentionRow(data.membership.get(circleId), label, status, kind, symbol)));
    if (!total) attentionBody.appendChild(empty('All clear'));
  }

  function renderShifts(data, shifts) {
    const body = byId('home-shifts-body');
    body.replaceChildren(...orderedShifts(shifts).filter(shift => !Time.hasStarted(shift, data.now)).slice(0, 3).map(shift => {
      const circle = data.membership.get(shift.circle_id);
      const row = el('div', 'home-shift-row');
      row.append(dot(circle), rowText(dayLabel.format(shiftStart(shift)) + ' · ' + Time.shiftPeriod(shift),
        Time.shiftRange(shift) + ' · ' + circle.name));
      return row;
    }));
    if (!body.childElementCount) body.appendChild(empty('No upcoming shifts'));
  }

  function onDutyName(data, shift) {
    const name = shift.assigned_name?.trim() || shift.profiles?.full_name?.trim();
    if (shift.assigned_to !== data.user.id) return name || 'Member';
    const meta = data.user.user_metadata || {};
    return (name || meta.full_name?.trim() || meta.name?.trim() || 'Member') + ' (you)';
  }

  function renderCirclesCard(data, shifts) {
    const grid = byId('circle-grid');
    const duty = new Map(shifts.filter(shift => Time.isOnDuty(shift, data.now) && shift.assigned_to)
      .map(shift => [shift.circle_id, onDutyName(data, shift)]));
    const rows = [...data.membership.values()].slice(0, 3).map(circle => {
      const row = el('div', 'home-circle-row');
      row.append(dot(circle), rowText(circle.name, 'On duty: ' + (duty.get(circle.id) || 'No one assigned')),
        circleLink(circle, 'Open', 'btn-ghost small'));
      return row;
    });
    for (const request of data.pending) {
      const row = pendingCard(request);
      row.classList.add('home-circle-pending');
      rows.push(row);
    }
    grid.replaceChildren(...(rows.length ? rows : [empty('No circles yet')]));
  }

  function syncActivity() {
    activityPanel.hidden = media.matches && !phoneActivityOpen;
    activityCollapse.textContent = phoneActivityOpen ? 'Hide' : 'Show';
    activityCollapse.setAttribute('aria-expanded', String(phoneActivityOpen));
  }

  function activityList() {
    activityBody.replaceChildren(...activityRows.slice(0, activityExpanded ? 10 : 3).map(({ circle, text, stamp }) => {
      const row = el('div', 'home-activity-row');
      const label = el('span', 'home-row-text', text + ' · ' + circle.name);
      label.title = label.textContent;
      const time = el('time', 'home-row-meta', activityDate.format(new Date(stamp)));
      time.dateTime = stamp;
      row.append(dot(circle), label, time);
      return row;
    }));
    if (!activityRows.length) activityBody.appendChild(empty('No recent activity'));
    activityMore.hidden = activityRows.length <= 3;
    activityMore.textContent = activityExpanded ? 'Show less' : 'Show more';
    activityMore.setAttribute('aria-expanded', String(activityExpanded));
  }

  function renderActivity(data, [notes, doses, tasks]) {
    activityRows = [
      ...notes.map(note => [note.circle_id, 'Note added', note.created_at]),
      ...doses.map(dose => [dose.circle_id, dose.taken_by_name ? dose.taken_by_name + ' recorded a dose' : 'Dose taken', dose.taken_at]),
      ...tasks.map(task => [task.circle_id, 'Task added', task.created_at])
    ].map(([id, text, stamp]) => ({ circle: data.membership.get(id), text, stamp }))
      .sort((a, b) => Date.parse(b.stamp) - Date.parse(a.stamp)).slice(0, 10);
    activityList();
  }

  activityMore.addEventListener('click', () => {
    activityExpanded = !activityExpanded;
    activityList();
  });
  activityCollapse.addEventListener('click', () => {
    phoneActivityOpen = !phoneActivityOpen;
    syncActivity();
  });
  media.addEventListener('change', syncActivity);
  syncActivity();


  const progressFilter = byId('home-progress-filter');
  const progressButton = byId('home-progress-button');
  const progressOptions = byId('home-progress-options');
  const progressBody = byId('home-progress-body');
  let selectedCircle = '';

  function setProgressMenu(open) {
    progressOptions.hidden = !open;
    progressButton.setAttribute('aria-expanded', String(open));
  }

  progressButton.addEventListener('click', () => setProgressMenu(progressOptions.hidden));
  document.addEventListener('click', event => {
    if (!progressFilter.contains(event.target)) setProgressMenu(false);
  });
  progressFilter.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !progressOptions.hidden) {
      setProgressMenu(false);
      progressButton.focus();
    }
  });

  function ring(label, caption, count, total) {
    const ratio = total ? count / total : 0;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 80 80');
    svg.setAttribute('aria-hidden', 'true');
    for (const name of ['track', 'arc']) {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('class', 'home-ring-' + name);
      circle.setAttribute('cx', '40');
      circle.setAttribute('cy', '40');
      circle.setAttribute('r', '34');
      if (name === 'arc') {
        if (ratio === 0) continue;
        circle.setAttribute('pathLength', '1');
        circle.setAttribute('transform', 'rotate(-90 40 40)');
        circle.setAttribute('stroke-dasharray', ratio + ' ' + (1 - ratio));
      }
      svg.append(circle);
    }
    const result = el('div', 'home-ring');
    const dial = el('div', 'home-ring-dial');
    dial.append(svg, el('span', 'home-ring-number', count + '/' + total));
    result.append(el('h3', '', label), dial, el('p', 'home-row-meta', caption));
    return result;
  }

  function renderProgress(data, [{ doses }, tasks, shifts, slotRows]) {
    const doneKeys = new Set(slotRows.map(row => Rx.taskSlotKey(row.task_id, data.today, row.slot_time)));
    if (!data.membership.has(selectedCircle)) selectedCircle = '';
    const choices = [['', 'All circles'], ...[...data.membership.values()].map(circle => [circle.id, circle.name])];
    const matches = id => !selectedCircle || id === selectedCircle;

    function paintRings() {
      const selectedDoses = doses.filter(dose => matches(dose.circleId));
      const selectedTasks = tasks.filter(task => matches(task.circle_id) && Rx.taskDueOn(task, data.today));
      const taskTotals = selectedTasks.reduce((sum, task) => {
        const progress = Rx.taskProgress(task, data.today, doneKeys);
        return { done: sum.done + progress.done, total: sum.total + progress.total };
      }, { done: 0, total: 0 });
      const selectedShifts = shifts.filter(shift => matches(shift.circle_id) && shift.shift_date >= data.today);
      const rings = el('div', 'home-rings');
      rings.append(
        ring('Doses', 'taken', selectedDoses.filter(dose => dose.taken).length, selectedDoses.length),
        ring('Tasks', 'done', taskTotals.done, taskTotals.total),
        ring('Shifts', 'covered', selectedShifts.filter(shift => shift.assigned_to).length, selectedShifts.length)
      );
      progressBody.replaceChildren(rings);
    }

    const options = choices.map(([id, label]) => {
      const choice = makeButton('', 'home-filter-choice');
      if (id) choice.appendChild(dot(data.membership.get(id)));
      choice.appendChild(el('span', '', label));
      choice.setAttribute('aria-pressed', String(selectedCircle === id));
      choice.addEventListener('click', () => {
        selectedCircle = id;
        for (const option of progressOptions.children) {
          option.setAttribute('aria-pressed', String(option === choice));
        }
        byId('home-progress-label').textContent = label;
        setProgressMenu(false);
        progressButton.focus();
        paintRings();
      });
      return choice;
    });
    byId('home-progress-label').textContent = data.membership.get(selectedCircle)?.name || 'All circles';
    progressOptions.replaceChildren(...options);
    progressFilter.hidden = false;
    paintRings();
  }


  const briefBody = byId('home-brief-body');
  const briefAction = byId('home-brief-action');
  const briefUpdated = byId('home-brief-updated');
  const briefCard = briefBody.closest('.home-brief');
  briefCard.querySelector('.home-brief-note')?.remove();

  function briefState(message, { busy = false, updated } = {}) {
    briefBody.textContent = message;
    briefCard.setAttribute('aria-busy', String(busy));
    briefAction.textContent = 'Refresh';
    briefAction.disabled = busy;
    briefUpdated.hidden = !updated;
    if (updated) {
      briefUpdated.dateTime = updated.toISOString();
      briefUpdated.textContent = 'Updated ' + Rx.formatClock(updated);
    }
  }

  function showBrief(data, result) {
    const { flags, requests, incomplete } = result;
    const countLabel = (count, singular, plural) => count ? count + ' ' + (count === 1 ? singular : plural) : '';
    const counts = [
      countLabel(flags.overdueDoses.length, 'overdue dose', 'overdue doses'),
      countLabel(flags.dueDoses.length, 'dose due now', 'doses due now'),
      countLabel(flags.overdueTasks.length, 'overdue task', 'overdue tasks'),
      countLabel(flags.stock.filter(({ item }) => Rx.stockState(item) !== 'ok').length,
        'item low or out of stock', 'items low or out of stock'),
      countLabel(flags.openShifts.length, 'open shift in the next 48 hours', 'open shifts in the next 48 hours'),
      countLabel(requests.length, 'join request to review', 'join requests to review'),
      countLabel(data.pending.length, 'join request awaiting approval', 'join requests awaiting approval')
    ].filter(Boolean);
    const summary = counts.length
      ? counts.join(' · ') + '.'
      : incomplete ? 'Couldn’t load today’s brief.' : 'You’re all caught up.';
    briefState(incomplete && counts.length ? summary + ' Some items couldn’t load.' : summary,
      { updated: incomplete ? undefined : data.now });
  }

  briefState('Loading brief…', { busy: true });
  briefAction.addEventListener('click', () => {
    if (circlesState === 'ready') refresh();
    else loadCircles();
  });

  function loadCard(body, read, render, isCurrent, onError) {
    function attempt() {
      body.setAttribute('aria-busy', 'true');
      Promise.resolve().then(read).then(result => {
        if (isCurrent()) render(result);
      }).catch(() => {
        if (!isCurrent()) return;
        onError?.();
        body.replaceChildren(failed('Couldn’t load', attempt));
      }).finally(() => {
        if (isCurrent()) body.removeAttribute('aria-busy');
      });
    }
    attempt();
  }

  function refreshTime(data, previous) {
    snapshot = data;
    const sameLoad = () => snapshot?.cache === data.cache;
    const sameDay = () => sameLoad() && snapshot.today === data.today;
    const sameShiftWindow = () => sameLoad() && snapshot.shiftWindow === data.shiftWindow;
    const isCurrent = () => snapshot === data;
    const loadAttention = () => loadNotificationAttention(data);
    function renderAttentionResult(result) {
      renderAttention(data, result.requests, result.rows);
      showBrief(data, result);
      if (result.incomplete) {
        attentionCount.hidden = true;
        if (attentionBody.textContent === 'All clear') attentionBody.replaceChildren();
        attentionBody.appendChild(failed('Couldn’t load all items', () => {
          if (snapshot) refreshTime(createSnapshot(snapshot.user, snapshot), snapshot);
        }));
      }
    }
    loadCard(attentionBody, loadAttention, renderAttentionResult, isCurrent, () => briefState('Couldn’t load today’s brief.'));
    if (data.today !== previous?.today) {
      loadCard(progressBody, () => Promise.all([medication(data), data.tasks(), data.shifts(), data.taskSlots().catch(() => [])]),
        result => renderProgress(data, result), sameDay, () => {
          setProgressMenu(false);
          progressFilter.hidden = true;
        });
    }
    if (data.shiftWindow !== previous?.shiftWindow) {
      loadCard(byId('home-shifts-body'), data.nextShifts, shifts => renderShifts(data, shifts), sameShiftWindow);
      loadCard(byId('circle-grid'), data.shifts, shifts => renderCirclesCard(data, shifts), sameShiftWindow);
    }
  }

  function refresh() {
    if (!client || !currentUser) return;
    if (circlesState !== 'ready') {
      snapshot = undefined;
      showNotificationError();
      briefState('Couldn’t load today’s brief.');
      const retry = () => loadCircles();
      const bodies = [attentionBody, byId('home-progress-body'), byId('home-shifts-body'), byId('circle-grid'), activityBody];
      bodies.forEach(body => {
        body.removeAttribute('aria-busy');
        body.replaceChildren(failed('Couldn’t load circles', retry));
      });
      return;
    }

    const data = createSnapshot(currentUser);
    briefState('Loading brief…', { busy: true });
    refreshTime(data);
    loadCard(activityBody, () => Promise.all([data.activity.notes(), data.activity.doses(), data.activity.tasks()]),
      result => renderActivity(data, result), () => snapshot?.cache === data.cache, () => { activityMore.hidden = true; });
  }

  Time.onMinute(() => {
    if (!snapshot || circlesState !== 'ready') return;
    if (Math.floor(+Time.now() / 60000) === Math.floor(+snapshot.now / 60000)) return;
    refreshTime(createSnapshot(snapshot.user, snapshot), snapshot);
  }, { visibleOnly: true });

  window.addEventListener('kalin:circles', refresh);
  window.kalinReady.then(user => {
    if (!user) return;
    if (circlesState !== 'loading' && !snapshot) refresh();
  });
})();

