const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const date = '2026-11-23';
const user = { id: 'me', user_metadata: { full_name: 'Current Name' } };
const circle = { id: 'circle', name: 'Sample Circle', created_by: user.id, role: 'owner' };
const item = { id: 'medicine', name: 'Sample Medicine', stock: 3, low_stock_threshold: 0, unit: 'tablets', is_active: true };
const schedule = { id: 'schedule', item_id: item.id, circle_id: circle.id, frequency: 'daily',
  start_date: date, times: ['07:00:00'], dose_amount: 1, is_active: true };

// The bare DOM keeps this suite runnable without a browser process or network access.
class Element {
  constructor(tagName, className = '', text = '') {
    this.tagName = tagName;
    this.className = className;
    this.text = String(text);
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = { add() {}, toggle() {}, contains: () => false };
    this.listeners = {};
    this.validity = { badInput: false };
    this.value = '';
  }

  get textContent() { return this.text + this.children.map(child => child.textContent ?? child).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.children[0]; }
  set innerHTML(html) {
    this.children = [...html.matchAll(/<div class="(drawer-list|wg-cell)[^"]*"/g)]
      .map(([, className]) => new Element('div', className));
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => {
      if (!(child instanceof Element)) return [];
      const matches = selector.startsWith('.')
        ? child.className.split(' ').includes(selector.slice(1))
        : child.tagName === selector;
      return [...(matches ? [child] : []), ...child.querySelectorAll(selector)];
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  insertAdjacentHTML() {}
  before() {}
  reset() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function harness(stamp = '2026-11-22T23:00:00Z') {
  let now = Date.parse(stamp);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const tables = {};
  const queries = [];
  const rpcs = [];
  const elements = new Map();
  const rpcErrors = {};
  const timers = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element('div'));
    return elements.get(id);
  };
  const client = {
    from(table) {
      const calls = [];
      const query = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return resolve => {
            queries.push({ table, calls });
            const source = tables[table] ?? [];
            resolve({ data: typeof source === 'function' ? source(calls) : source, error: null });
          };
          return (...args) => { calls.push([method, ...args]); return query; };
        }
      });
      return query;
    },
    async rpc(name, args) {
      rpcs.push({ name, args });
      return { data: {}, error: rpcErrors[name] };
    }
  };
  const context = vm.createContext({
    Date: Clock, client, currentUser: user, URLSearchParams, circles: [circle], myRequests: [],
    circlesState: 'ready', isMissingTable: () => false, colorFor: () => '#2aa899',
    initialOf: name => name[0], el: (...args) => new Element(...args), CIRCLE_COLORS: [],
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    clearTimeout() {}, setInterval() {}, console: { error() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { hash: '' },
    document: {
      getElementById: element,
      createElement: tag => new Element(tag),
      createElementNS: (_, tag) => new Element(tag),
      addEventListener() {}
    },
    window: { kalinReady: new Promise(() => {}), location: { search: '?id=circle' }, addEventListener() {} }
  });
  const run = source => vm.runInContext(source, context);
  function load(name, hooks) {
    const source = read('js/' + name + '.js');
    vm.runInContext(hooks ? source.replace(/\}\)\(\);\s*$/, hooks + '\n})();') : source, context,
      { filename: name + '.js' });
  }
  load('kalin-time');
  load('pharmacy-core');
  return { context, run, load, tables, queries, rpcs, rpcErrors, timers, element,
    setNow: stamp => { now = Date.parse(stamp); } };
}

const copy = {
  shift_started: 'This shift has already started.',
  not_a_member: 'You’re no longer a member of this circle. Refresh the circle or return to Home.',
  shift_taken: 'This shift is no longer available to change.',
  shift_in_past: 'Pick today or a later date.',
  schedule_inactive: 'This medication schedule has been stopped.',
  item_inactive: 'This medicine is inactive or unavailable.',
  invalid_dose_slot: 'This time is no longer part of the schedule.',
  dose_slot_in_future: 'You can’t record a dose for a future date.',
  invalid_stock_amount: 'Enter a valid stock amount with up to two decimal places.',
  invalid_stock_threshold: 'Enter a valid threshold with up to two decimal places.',
  stock_limit_exceeded: 'This change is outside the supported stock range.',
  circle_creator_immutable: 'Circle ownership cannot be transferred.',
  circle_owner_immutable: 'The owner membership cannot be changed.',
  circle_owner_must_be_creator: 'Only the creator can own this circle.',
  circle_creator_must_be_owner: 'The creator must remain the owner.',
  circle_owner_cannot_leave: 'Owners must delete the circle to remove their ownership.'
};

