import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modulePath = process.env.BATCH_C_PLAYWRIGHT_JS;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = 'https://kalin.example.invalid';
const ids = {
  circle: '00000000-0000-4000-8000-000000000301',
  owner: '00000000-0000-4000-8000-000000000302',
  guest: '00000000-0000-4000-8000-000000000303'
};

function mockClient({ ids, member = false }) {
  const circle = {
    id: ids.circle, name: 'Synthetic Circle', description: '', created_by: ids.owner, is_active: true,
    ai_enabled: false, role: 'owner', invite_code: 'TEST0000', created_at: '2037-01-01T00:00:00Z',
    circle_members: [
      { circle_id: ids.circle, user_id: ids.owner, role: 'owner' },
      { circle_id: ids.circle, user_id: ids.guest, role: 'member' }
    ]
  };
  const records = {
    circles: [circle], circle_members: circle.circle_members, profiles: [{ id: ids.owner, full_name: 'Synthetic Author' }],
    care_notes: [{
      id: 'note', circle_id: ids.circle, created_at: '2037-03-05T18:34:56Z',
      body: 'Synthetic Author in Synthetic Circle: test@example.invalid, (0917) 123-4567. ' + 'Observation. '.repeat(28)
    }],
    ai_log: [{
      id: 'saved', circle_id: ids.circle, kind: 'summary', body: 'Previously saved summary.',
      created_at: '2037-03-05T18:34:56Z', verified_generation: true
    }],
    pharmacy_items: [{ id: 'item', circle_id: ids.circle, name: 'Synthetic medicine', stock: 1, low_stock_threshold: 2, is_active: true }],
    medication_schedules: [{
      id: 'schedule', circle_id: ids.circle, item_id: 'item', frequency: 'daily',
      start_date: '2037-03-01', times: ['08:00:00', '11:20:00'], is_active: true
    }],
    medication_doses: [],
    circle_tasks: [{ id: 'task', circle_id: ids.circle, title: 'Synthetic task', due_date: '2037-03-05', is_done: false }],
    shifts: [
      { id: 'open', circle_id: ids.circle, shift_date: '2037-03-07', assigned_to: null, slot: 'evening' },
      { id: 'covered', circle_id: ids.circle, shift_date: '2037-03-06', assigned_to: ids.owner, slot: 'evening' }
    ],
    circle_join_requests: [{
      id: 'request', circle_id: ids.circle, user_id: ids.guest, status: 'pending', circle_name: circle.name,
      requester_name: 'Synthetic requester', created_at: '2037-03-05T20:00:00Z'
    }]
  };
  const state = { calls: [], reads: [], inserts: [], rpcs: [], records, invokeError: null };
  window.fixture = state;
  window.currentUser = member
    ? { id: ids.guest, email: 'guest@example.invalid' }
    : { id: ids.owner, user_metadata: { full_name: 'Synthetic Author' } };
  window.kalinReady = Promise.resolve(window.currentUser);
  window.circles = [circle];
  window.circlesState = 'ready';
  window.myRequests = [{ id: 'outgoing', circle_name: 'Synthetic waiting circle', status: 'pending' }];
  window.KalinTodo = { mount() {} };
  window.loadCircles = async () => window.dispatchEvent(new Event('kalin:circles'));
  window.isMissingTable = () => false;
  window.initialOf = text => text?.[0] || '?';
  window.colorFor = () => '#2aa899';
  window.el = (tag, classes, text) => {
    const node = document.createElement(tag);
    if (classes) node.className = classes;
    if (text != null) node.textContent = text;
    return node;
  };
  window.requestRow = () => {
    const row = document.createElement('div');
    row.appendChild(window.el('div', 'req-avatar'));
    return row;
  };
  window.pendingCard = row => window.el('div', '', row.circle_name);
  window.codeChip = row => window.el('span', '', row.invite_code);

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.count = Infinity; this.start = 0; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    gt(key, value) { this.filters.push(row => row[key] > value); return this; }
    gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
    lte(key, value) { this.filters.push(row => row[key] <= value); return this; }
    is(key, value) { return this.eq(key, value); }
    not(key, _operator, value) { return this.neq(key, value); }
    or(expression) {
      const [, date, slots] = /^shift_date\.gt\.([^,]+),and\(shift_date\.eq\.\1,slot\.in\.\(([^)]+)\)\)$/.exec(expression);
      const upcoming = slots.split(',');
      this.filters.push(row => row.shift_date > date || (row.shift_date === date && upcoming.includes(row.slot)));
      return this;
    }
    order() { return this; }
    limit(count) { this.count = count; return this; }
    range(start, end) { this.start = start; this.count = end - start + 1; return this; }
    rows() {
      state.reads.push(this.table);
      return (records[this.table] || []).filter(row => this.filters.every(filter => filter(row)))
        .slice(this.start, this.start + this.count);
    }
    maybeSingle() { return Promise.resolve({ data: this.rows()[0] || null }); }
    then(resolve, reject) { return Promise.resolve({ data: this.rows() }).then(resolve, reject); }
    insert(row) {
      state.inserts.push({ table: this.table, row });
      return Promise.resolve({ error: null });
    }
  }

  window.client = {
    from: table => new Query(table),
    rpc: async (name, args) => {
      state.rpcs.push({ name, args });
      if (name === 'set_circle_ai_enabled') circle.ai_enabled = args.p_enabled;
      return { data: 'ok' };
    },
    functions: { invoke: async (name, { body }) => {
      state.calls.push({ name, body });
      if (state.invokeError) return { error: { context: { json: async () => state.invokeError } } };
      return { data: {
        id: 'draft', body: 'Observed a quiet afternoon.', created_at: '2037-03-06T03:30:00Z', verified_generation: true
      } };
    } }
  };
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.BATCH_C_CHROMIUM || undefined });
const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
const activeScripts = new Set([
  '/js/home.js', '/js/circle.js', '/js/kalin-time.js', '/js/pharmacy-core.js', '/supabase/functions/_shared/handoff-content.mjs'
]);
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort();
  const path = url.pathname;
  if (path.endsWith('.js') && !activeScripts.has(path)) return route.fulfill({ contentType: 'application/javascript', body: '' });
  if (!['/circle.html', '/dashboard.html'].includes(path) && !activeScripts.has(path) && !/^\/css\/[\w-]+\.css$/.test(path)) {
    return route.abort();
  }
  const contentType = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'application/javascript';
  return route.fulfill({ contentType: contentType + '; charset=utf-8', body: await readFile(resolve(root, path.slice(1))) });
});
try {
  const home = await context.newPage();
  await home.addInitScript(mockClient, { ids });
  await home.clock.install({ time: new Date('2037-03-06T03:30:00Z') });
  const pageErrors = [];
  home.on('pageerror', error => pageErrors.push(error.message));
  await home.goto(base + '/dashboard.html');
  const initial = '1 overdue dose · 1 dose due now · 1 overdue task · 1 item low or out of stock · 1 open shift in the next 48 hours · 1 join request to review · 1 join request awaiting approval.';
  await home.waitForFunction(expected => document.getElementById('home-brief-body').textContent === expected, initial);
  assert.equal(await home.locator('.home-brief-note').count(), 0);
  const firstReads = await home.evaluate(() => window.fixture.reads.length);
  await home.evaluate(() => { window.fixture.records.circle_tasks[0].is_done = true; });
  await home.getByRole('button', { name: 'Refresh', exact: true }).click();
  await home.waitForFunction(expected => document.getElementById('home-brief-body').textContent === expected,
    initial.replace('1 overdue task · ', ''));
  assert.ok(await home.evaluate(() => window.fixture.reads.length) > firstReads);
  assert.deepEqual(await home.evaluate(() => window.fixture.calls), []);
  assert.equal(await home.evaluate(() => window.fixture.reads.includes('home_digests')), false);

  const readsAfterRefresh = await home.evaluate(() => window.fixture.reads.length);
  await home.clock.fastForward(50 * 60 * 1000);
  const afterDoseCutoff = initial.replace('1 overdue dose · 1 dose due now · 1 overdue task', '2 overdue doses');
  await home.waitForFunction(expected => document.getElementById('home-brief-body').textContent === expected, afterDoseCutoff);
  assert.equal(await home.evaluate(() => window.fixture.reads.length), readsAfterRefresh);

  await home.clock.fastForward((2 * 60 + 40) * 60 * 1000);
  await home.getByText('On duty: Synthetic Author (you)', { exact: true }).waitFor();
  await home.getByText('No upcoming shifts', { exact: true }).waitFor();
  assert.deepEqual(await home.evaluate(start => window.fixture.reads.slice(start), readsAfterRefresh), ['shifts']);

  const readsBeforeMidnight = await home.evaluate(() => window.fixture.reads.length);
  await home.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await home.clock.fastForward(9 * 60 * 60 * 1000);
  assert.equal(await home.evaluate(() => window.fixture.reads.length), readsBeforeMidnight);
  assert.equal(await home.locator('#home-brief-body').textContent(), afterDoseCutoff);
  await home.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await home.waitForFunction(expected => document.getElementById('home-brief-body').textContent === expected,
    afterDoseCutoff.replace('2 overdue doses · ', ''));
  assert.deepEqual((await home.evaluate(start => window.fixture.reads.slice(start), readsBeforeMidnight)).sort(),
    ['circle_tasks', 'medication_doses', 'shifts', 'shifts']);

  const circle = await context.newPage();
  await circle.addInitScript(mockClient, { ids });
  circle.on('pageerror', error => pageErrors.push(error.message));
  circle.on('dialog', dialog => dialog.accept());
  await circle.goto(base + '/circle.html?id=' + ids.circle);
  const handoff = circle.getByRole('button', { name: 'Handoff brief', exact: true });
  const generate = circle.getByRole('button', { name: 'Generate summary' });
  const settings = circle.getByRole('button', { name: 'Circle settings' });
  const modal = circle.locator('#brief-dialog');
  const send = modal.getByRole('button', { name: 'Send to AI' });

  await circle.getByText('Previously saved summary.').waitFor();
  assert.equal(await handoff.isVisible(), false);
  assert.equal(await generate.isVisible(), false);
  await settings.click();
  await circle.getByRole('menuitem', { name: 'Enable AI drafts' }).click();
  await circle.getByRole('menuitem', { name: 'Disable AI drafts' }).waitFor();
  await generate.waitFor();
  assert.equal(await circle.evaluate(() => window.fixture.rpcs[0].name), 'set_circle_ai_enabled');

  await circle.getByRole('menuitem', { name: 'Disable AI drafts' }).click();
  await circle.getByRole('menuitem', { name: 'Enable AI drafts' }).waitFor();
  assert.equal(await handoff.isVisible(), false);
  assert.equal(await generate.isVisible(), false);
  await circle.getByRole('menuitem', { name: 'Enable AI drafts' }).click();
  await handoff.click();
  await modal.getByText('1 note will be sent to Gemini.').waitFor();
  assert.equal(await circle.evaluate(() => window.fixture.calls.length), 0);
  const preview = modal.locator('.handoff-preview-notes');
  const excerpt = await preview.locator('li > p').textContent();
  assert.equal(Array.from(excerpt).length, 81);
  assert.doesNotMatch(await preview.textContent(), /Synthetic Circle|Synthetic Author|example\.invalid|123-4567|18:34:56/);
  await preview.getByText('Show full text to be sent').click();
  const full = await preview.locator('details > p').textContent();
  assert.equal(Array.from(full).length, 300);
  await modal.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await circle.evaluate(() => window.fixture.calls.length), 0);

  await handoff.click();
  await send.click();
  await modal.getByText('Observed a quiet afternoon.').waitFor();
  assert.ok(await modal.getByText('AI-generated draft. Not medical advice.').isVisible());
  const [invocation] = await circle.evaluate(() => window.fixture.calls);
  assert.deepEqual(invocation, {
    name: 'handoff-brief', body: { circle_id: ids.circle, kind: 'handoff_brief', notes: [{ date: '2037-03-06', text: full }] }
  });
  await modal.getByRole('button', { name: 'Close', exact: true }).last().click();

  await circle.evaluate(() => { window.fixture.invokeError = { code: 'cooldown', error: 'RAW_PROVIDER_DETAIL' }; });
  await circle.getByRole('button', { name: 'Generate summary' }).click();
  await send.click();
  await modal.getByText('Wait a minute before requesting another draft for this circle.').waitFor();
  assert.doesNotMatch(await modal.textContent(), /RAW_PROVIDER_DETAIL/);
  await modal.getByRole('button', { name: 'Close', exact: true }).last().click();

  await circle.evaluate(() => { window.fixture.invokeError = { code: 'ai_disabled' }; });
  await generate.click();
  await send.click();
  await modal.getByText("AI drafts aren't available yet.").waitFor();
  await modal.getByRole('button', { name: 'Close', exact: true }).last().click();
  assert.equal(await handoff.isVisible(), false);
  assert.equal(await generate.isVisible(), false);
  await circle.getByText("AI drafts aren't available yet.").waitFor();

  await circle.getByRole('button', { name: 'Add note' }).click();
  await circle.locator('#note-body').fill('Synthetic note saved locally.');
  await circle.getByRole('button', { name: 'Save note' }).click();
  await circle.getByText('Note saved.').waitFor();
  assert.deepEqual(await circle.evaluate(() => window.fixture.inserts), [{
    table: 'care_notes', row: { circle_id: ids.circle, body: 'Synthetic note saved locally.' }
  }]);

  await circle.reload();
  await circle.getByText('Previously saved summary.').waitFor();
  await settings.click();
  await circle.getByRole('menuitem', { name: 'Enable AI drafts' }).click();
  await circle.getByRole('menuitem', { name: 'Disable AI drafts' }).waitFor();
  assert.equal(await handoff.isVisible(), false);
  assert.equal(await generate.isVisible(), false);

  const member = await context.newPage();
  member.on('pageerror', error => pageErrors.push(error.message));
  await member.addInitScript(mockClient, { ids, member: true });
  await member.goto(base + '/circle.html?id=' + ids.circle);
  await member.getByText('Previously saved summary.').waitFor();
  assert.equal(await member.getByRole('button', { name: 'Handoff brief', exact: true }).isVisible(), false);
  assert.equal(await member.getByRole('button', { name: 'Generate summary' }).isVisible(), false);
  await member.getByRole('button', { name: 'Circle settings' }).click();
  assert.equal(await member.getByRole('menuitem', { name: 'Enable AI drafts' }).count(), 0);
  assert.ok(await member.getByRole('button', { name: 'Add note' }).isVisible());
  assert.deepEqual(pageErrors, []);
  console.log('Batch C mock-client browser tests passed for Home, consent, preview, cancellation, confirmation, safe errors, and notes.');
} finally {
  await browser.close();
}
