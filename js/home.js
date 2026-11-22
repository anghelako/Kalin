/* Care alerts and Home dashboard. The shared bootstrap owns the session and circle mutations. */
(function () {
  const Rx = KalinRx;
  const byId = id => document.getElementById(id);
  const slots = {
    morning: { name: 'Morning', from: 7, to: 15, hours: '7:00–15:00' },
    evening: { name: 'Evening', from: 15, to: 22, hours: '15:00–22:00' }
  };
  const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

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

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(date.getDate() + days);
    return result;
  }

  function shiftStart(row) {
    const date = new Date(row.shift_date + 'T00:00:00');
    date.setHours(slots[row.slot].from);
    return date;
  }

  function orderedShifts(rows) {
    return rows.filter(row => slots[row.slot]).slice().sort((a, b) => shiftStart(a) - shiftStart(b));
  }

  function createSnapshot(user) {
    const now = new Date();
    const today = Rx.todayISO(now);
    const weekEnd = Rx.todayISO(addDays(now, 6));
    const membership = new Map(circles.map(circle => [circle.id, circle]));
    const ids = [...membership.keys()];
    const owners = circles.filter(circle => circle.role === 'owner').map(circle => circle.id);
    const cache = new Map();

    function query(key, table, columns, refine, { limit, circleIds = ids } = {}) {
      if (cache.has(key)) return cache.get(key);
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
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
      return promise;
    }

    return {
      user, now, today, membership, pending: myRequests.slice(),
      items: () => query('items', 'pharmacy_items',
        'id,circle_id,name,stock,low_stock_threshold,expires_on,is_active', row => row),
      schedules: () => query('schedules', 'medication_schedules',
        'id,circle_id,item_id,frequency,days_of_week,interval_days,times,start_date,end_date,is_active',
        row => row.eq('is_active', true)),
      doses: () => query('doses', 'medication_doses', 'id,circle_id,schedule_id,slot_date,slot_time',
        row => row.eq('status', 'taken').eq('slot_date', today)),
      tasks: () => query('tasks', 'circle_tasks', 'id,circle_id,title,due_date,is_done',
        row => row.lte('due_date', today)),
      shifts: () => query('shifts', 'shifts', 'id,circle_id,shift_date,slot,assigned_to,profiles:assigned_to(full_name)',
        row => row.gte('shift_date', today).lte('shift_date', weekEnd)),
      nextShifts: () => query('nextShifts', 'shifts', 'id,circle_id,shift_date,slot,assigned_to',
        row => row.eq('assigned_to', user.id).gte('shift_date', today).order('shift_date').order('slot', { ascending: false }),
        { limit: 3 }),
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
    const nowMinutes = data.now.getHours() * 60 + data.now.getMinutes();
    const overdueDoses = [];
    const dueDoses = [];
    for (const dose of doses) {
      if (dose.taken || !dose.item.is_active) continue;
      const minutesPast = nowMinutes - Rx.minutesOf(dose.time);
      if (minutesPast >= 60) overdueDoses.push(dose);
      else if (minutesPast >= 0) dueDoses.push(dose);
    }
    const overdueTasks = tasks.filter(task => !task.is_done && task.due_date && task.due_date < data.today)
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
      const start = +shiftStart(shift);
      return !shift.assigned_to && start >= +data.now && start <= end;
    });
    return { overdueDoses, dueDoses, overdueTasks, stock, openShifts };
  }

  async function readAttention(data) {
    data.care = careFlags(data);
    const [requests, care] = await Promise.allSettled([data.requests(), data.care]);
    const flags = care.status === 'fulfilled' ? care.value : {
      overdueDoses: [], dueDoses: [], overdueTasks: [], stock: [], openShifts: []
    };
    return {
      requests: requests.status === 'fulfilled' ? requests.value : [],
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
        entry(shift.circle_id, dayLabel.format(shiftStart(shift)) + ' · ' + slots[shift.slot].name,
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

  const activityDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
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

  function renderAttention(data, requests, rows) {
    const total = requests.length + rows.length;
    attentionCount.textContent = String(total);
    attentionCount.hidden = false;
    requestsPanel.hidden = !requests.length;
    requestList.replaceChildren(...requests.slice(0, 5).map(request => joinRow(request, data.membership.get(request.circle_id))));
    attentionBody.replaceChildren(...rows.slice(0, Math.max(0, 5 - requests.length))
      .map(({ circleId, label, status, kind, symbol }) =>
        attentionRow(data.membership.get(circleId), label, status, kind, symbol)));
    if (!total) attentionBody.appendChild(empty('All clear'));
    if (requests.length && location.hash === '#requests') requestsPanel.scrollIntoView();
  }

  function renderShifts(data, shifts) {
    const body = byId('home-shifts-body');
    body.replaceChildren(...orderedShifts(shifts).map(shift => {
      const circle = data.membership.get(shift.circle_id);
      const slot = slots[shift.slot];
      const row = el('div', 'home-shift-row');
      row.append(dot(circle), rowText(dayLabel.format(shiftStart(shift)) + ' · ' + slot.name,
        slot.hours + ' · ' + circle.name));
      return row;
    }));
    if (!body.childElementCount) body.appendChild(empty('No upcoming shifts'));
  }

  function onDutyName(data, shift) {
    if (shift.assigned_to !== data.user.id) return shift.profiles?.full_name || 'Member';
    const meta = data.user.user_metadata || {};
    return (meta.full_name || meta.name || (data.user.email || '').split('@')[0] || 'You').trim() + ' (you)';
  }

  function renderCirclesCard(data, shifts) {
    const grid = byId('circle-grid');
    const hour = data.now.getHours() + data.now.getMinutes() / 60;
    const activeSlot = Object.keys(slots).find(key => hour >= slots[key].from && hour < slots[key].to);
    const duty = new Map(shifts.filter(shift => shift.shift_date === data.today && shift.slot === activeSlot && shift.assigned_to)
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

  function renderProgress(data, [{ doses }, tasks, shifts]) {
    if (!data.membership.has(selectedCircle)) selectedCircle = '';
    const choices = [['', 'All circles'], ...[...data.membership.values()].map(circle => [circle.id, circle.name])];
    const matches = id => !selectedCircle || id === selectedCircle;

    function paintRings() {
      const selectedDoses = doses.filter(dose => matches(dose.circleId));
      const selectedTasks = tasks.filter(task => matches(task.circle_id) && task.due_date === data.today);
      const selectedShifts = shifts.filter(shift => matches(shift.circle_id));
      const rings = el('div', 'home-rings');
      rings.append(
        ring('Doses', 'taken', selectedDoses.filter(dose => dose.taken).length, selectedDoses.length),
        ring('Tasks', 'done', selectedTasks.filter(task => task.is_done).length, selectedTasks.length),
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
  let briefMode = 'load';
  let briefBusy = false;

  function briefState(message, action, { busy = false, disabled = false, saved } = {}) {
    briefBody.textContent = message;
    briefCard.setAttribute('aria-busy', String(busy));
    briefAction.textContent = action;
    briefAction.disabled = busy || disabled;
    briefUpdated.hidden = !saved;
    if (saved) {
      briefUpdated.dateTime = saved.created_at;
      briefUpdated.textContent = 'Updated ' + Rx.formatClock(saved.created_at);
    }
  }

  function showBrief(saved) {
    briefMode = 'generate';
    briefState(saved?.body || 'No brief yet', saved?.body ? 'Refresh' : 'Generate', { saved });
  }

  async function loadBrief() {
    if (briefBusy) return;
    briefBusy = true;
    briefMode = 'load';
    briefState('Loading brief…', 'Generate', { busy: true });
    try {
      const { data, error } = await client.from('home_digests').select('id,body,created_at')
        .eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) {
        if (isMissingTable(error)) {
          briefState('The brief isn’t set up yet', 'Generate', { disabled: true });
          return;
        }
        throw error;
      }
      showBrief(data);
    } catch (_) {
      briefState('Couldn’t load the brief', 'Retry');
    } finally {
      briefBusy = false;
    }
  }

  function makeFacts(data, flags) {
    const shortName = (name, cap) => Array.from(name).slice(0, cap).join('');
    const circlesWithCounts = [...data.membership.values()].map(circle => {
      const counts = {
        overdueDoses: flags.overdueDoses.filter(row => row.circleId === circle.id).length,
        dueDoses: flags.dueDoses.filter(row => row.circleId === circle.id).length,
        overdueTasks: flags.overdueTasks.filter(row => row.circle_id === circle.id).length,
        inventoryAlerts: flags.stock.filter(row => row.item.circle_id === circle.id).length,
        openShifts: flags.openShifts.filter(row => row.circle_id === circle.id).length
      };
      return { id: circle.id, name: shortName(circle.name, 60), counts };
    }).sort((a, b) => {
      const sum = row => Object.values(row.counts).reduce((total, count) => total + count, 0);
      return sum(b) - sum(a);
    }).slice(0, 20);
    const index = new Map(circlesWithCounts.map((circle, position) => [circle.id, position]));
    const doseFact = (dose, type) => ({
      type, circle: index.get(dose.circleId), name: shortName(dose.item.name, 80), time: dose.time.slice(0, 5)
    });
    const items = [
      ...flags.overdueDoses.map(dose => doseFact(dose, 'overdueDose')),
      ...flags.dueDoses.map(dose => doseFact(dose, 'dueDose')),
      ...flags.stock.filter(({ item }) => Rx.stockState(item) !== 'ok')
        .map(({ item }) => ({ type: 'lowStock', circle: index.get(item.circle_id), name: shortName(item.name, 80) })),
      ...flags.openShifts.map(shift => ({
        type: 'openShift', circle: index.get(shift.circle_id), day: shift.shift_date, slot: shift.slot
      }))
    ].filter(item => item.circle !== undefined).slice(0, 10);
    return { circles: circlesWithCounts.map(({ name, counts }) => ({ name, counts })), items };
  }

  async function generateBrief() {
    if (briefBusy) return;
    briefBusy = true;
    briefState('Generating…', 'Generating…', { busy: true });
    try {
      const current = snapshot;
      if (!current?.care) throw new Error('Home facts unavailable');
      const flags = await current.care;
      if (snapshot !== current) throw new Error('Home facts changed');
      const facts = makeFacts(current, flags);
      const { data, error } = await client.functions.invoke('home-digest', { body: { facts } });
      const status = error?.context?.status;
      if (status === 404 || status === 503) {
        briefState('The brief isn’t set up yet', 'Try again');
        return;
      }
      if (status === 429) {
        briefState('Wait a minute before refreshing the brief.', 'Try again');
        return;
      }
      if (error || !data?.body || !data.created_at) throw error || new Error('Invalid brief');
      showBrief(data);
    } catch (_) {
      briefState('Couldn’t generate the brief', 'Try again');
    } finally {
      briefBusy = false;
    }
  }

  briefAction.addEventListener('click', () => {
    if (briefMode === 'load') loadBrief();
    else generateBrief();
  });

  function loadCard(data, body, read, render, onError) {
    function attempt() {
      body.setAttribute('aria-busy', 'true');
      Promise.resolve().then(read).then(result => {
        if (snapshot === data) render(result);
      }).catch(() => {
        if (snapshot !== data) return;
        onError?.();
        body.replaceChildren(failed('Couldn’t load', attempt));
      }).finally(() => {
        if (snapshot === data) body.removeAttribute('aria-busy');
      });
    }
    attempt();
  }

  function refresh() {
    if (!client || !currentUser) return;
    if (circlesState !== 'ready') {
      snapshot = undefined;
      showNotificationError();
      const retry = () => loadCircles();
      const bodies = [attentionBody, byId('home-progress-body'), byId('home-shifts-body'), byId('circle-grid'), activityBody];
      bodies.forEach(body => {
        body.removeAttribute('aria-busy');
        body.replaceChildren(failed('Couldn’t load circles', retry));
      });
      return;
    }

    const data = createSnapshot(currentUser);
    snapshot = data;
    const loadAttention = () => loadNotificationAttention(data);
    function renderAttentionResult(result) {
      renderAttention(data, result.requests, result.rows);
      if (result.incomplete) {
        attentionCount.hidden = true;
        if (attentionBody.textContent === 'All clear') attentionBody.replaceChildren();
        attentionBody.appendChild(failed('Couldn’t load all items', () => {
          loadCard(data, attentionBody, loadAttention, renderAttentionResult);
        }));
      }
    }
    loadCard(data, attentionBody, loadAttention, renderAttentionResult);
    loadCard(data, progressBody, () => Promise.all([medication(data), data.tasks(), data.shifts()]),
      result => renderProgress(data, result), () => {
        setProgressMenu(false);
        progressFilter.hidden = true;
      });
    loadCard(data, byId('home-shifts-body'), data.nextShifts, shifts => renderShifts(data, shifts));
    loadCard(data, byId('circle-grid'), data.shifts, shifts => renderCirclesCard(data, shifts));
    loadCard(data, activityBody, () => Promise.all([data.activity.notes(), data.activity.doses(), data.activity.tasks()]),
      result => renderActivity(data, result), () => { activityMore.hidden = true; });
  }

  window.addEventListener('kalin:circles', refresh);
  window.kalinReady.then(user => {
    if (!user) return;
    if (circlesState !== 'loading' && !snapshot) refresh();
    loadBrief();
  });
})();