test('Manila day, midnight range, and exact shift cutoffs across UTC dates', () => {
  const { run } = harness();
  const time = run('KalinTime');
  const morning = { shift_date: date, slot: 'morning' };
  const evening = { shift_date: date, slot: 'evening' };
  for (const [stamp, slot, startedMorning, startedEvening] of [
    ['2026-11-22T22:59:00Z', null, false, false],
    ['2026-11-22T23:00:00Z', 'morning', true, false],
    ['2026-11-23T06:59:00Z', 'morning', true, false],
    ['2026-11-23T07:00:00Z', 'evening', true, true],
    ['2026-11-23T13:59:00Z', 'evening', true, true],
    ['2026-11-23T14:00:00Z', null, true, true]
  ]) {
    assert.equal(time.manilaToday(new Date(stamp)), date);
    assert.equal(time.currentSlot(new Date(stamp)), slot);
    assert.equal(time.hasStarted(morning, new Date(stamp)), startedMorning);
    assert.equal(time.hasStarted(evening, new Date(stamp)), startedEvening);
  }
  assert.equal(time.manilaToday(new Date('2026-11-22T15:59:59.999Z')), '2026-11-22');
  assert.equal(time.manilaNow(new Date('2026-11-22T16:00:00Z')).time, '00:00:00');
  assert.equal(time.manilaToday(new Date('2026-11-22T16:00:00Z')), date);
  assert.equal(time.manilaToday(new Date('2026-11-23T00:00:00Z')), date);
  const range = time.manilaMidnightRange(new Date('2026-11-22T18:00:00Z'));
  assert.equal(range.start.toISOString(), '2026-11-22T16:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-11-23T16:00:00.000Z');
  assert.equal(time.shiftEnd(morning).toISOString(), '2026-11-23T07:00:00.000Z');
  assert.equal(time.shiftEnd(evening).toISOString(), '2026-11-23T14:00:00.000Z');
});

test('every Batch B message matches exactly, with a safe fallback', async () => {
  const app = harness();
  const errors = app.run('KalinRx.databaseMessage');
  for (const [code, expected] of Object.entries(copy)) {
    app.rpcErrors.fixture = { code: 'P0001', message: code };
    const { error } = await app.context.client.rpc('fixture');
    assert.equal(errors(error), expected, code);
    assert.equal(errors({ code: 'P0001', message: code + ' ' }, 'safe fallback'), 'safe fallback');
  }
  assert.equal(errors({ code: 'P0001', message: 'Internal constraint details' }), 'Something went wrong. Please try again.');
});

function shift(id, values = {}) {
  return { id, shift_date: date, slot: 'morning', circle_id: circle.id, circles: circle, assigned_to: null, ...values };
}

test('Calendar uses Manila, gates both actions, preserves history, and refreshes rejected claims and releases', async () => {
  const app = harness();
  app.tables.circles = [circle];
  app.tables.shifts = [
    shift('started'), shift('available', { slot: 'evening', assigned_name: 'Old snapshot' }),
    shift('mine', { assigned_to: user.id, assigned_name: 'Snapshot <Volunteer>', profiles: { full_name: 'Other name' } }),
    shift('mine-later', { assigned_to: user.id, slot: 'evening' }),
    shift('past', { shift_date: '2026-11-22', assigned_name: 'Past Volunteer' })
  ];
  app.load('calendar');
  await app.run('load()');
  assert.equal(app.run('ymd(state.weekStart)'), date);
  assert.match(app.queries.find(query => query.table === 'shifts').calls[0][1], /assigned_name/);
  const card = index => app.run('shiftCard(state.shifts[' + index + '], new Date())');
  const [volunteer, release] = [card(0), card(2)].map(node => node.querySelector('.shift-btn'));
  for (const button of [volunteer, release]) {
    assert.equal(button.disabled, true);
    assert.equal(button.title, copy.shift_started);
    assert.match(button.attributes['aria-label'], /already started/);
  }
  const available = app.element('week-grid').querySelectorAll('.shift-btn').find(button => button.dataset.id === 'available');
  assert.equal(available.disabled, false);
  assert.equal(card(1).querySelector('.sh-who').textContent, 'Open slot');
  assert.equal(card(2).querySelector('.sh-who').textContent, 'You (Snapshot <Volunteer>)');
  assert.equal(card(4).querySelector('.sh-who').textContent, 'Past Volunteer');
  assert.equal(card(4).querySelector('.shift-btn'), undefined);
  app.run('openShiftDialog()');
  assert.equal(app.element('shift-date').min, date);
  assert.equal(app.element('shift-date').value, date);
  for (const [rpc, code, action] of [
    ['claim_shift', 'shift_taken', "setShift('available', true)"],
    ['release_shift', 'not_a_member', "setShift('mine-later', false)"]
  ]) {
    app.rpcErrors[rpc] = { code: 'P0001', message: code };
    app.queries.length = 0;
    await app.run(action);
    assert.equal(app.element('cal-status').textContent, copy[code]);
    assert.ok(app.queries.some(query => query.table === 'shifts'));
  }
  app.setNow('2026-11-23T07:00:00Z');
  const current = app.element('week-grid').querySelectorAll('.shift-btn').find(button => button.dataset.id === 'available');
  assert.equal(current.disabled, false);
  app.timers[0].callback();
  assert.equal(current.disabled, true);
  assert.equal(current.title, copy.shift_started);
});

