/* Virtual Pharmacy page (pharmacy.html?id=<circle uuid>).
   Runs after dashboard.js (client, currentUser, el(), kalinReady, sidebar) and pharmacy-core.js. */
(function () {
  const Rx = KalinRx;
  const root = document.getElementById('pharm-root');
  const circleId = new URLSearchParams(window.location.search).get('id');

  let circle = null;
  let owner = false;
  let items = [];
  let showInactive = false;
  let state = 'loading'; // 'loading' | 'ready'

  /* ---------- Page states ---------- */

  function showMessage(title, text, withBack) {
    root.replaceChildren();
    const box = el('div', 'page-state');
    box.append(el('h2', '', title), el('p', '', text));
    if (withBack) {
      const link = el('a', 'btn-solid link-btn', circleId && circle ? 'Back to the circle' : 'Back to Home');
      link.href = circleId && circle ? 'circle.html?id=' + encodeURIComponent(circleId) : 'dashboard.html';
      box.appendChild(link);
    }
    root.appendChild(box);
  }

  /* ---------- Loading ---------- */

  async function loadItems(silent) {
    const { data, error } = await client
      .from('pharmacy_items')
      .select('id, name, strength, form, unit, stock, low_stock_threshold, expires_on, notes, is_active, created_at')
      .eq('circle_id', circleId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Could not load the pharmacy:', error);
      if (silent) return;
      showMessage(
        'Couldn’t load the pharmacy',
        Rx.isMissing(error) ? Rx.SETUP_MESSAGE : 'Check your connection and refresh the page.',
        true
      );
      return false;
    }

    items = data;
    state = 'ready';
    render();
    return true;
  }

  async function load() {
    const user = await window.kalinReady;
    if (!user || !client) return;

    if (!circleId) {
      return showMessage('No circle selected', 'Open the pharmacy from a circle’s Medication panel.', true);
    }

    const { data, error } = await client
      .from('circles')
      .select('id, name, created_by')
      .eq('id', circleId)
      .maybeSingle();

    if (error) {
      console.error('Could not load circle:', error);
      return showMessage('Couldn’t load this circle', 'Check your connection and refresh the page.', true);
    }
    if (!data) {
      return showMessage('Circle not found', 'It may have been deleted, or you may not be a member.', true);
    }

    circle = data;
    owner = circle.created_by === currentUser.id;
    document.title = 'Pharmacy · ' + Rx.possessive(circle.name) + ' · Kalin';
    const back = document.getElementById('back-link');
    back.href = 'circle.html?id=' + encodeURIComponent(circleId);
    back.querySelector('span').textContent = 'Back to ' + Rx.possessive(circle.name);

    await loadItems(false);
  }

  /* ---------- Rendering ---------- */

  function needsAttention(item) {
    const stock = Rx.stockState(item);
    const expiry = Rx.expiryState(item);
    return (stock === 'out' ? 0 : stock === 'low' ? 1 : expiry === 'expired' ? 2 : expiry === 'soon' ? 3 : 4);
  }

  function statTile(label, value, kind) {
    const tile = el('div', 'rx-stat' + (kind && value > 0 ? ' rx-stat-' + kind : ''));
    tile.append(el('strong', '', String(value)), el('span', '', label));
    return tile;
  }

  function headerCard() {
    const section = el('section', 'panel rx-header');

    const top = el('div', 'rx-header-top');
    const text = el('div');
    text.append(
      el('h1', 'hero-title', 'Virtual Pharmacy'),
      el('p', 'hero-desc', Rx.possessive(circle.name))
    );
    top.appendChild(text);

    if (owner) {
      const add = el('button', 'btn-solid', 'Add medicine');
      add.type = 'button';
      add.addEventListener('click', () => openItemDialog(null));
      top.appendChild(add);
    }

    section.append(
      top,
      el('p', 'rx-disclaimer',
        'Kalin records what caregivers do. It doesn’t check doses, interactions or whether a medicine is right for someone.')
    );
    return section;
  }

  function statsRow() {
    const active = items.filter(item => item.is_active);
    const stats = el('div', 'rx-stats');
    stats.append(
      statTile('Active medicines', active.length),
      statTile('Low stock', active.filter(i => Rx.stockState(i) === 'low').length, 'low'),
      statTile('Out of stock', active.filter(i => Rx.stockState(i) === 'out').length, 'out'),
      statTile('Expiring or expired', active.filter(i => Rx.expiryState(i)).length, 'soon')
    );
    return stats;
  }

  function toolbar() {
    const bar = el('div', 'rx-toolbar');
    const inactiveCount = items.filter(item => !item.is_active).length;

    bar.appendChild(el('h2', 'rx-section-title', 'Medicines'));

    if (inactiveCount) {
      const label = el('label', 'rx-toggle');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = showInactive;
      box.addEventListener('change', () => {
        showInactive = box.checked;
        render();
      });
      label.append(box, el('span', '', 'Show inactive (' + inactiveCount + ')'));
      bar.appendChild(label);
    }
    return bar;
  }

  function actionButton(label, onClick, kind) {
    const button = el('button', 'btn-ghost small' + (kind ? ' ' + kind : ''), label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function itemCard(item) {
    const card = el('article', 'rx-card' + (item.is_active ? '' : ' is-inactive'));

    const head = el('div', 'rx-card-head');
    const title = el('div');
    title.appendChild(el('h3', '', item.name));
    title.appendChild(el('p', 'rx-sub', [item.strength, Rx.formLabel(item.form)].filter(Boolean).join(' · ')));
    head.appendChild(title);
    card.appendChild(head);

    const stock = el('p', 'rx-stock');
    stock.append(
      el('strong', '', Rx.number(item.stock)),
      el('span', '', ' ' + Rx.unitWord(item.stock, item.unit) + ' left')
    );
    card.appendChild(stock);

    const chips = el('div', 'rx-chips');
    Rx.statusChips(item).forEach(c => chips.appendChild(c));
    card.appendChild(chips);

    const facts = el('ul', 'rx-facts');
    if (Number(item.low_stock_threshold) > 0) {
      facts.appendChild(el('li', '', 'Warn at ' + Rx.quantity(item.low_stock_threshold, item.unit)));
    }
    if (item.expires_on) facts.appendChild(el('li', '', 'Expires ' + Rx.formatDay(item.expires_on)));
    if (facts.children.length) card.appendChild(facts);
    if (item.notes) card.appendChild(el('p', 'rx-notes', item.notes));

    const actions = el('div', 'rx-card-actions');
    actions.appendChild(actionButton('History', () => openHistory(item)));
    if (owner) {
      actions.append(
        actionButton('Adjust stock', () => openStock(item)),
        actionButton('Edit', () => openItemDialog(item)),
        actionButton(item.is_active ? 'Deactivate' : 'Reactivate', () => toggleActive(item))
      );
    }
    card.appendChild(actions);
    return card;
  }

  function render() {
    if (state !== 'ready') return;

    const page = el('div', 'rx-page');
    page.append(headerCard());

    if (!items.length) {
      const empty = el('div', 'page-state');
      empty.append(
        el('h2', '', 'The pharmacy is empty'),
        el('p', '', owner
          ? 'Add the medicines this circle uses. Then schedule them from the Medication panel on the circle page.'
          : 'The circle owner hasn’t added any medicines yet.')
      );
      if (owner) {
        const add = el('button', 'btn-solid', 'Add the first medicine');
        add.type = 'button';
        add.addEventListener('click', () => openItemDialog(null));
        empty.appendChild(add);
      }
      page.appendChild(empty);
      root.replaceChildren(page);
      return;
    }

    page.append(statsRow(), toolbar());

    const visible = items
      .filter(item => item.is_active || showInactive)
      .sort((a, b) =>
        Number(!a.is_active) - Number(!b.is_active) ||
        needsAttention(a) - needsAttention(b) ||
        a.name.localeCompare(b.name)
      );

    const grid = el('div', 'rx-grid');
    visible.forEach(item => grid.appendChild(itemCard(item)));
    page.appendChild(grid);

    root.replaceChildren(page);
  }

  /* ---------- Deactivate / reactivate ---------- */

  async function toggleActive(item) {
    const next = !item.is_active;
    if (!next) {
      const ok = window.confirm(
        'Deactivate ' + Rx.medicineName(item) + '? It will be hidden from new schedules and its existing schedules will pause. ' +
        'All history is kept, and you can reactivate it any time.'
      );
      if (!ok) return;
    }

    const { data, error } = await client
      .from('pharmacy_items')
      .update({ is_active: next })
      .eq('id', item.id)
      .select('id');

    if (error || !data || !data.length) {
      console.error('Could not update medicine:', error);
      window.alert(error ? Rx.friendly(error) : 'Only the circle owner can do that.');
      return;
    }
    await loadItems(true);
  }

  /* ---------- Add / edit medicine dialog ---------- */

  const itemDialog = document.getElementById('item-dialog');
  const itemForm = document.getElementById('item-form');
  let editing = null;
  let lastAutoUnit = 'tablets';

  function itemError(text) {
    document.getElementById('item-error').textContent = text;
  }

  function openItemDialog(item) {
    editing = item;
    itemForm.reset();
    itemError('');

    const adding = !item;
    document.getElementById('item-title').textContent = adding ? 'Add a medicine' : 'Edit medicine';
    document.getElementById('item-eyebrow').textContent = adding ? 'New' : 'Edit';
    document.getElementById('item-save').textContent = adding ? 'Add medicine' : 'Save changes';
    document.getElementById('item-stock-field').hidden = !adding;
    document.getElementById('item-stock-note').hidden = adding;

    document.getElementById('item-name').value = adding ? '' : item.name;
    document.getElementById('item-strength').value = adding ? '' : (item.strength || '');
    document.getElementById('item-form-type').value = adding ? 'tablet' : item.form;
    document.getElementById('item-unit').value = adding ? 'tablets' : item.unit;
    lastAutoUnit = document.getElementById('item-unit').value;
    document.getElementById('item-stock').value = '';
    document.getElementById('item-threshold').value = adding ? '' : Rx.number(item.low_stock_threshold);
    document.getElementById('item-expires').value = adding ? '' : (item.expires_on || '');
    document.getElementById('item-notes').value = adding ? '' : (item.notes || '');

    itemDialog.showModal();
    document.getElementById('item-name').focus();
  }

  async function submitItem(e) {
    e.preventDefault();
    itemError('');

    const name = document.getElementById('item-name').value.trim();
    const strength = document.getElementById('item-strength').value.trim();
    const form = document.getElementById('item-form-type').value;
    const unit = document.getElementById('item-unit').value;
    const stockText = document.getElementById('item-stock').value;
    const thresholdText = document.getElementById('item-threshold').value;
    const expires = document.getElementById('item-expires').value;
    const notes = document.getElementById('item-notes').value.trim();

    const threshold = thresholdText === '' ? 0 : parseFloat(thresholdText);
    const stock = stockText === '' ? 0 : parseFloat(stockText);

    if (!name) return itemError('Enter the medicine’s name.');
    if (!(threshold >= 0)) return itemError('The low-stock level can’t be negative.');
    if (!editing && !(stock >= 0)) return itemError('Stock can’t be negative.');

    const save = document.getElementById('item-save');
    const label = save.textContent;
    save.disabled = true;
    save.textContent = 'Saving…';

    let error = null;
    if (editing) {
      const result = await client
        .from('pharmacy_items')
        .update({
          name,
          strength: strength || null,
          form,
          unit,
          low_stock_threshold: threshold,
          expires_on: expires || null,
          notes: notes || null
        })
        .eq('id', editing.id)
        .select('id');
      error = result.error || (result.data && result.data.length ? null : { message: 'Only the circle owner can do that.' });
    } else {
      const result = await client.rpc('create_pharmacy_item', {
        p_circle: circleId,
        p_name: name,
        p_strength: strength,
        p_form: form,
        p_unit: unit,
        p_stock: stock,
        p_threshold: threshold,
        p_expires: expires || null,
        p_notes: notes
      });
      error = result.error;
    }

    save.disabled = false;
    save.textContent = label;

    if (error) {
      console.error('Could not save medicine:', error);
      const duplicate = (error.code === '23505') || (error.message || '').includes('already in the pharmacy');
      return itemError(duplicate ? 'That medicine is already in the pharmacy.' : Rx.friendly(error));
    }

    itemDialog.close();
    await loadItems(true);
  }

  /* ---------- Adjust stock dialog ---------- */

  const stockDialog = document.getElementById('stock-dialog');
  const stockForm = document.getElementById('stock-form');
  let stockItem = null;
  let stockMode = 'add';

  function stockError(text) {
    document.getElementById('stock-error').textContent = text;
  }

  function previewStock() {
    const amount = parseFloat(document.getElementById('stock-amount').value);
    const preview = document.getElementById('stock-preview');
    const current = Number(stockItem.stock);

    if (!(amount >= 0)) {
      preview.textContent = '';
      return;
    }
    const next = stockMode === 'add' ? current + amount : stockMode === 'remove' ? current - amount : amount;
    preview.textContent = next < 0
      ? 'That’s more than the current stock.'
      : 'New stock: ' + Rx.quantity(next, stockItem.unit);
  }

  function setStockMode(mode) {
    stockMode = mode;
    ['add', 'remove', 'set'].forEach(m => {
      const tab = document.getElementById('stock-tab-' + m);
      tab.setAttribute('aria-selected', String(m === mode));
      tab.tabIndex = m === mode ? 0 : -1;
    });

    document.getElementById('stock-amount-label').textContent =
      mode === 'add' ? 'How much to add' : mode === 'remove' ? 'How much to remove' : 'Correct count';
    document.getElementById('stock-reason-field').hidden = mode !== 'remove';
    document.getElementById('stock-note-label').firstChild.textContent =
      mode === 'set' ? 'Why are you correcting it? ' : 'Note ';
    document.getElementById('stock-note-opt').hidden = mode === 'set';
    document.getElementById('stock-save').textContent =
      mode === 'add' ? 'Add stock' : mode === 'remove' ? 'Remove stock' : 'Set count';

    stockError('');
    previewStock();
  }

  function openStock(item) {
    stockItem = item;
    stockForm.reset();
    document.getElementById('stock-name').textContent = Rx.medicineName(item);
    document.getElementById('stock-current').textContent = 'Currently ' + Rx.quantity(item.stock, item.unit);
    document.getElementById('stock-unit').textContent = item.unit;
    setStockMode('add');
    stockDialog.showModal();
    document.getElementById('stock-amount').focus();
  }

  async function submitStock(e) {
    e.preventDefault();
    stockError('');

    const amount = parseFloat(document.getElementById('stock-amount').value);
    const note = document.getElementById('stock-note').value.trim();
    const reason = document.getElementById('stock-reason').value;

    if (!(amount >= 0) || (stockMode !== 'set' && amount === 0)) {
      return stockError(stockMode === 'set' ? 'Enter the correct count.' : 'Enter an amount greater than 0.');
    }
    if (stockMode === 'remove' && amount > Number(stockItem.stock)) {
      return stockError('You can’t remove more than the current stock.');
    }
    if (stockMode === 'set' && !note) return stockError('Add a short note explaining the correction.');

    const save = document.getElementById('stock-save');
    const label = save.textContent;
    save.disabled = true;
    save.textContent = 'Saving…';

    const { error } = await client.rpc('adjust_pharmacy_stock', {
      p_item: stockItem.id,
      p_mode: stockMode,
      p_amount: amount,
      p_reason: stockMode === 'remove' ? reason : null,
      p_note: note || null
    });

    save.disabled = false;
    save.textContent = label;

    if (error) {
      console.error('Could not change stock:', error);
      return stockError(Rx.friendly(error));
    }

    stockDialog.close();
    await loadItems(true);
  }

  /* ---------- History dialog ---------- */

  const historyDialog = document.getElementById('history-dialog');

  function movementText(move) {
    const who = move.created_by_name;
    const note = move.note ? ' (' + move.note + ')' : '';
    switch (move.reason) {
      case 'initial': return who + ' added this medicine to the pharmacy';
      case 'dose': return who + ' gave a dose' + note;
      case 'undo': return who + ' undid a dose';
      case 'restock': return who + ' added stock' + note;
      case 'correction': return who + ' corrected the count' + note;
      case 'expired': return who + ' removed expired stock' + note;
      case 'discarded': return who + ' discarded stock' + note;
      default: return who + ' removed stock' + note;
    }
  }

  async function openHistory(item) {
    document.getElementById('history-name').textContent = Rx.medicineName(item);
    const list = document.getElementById('history-list');
    list.replaceChildren(el('p', 'rx-note', 'Loading…'));
    historyDialog.showModal();

    const { data, error } = await client
      .from('stock_movements')
      .select('id, change, balance_after, reason, note, created_by_name, created_at')
      .eq('item_id', item.id)
      .order('created_at', { ascending: false })
      .limit(60);

    list.replaceChildren();
    if (error) {
      console.error('Could not load history:', error);
      list.appendChild(el('p', 'rx-note is-error', Rx.friendly(error)));
      return;
    }
    if (!data.length) {
      list.appendChild(el('p', 'rx-note', 'No stock changes yet.'));
      return;
    }

    data.forEach(move => {
      const row = el('div', 'rx-move');
      const text = el('div');
      text.appendChild(el('p', 'rx-name', movementText(move)));
      text.appendChild(el('p', 'rx-sub', Rx.formatStamp(move.created_at)));

      const change = Number(move.change);
      const numbers = el('div', 'rx-move-nums');
      numbers.appendChild(el('strong', change > 0 ? 'is-up' : change < 0 ? 'is-down' : '',
        (change > 0 ? '+' : '') + Rx.number(change)));
      numbers.appendChild(el('span', '', Rx.number(move.balance_after) + ' left'));

      row.append(text, numbers);
      list.appendChild(row);
    });
  }

  /* ---------- Wiring ---------- */

  function wireDialog(dialog, closeIds) {
    closeIds.forEach(id => document.getElementById(id).addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', e => {
      if (e.target === dialog) dialog.close();
    });
  }

  wireDialog(itemDialog, ['item-close', 'item-cancel']);
  wireDialog(stockDialog, ['stock-close', 'stock-cancel']);
  wireDialog(historyDialog, ['history-close', 'history-done']);

  itemForm.addEventListener('submit', submitItem);
  stockForm.addEventListener('submit', submitStock);

  // Picking a form suggests its usual unit (unless the unit was changed by hand)
  document.getElementById('item-form-type').addEventListener('change', e => {
    const unitSelect = document.getElementById('item-unit');
    const suggested = (Rx.FORMS.find(f => f.value === e.target.value) || {}).unit;
    if (suggested && unitSelect.value === lastAutoUnit) {
      unitSelect.value = suggested;
      lastAutoUnit = suggested;
    }
  });

  ['add', 'remove', 'set'].forEach(mode => {
    document.getElementById('stock-tab-' + mode).addEventListener('click', () => setStockMode(mode));
  });
  document.getElementById('stock-amount').addEventListener('input', previewStock);

  load();
})();