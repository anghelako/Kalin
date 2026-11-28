const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function setup({ osDark = false, stored = null } = {}) {
  const store = new Map(stored ? [['kalin-theme', stored]] : []);
  const root = { dataset: {} };
  const listeners = {};
  const toggle = { attributes: {}, svg: { innerHTML: '' }, label: { textContent: '' }, listeners: {} };
  toggle.querySelector = selector => (selector === 'svg' ? toggle.svg : toggle.label);
  toggle.setAttribute = (name, value) => { toggle.attributes[name] = value; };
  toggle.addEventListener = (name, listener) => { toggle.listeners[name] = listener; };
  const menu = { children: [], insertBefore(child) { this.children.unshift(child); } };
  let mediaListener;
  const context = vm.createContext({
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    document: {
      documentElement: root,
      readyState: 'complete',
      getElementById: id => (id === 'profile-actions' ? menu : id === 'theme-toggle' && menu.children[0] ? toggle : null),
      createElement: () => toggle,
      addEventListener() {}
    },
    window: { addEventListener(name, listener) { listeners[name] = listener; } },
  });
  context.window.matchMedia = () => ({ matches: osDark, addEventListener: (_, listener) => { mediaListener = listener; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/theme.js'), 'utf8'), context);
  return { root, store, toggle, menu, theme: context.window.KalinTheme, mediaListener: () => mediaListener };
}

test('follows the device setting until a choice is saved', () => {
  assert.equal(setup({ osDark: false }).root.dataset.theme, 'light');
  assert.equal(setup({ osDark: true }).root.dataset.theme, 'dark');
});

test('a saved choice beats the device setting', () => {
  assert.equal(setup({ osDark: true, stored: 'light' }).root.dataset.theme, 'light');
  assert.equal(setup({ osDark: false, stored: 'dark' }).root.dataset.theme, 'dark');
  assert.equal(setup({ osDark: true, stored: 'junk' }).root.dataset.theme, 'dark', 'bad values are ignored');
});

test('the profile menu button switches and remembers the theme', () => {
  const app = setup({ osDark: false });
  assert.equal(app.menu.children.length, 1, 'button added to the profile menu');
  assert.equal(app.toggle.label.textContent, 'Dark mode');
  app.toggle.listeners.click();
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.store.get('kalin-theme'), 'dark');
  assert.equal(app.toggle.label.textContent, 'Light mode');
  assert.equal(app.toggle.attributes['aria-label'], 'Switch to light mode');
  app.toggle.listeners.click();
  assert.equal(app.root.dataset.theme, 'light');
  assert.equal(app.store.get('kalin-theme'), 'light');
});
