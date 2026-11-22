/* Pharmacy list, using the shared circle memberships and inventory rules. */
(function () {
  const Rx = KalinRx;
  const grid = document.getElementById('phl-grid');
  const summary = document.getElementById('phl-summary');
  const notice = document.getElementById('phl-notice');
  let loadVersion = 0;

  function statusByCircle(items) {
    const statuses = new Map();
    const today = Rx.todayISO();
    for (const item of items) {
      if (!statuses.has(item.circle_id)) {
        statuses.set(item.circle_id, { out: 0, expired: 0, low: 0, soon: 0 });
      }
      const counts = statuses.get(item.circle_id);
      const stock = Rx.stockState(item);
      const expiry = Rx.expiryState(item, today);
      if (stock !== 'ok') counts[stock]++;
      if (expiry) counts[expiry]++;
    }
    return statuses;
  }

  function statusChips(counts) {
    if (!counts) return [Rx.chip('No medicines yet', 'inactive')];
    const problems = [
      ['out', 'out of stock'], ['expired', 'expired'], ['low', 'low stock'], ['soon', 'expiring soon']
    ].filter(([kind]) => counts[kind]);
    return problems.length
      ? problems.slice(0, 2).map(([kind, label]) => Rx.chip(counts[kind] + ' ' + label, kind))
      : [Rx.chip('All stocked', 'ok')];
  }

  function pharmacyCard(circle, statuses) {
    const card = el('article', 'crc-card phl-card');
    const avatar = el('span', 'crc-avatar', initialOf(circle.name));
    avatar.style.backgroundColor = colorFor(circle);
    avatar.setAttribute('aria-hidden', 'true');
    const chips = el('div', 'phl-chips');
    if (statuses) chips.append(...statusChips(statuses.get(circle.id)));
    const open = el('a', 'btn-solid link-btn crc-open', 'Open');
    open.href = 'pharmacy.html?id=' + encodeURIComponent(circle.id) + '&from=list';
    open.setAttribute('aria-label', 'Open pharmacy for ' + circle.name);
    card.append(avatar, el('h2', '', circle.name), chips, open);
    return card;
  }

  function action(label, primary, handle) {
    const button = el('button', primary ? 'btn-create' : 'btn-ghost', label);
    button.type = 'button';
    button.addEventListener('click', handle);
    return button;
  }

  function showState(title, description, ...buttons) {
    const card = el('section', 'crc-card crc-state');
    const actions = el('div', 'top-actions');
    actions.append(...buttons);
    card.append(el('h2', '', title));
    if (description) card.append(el('p', 'phl-summary', description));
    card.append(actions);
    grid.replaceChildren(card);
  }

  async function render() {
    const version = ++loadVersion;
    const loading = circlesState === 'loading';
    grid.setAttribute('aria-busy', String(loading));
    notice.hidden = true;
    if (loading) {
      summary.textContent = 'Loading pharmacies…';
      grid.replaceChildren(...Array.from({ length: 3 }, () => {
        const skeleton = el('div', 'crc-card crc-skeleton');
        skeleton.setAttribute('aria-hidden', 'true');
        return skeleton;
      }));
      return;
    }
    if (circlesState === 'error') {
      summary.textContent = '';
      showState('Couldn’t load the pharmacies', '', action('Try again', true, () => {
        loadCircles();
        render();
      }));
      return;
    }

    const joined = circles.slice();
    summary.textContent = joined.length + (joined.length === 1 ? ' circle' : ' circles');
    if (!joined.length) {
      showState('No care circles yet', 'Join or create a circle to use its pharmacy',
        action('Join with code', false, () => openCircleDialog('join')),
        action('Create circle', true, () => openCircleDialog('create')));
      return;
    }

    grid.setAttribute('aria-busy', 'true');
    const user = await window.kalinReady;
    if (!user || version !== loadVersion) return;
    let statuses;
    try {
      const { data, error } = await client.from('pharmacy_items')
        .select('circle_id, stock, low_stock_threshold, expires_on')
        .in('circle_id', joined.map(circle => circle.id))
        .eq('is_active', true);
      if (error) throw error;
      statuses = statusByCircle(data);
    } catch (error) {
      if (version !== loadVersion) return;
      notice.textContent = Rx.isMissing(error)
        ? 'The pharmacy isn’t set up yet.'
        : Rx.friendly(error, 'Couldn’t load pharmacy status.');
      notice.hidden = false;
    }
    if (version !== loadVersion) return;
    grid.replaceChildren(...joined.map(circle => pharmacyCard(circle, statuses)));
    grid.setAttribute('aria-busy', 'false');
  }

  window.addEventListener('kalin:circles', render);
  render();
})();