test('Circle board gates Volunteer and reloads after rejection, and duty uses the snapshot', async () => {
  const app = harness();
  const duty = shift('duty', { assigned_to: user.id, assigned_name: 'Duty Snapshot', profiles: { full_name: 'Other name' } });
  app.tables.shifts = calls => calls.some(([method]) => method === 'not')
    ? [duty]
    : [shift('started'), shift('available', { slot: 'evening' })];
  app.load('circle', `
    window.board = {
      start(circle) {
        thisCircle = circle;
        const section = boardCard();
        dutyText = el('p');
        dutyDot = el('span');
        dutyProgress = el('progress');
        dutyHours = el('span');
        dutyOpenShifts = el('a');
        return section;
      },
      loadBoard, loadDuty, volunteerFor,
      view() { return { boardListEl, boardStatusEl, dutyText, dutyProgress }; }
    };`);
  const board = app.context.window.board;
  board.start(circle);
  await board.loadBoard();
  await board.loadDuty();
  const view = board.view();
  const [started, available] = view.boardListEl.querySelectorAll('button');
  assert.equal(started.disabled, true);
  assert.match(started.attributes['aria-label'], /already started/);
  assert.equal(available.disabled, false);
  assert.equal(view.dutyText.textContent, 'Duty Snapshot (you)');
  assert.equal(view.dutyProgress.value, 0);
  assert.ok(app.queries.some(({ calls }) => calls.some(call => call.join('|') === 'gte|shift_date|' + date)));
  app.rpcErrors.claim_shift = { code: 'P0001', message: 'shift_started' };
  app.queries.length = 0;
  await board.volunteerFor('available');
  assert.equal(view.boardStatusEl.textContent, copy.shift_started);
  assert.ok(app.queries.some(query => query.table === 'shifts'));
});

test('Home excludes started shifts and Home and Circles prefer the duty snapshot', async () => {
  const app = harness();
  const duty = shift('duty', { assigned_to: user.id, assigned_name: 'Snapshot Name', profiles: { full_name: 'Other name' } });
  const started = shift('started');
  const future = shift('future', { slot: 'evening' });
  app.tables.shifts = [duty, started, future];
  app.element('notif').appendChild(new Element('span', 'dot'));
  app.element('home-brief-body').closest = () => new Element('section');
  app.load('home', 'window.home = { createSnapshot, careFlags, renderShifts, renderCirclesCard };');
  const home = app.context.window.home;
  const data = home.createSnapshot(user);
  assert.equal(data.today, date);
  assert.equal((await home.careFlags(data)).openShifts.map(row => row.id).join(','), 'future');
  await data.nextShifts();
  assert.ok(app.queries.some(({ calls }) => calls.some(([method, filter]) => method === 'or' &&
    filter === 'shift_date.gt.' + date + ',and(shift_date.eq.' + date + ',slot.in.(evening))')));
  home.renderShifts(data, [duty]);
  assert.equal(app.element('home-shifts-body').textContent, 'No upcoming shifts');
  home.renderCirclesCard(data, [duty]);
  assert.match(app.element('circle-grid').textContent, /On duty: Snapshot Name \(you\)/);
  app.tables.shifts = [duty];
  app.load('circles', 'window.refreshDuty = refreshDuty;');
  app.context.window.kalinReady = Promise.resolve(user);
  await app.context.window.refreshDuty();
  assert.match(app.element('crc-grid').textContent, /On duty: Snapshot/);
});

