const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

class Element {
  constructor(tagName, className = '', text = '') {
    Object.assign(this, { tagName, className, text: String(text), children: [], attributes: {}, dataset: {}, listeners: {}, value: '' });
    this.classList = { add() {}, toggle() {}, contains: () => false };
    this.style = { setProperty() {} };
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => {
      const hit = selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector;
      return [...(hit ? [child] : []), ...child.querySelectorAll(selector)];
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  focus() {}
  showModal() {}
  close() {}
  reset() {}
}

// Monday 2026-11-23 07:00 in Manila
const NOW = Date.parse('2026-11-22T23:00:00Z');
const task = (id, extra) => ({ id, circle_id: 'c', created_by: 'me', created_at: '2026-11-01T00:00:00Z', due_date: '2026-11-20',
  is_done: false, frequency: 'once', days_of_week: [], interval_days: null, times: [], end_date: null, instructions: null, ...extra });

function setup(tasks, completions = []) {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const writes = [];
  const client = {
    from(table) {
      const calls = [];
      const query = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return resolve => {
            const write = calls.find(([name]) => name === 'insert' || name === 'delete');
            if (write) { writes.push({ table, calls }); return resolve({ data: null, error: null }); }
            resolve({ data: table === 'circle_tasks' ? tasks : completions, error: null });
          };
          return (...args) => { calls.push([method, ...args]); return query; };
        }
      });
      return query;
    }
  };
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, new Element('div')); return elements.get(id); };
  const context = vm.createContext({
    Date: Clock, client, el: (...args) => new Element(...args), isMissingTable: () => false,
    document: { getElementById: element, createElement: tag => new Element(tag) },
    window: { confirm: () => true }
  });
  for (const file of ['kalin-time', 'pharmacy-core', 'todo']) vm.runInContext(read('js/' + file + '.js'), context, { filename: file });
  const section = new Element('section');
  const head = new Element('div');
  head.firstElementChild = new Element('div');
  context.window.KalinTodo.mount({ section, head }, { id: 'c', circle_members: [] }, 'me');
  return { section, head, writes, summary: () => head.firstElementChild.textContent };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a repeating task is ticked per time of day, and one-off tasks still use is_done', async () => {
  const app = setup([
    task('daily', { title: 'Check blood pressure', frequency: 'daily', times: ['08:00:00', '20:00:00'] }),
    task('tuesday', { title: 'Tuesday task', frequency: 'weekly', days_of_week: [2], times: ['09:00:00'] }),
    task('once', { title: 'Call the clinic', due_date: '2026-11-23' })
  ]);
  await settle();
  const slots = () => app.section.querySelectorAll('.todo-slot');

  assert.equal(slots().length, 2, 'two times today for the daily task, none for the Tuesday task');
  assert.match(app.section.textContent, /Call the clinic/);
  assert.doesNotMatch(app.section.textContent, /Tuesday task/, 'not due on a Monday, so hidden from Today');
  assert.equal(app.summary(), '2 of 2 open');

  const first = slots()[0].querySelector('input');
  first.checked = true;
  await first.listeners.change();
  assert.equal(JSON.stringify(app.writes.at(-1).calls[0]),
    JSON.stringify(['insert', { circle_id: 'c', task_id: 'daily', slot_date: '2026-11-23', slot_time: '08:00' }]));
  assert.equal(app.summary(), '2 of 2 open', 'one of two times done: the task is still open');

  const second = slots()[1].querySelector('input');
  second.checked = true;
  await second.listeners.change();
  assert.equal(app.summary(), '1 of 2 open', 'both times done: the task is complete for today');

  const undo = slots()[0].querySelector('input');
  undo.checked = false;
  await undo.listeners.change();
  assert.equal(app.writes.at(-1).calls[0][0], 'delete');
  assert.equal(app.summary(), '2 of 2 open');
});

test('times that were already ticked today load as done', async () => {
  const app = setup(
    [task('daily', { title: 'Walk', frequency: 'daily', times: ['08:00:00'] })],
    [{ task_id: 'daily', slot_time: '08:00:00' }]
  );
  await settle();
  assert.equal(app.summary(), '0 of 1 open');
});