test('Medication uses the Manila day window and re-reads doses after mark and undo rejections', async () => {
  const app = harness();
  app.tables.pharmacy_items = [item];
  app.tables.medication_schedules = [schedule];
  app.load('medication', 'window.med = { load, markTaken, undo, openDialog };');
  const med = app.context.window.med;
  const panel = app.context.window.KalinMedication.card(circle, true);
  await med.load(true);
  assert.match(panel.textContent, /Due now/);
  assert.ok(app.queries.find(({ table }) => table === 'medication_doses').calls.some(([method, filter]) =>
    method === 'or' && filter === 'slot_date.eq.' + date +
      ',and(taken_at.gte.2026-11-22T16:00:00.000Z,taken_at.lt.2026-11-23T16:00:00.000Z)'));
  med.openDialog();
  assert.equal(app.element('med-start').value, date);
  for (const [rpc, code, action] of [
    ['mark_dose_taken', 'invalid_dose_slot', () => med.markTaken({ schedule, item, date, time: '07:00:00' }, new Element('button'))],
    ['undo_dose', 'not_a_member', () => med.undo({ id: 'dose' }, new Element('button'))]
  ]) {
    app.rpcErrors[rpc] = { code: 'P0001', message: code };
    app.queries.length = 0;
    await action();
    assert.equal(panel.querySelector('.rx-status').textContent, copy[code]);
    assert.ok(app.queries.some(query => query.table === 'medication_doses'));
  }
  const mark = app.rpcs[0].args;
  assert.equal(mark.p_slot_date, date);
  assert.equal(mark.p_slot_time, '07:00:00');
  app.setNow('2026-11-23T00:00:00Z');
  await med.load(true);
  assert.match(panel.textContent, /Overdue/);
  assert.equal(app.run("KalinRx.expiryState({ expires_on: '2026-11-22' })"), 'expired');
});

test('Pharmacy accepts two decimals and rejects out-of-range or disallowed zero values', async () => {
  const app = harness();
  const amount = app.element('stock-amount');
  amount.max = '99999999.99';
  app.element('stock-note-label').appendChild(new Element('span'));
  app.load('pharmacy', 'window.stock = { stockValue, openStock, setStockMode, submitStock, submitItem };');
  const stock = app.context.window.stock;
  stock.openStock(item);
  const submit = () => stock.submitStock({ preventDefault() {} });
  for (const value of ['0', '0.001', '100000000']) {
    amount.value = value;
    await submit();
    assert.equal(app.element('stock-error').textContent, copy.invalid_stock_amount);
  }
  assert.equal(app.rpcs.length, 0);
  amount.value = '99999999.99';
  assert.equal(stock.stockValue(amount, true), 99999999.99);
  await submit();
  assert.equal(app.element('stock-error').textContent, copy.stock_limit_exceeded);
  stock.setStockMode('set');
  assert.equal(amount.min, '0');
  amount.value = '0';
  app.element('stock-note').value = 'Sample correction';
  app.rpcErrors.adjust_pharmacy_stock = { code: 'P0001', message: 'stock_limit_exceeded' };
  await submit();
  assert.equal(app.rpcs.at(-1).args.p_amount, 0);
  assert.equal(app.element('stock-error').textContent, copy.stock_limit_exceeded);

  app.element('item-name').value = item.name;
  app.element('item-stock').max = amount.max;
  const threshold = app.element('item-threshold');
  threshold.max = amount.max;
  threshold.value = '0.001';
  await stock.submitItem({ preventDefault() {} });
  assert.equal(app.element('item-error').textContent, copy.invalid_stock_threshold);
  assert.equal(app.rpcs.length, 1);
  threshold.value = '0.01';
  app.rpcErrors.create_pharmacy_item = { code: 'P0001', message: 'invalid_stock_amount' };
  await stock.submitItem({ preventDefault() {} });
  assert.equal(app.rpcs.at(-1).args.p_stock, 0);
  assert.equal(app.rpcs.at(-1).args.p_threshold, 0.01);
  assert.equal(app.element('item-error').textContent, copy.invalid_stock_amount);
});

test('every app page loads the shared clock ahead of its app scripts', () => {
  for (const file of ['calendar', 'circle', 'circles', 'dashboard', 'login', 'pharmacies', 'pharmacy', 'reset-password']) {
    const scripts = [...read(file + '.html').matchAll(/<script src="js\/([^"]+)"/g)].map(([, name]) => name);
    assert.deepEqual(scripts.slice(0, 2), ['supabase.js', 'kalin-time.js'], file);
  }
});
