/* All circles, using the shared membership and join-request data. */
(function () {
  const grid = document.getElementById('crc-grid');
  const summary = document.getElementById('crc-summary');
  const dutyLines = new Map();
  let dutyLoad = 0;

  function roleChip(label, pathData) {
    const chip = el('span', 'crc-chip');
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    const path = document.createElementNS(namespace, 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    chip.append(svg, label);
    return chip;
  }

  function circleTile(name, color) {
    const card = el('article', 'crc-card');
    const avatar = el('span', 'crc-avatar', initialOf(name));
    avatar.setAttribute('aria-hidden', 'true');
    if (color) avatar.style.backgroundColor = color;
    card.append(avatar, el('h2', '', name));
    return card;
  }

  function joinedTile(circle) {
    const card = circleTile(circle.name, colorFor(circle));
    const owner = circle.role === 'owner';
    const role = roleChip(owner ? 'Owner' : 'Member', owner
      ? 'M12 22s7-4 7-11V5l-7-3-7 3v6c0 7 7 11 7 11z'
      : 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z');

    const duty = el('p', 'crc-duty');
    const dot = el('span', 'crc-duty-dot');
    const label = el('span');
    duty.append(dot, label);
    duty.hidden = true;
    dutyLines.set(circle.id, { duty, dot, label });

    const open = el('a', 'btn-ghost link-btn crc-open', 'Open');
    open.href = 'circle.html?id=' + encodeURIComponent(circle.id);
    open.setAttribute('aria-label', 'Open ' + circle.name);
    card.append(role, duty, open);
    return card;
  }

  function pendingTile(request) {
    const card = circleTile(request.circle_name);
    card.classList.add('crc-pending');
    card.appendChild(roleChip('Waiting for approval',
      'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM12 6v6l4 2'));
    return card;
  }

  function stateCard(title, actions) {
    const card = el('section', 'crc-card crc-state');
    const controls = el('div', 'top-actions');
    actions.forEach(({ label, primary, handle }) => {
      const button = el('button', primary ? 'btn-create' : 'btn-ghost', label);
      button.type = 'button';
      button.addEventListener('click', handle);
      controls.appendChild(button);
    });
    card.append(el('h2', '', title), controls);
    return card;
  }

  async function refreshDuty() {
    const load = ++dutyLoad;
    if (!dutyLines.size) return;
    const user = await window.kalinReady;
    if (!user || load !== dutyLoad) return;
    const now = KalinTime.now();
    let rows = [];
    try {
      const { data, error } = await client.from('shifts')
        .select('circle_id, shift_date, starts_at, ends_at, assigned_to, assigned_name, profiles:assigned_to(full_name)')
        .in('circle_id', [...dutyLines.keys()])
        .gte('shift_date', KalinTime.addDays(KalinRx.todayISO(now), -1)) // a night shift can have started yesterday
        .lte('shift_date', KalinRx.todayISO(now))
        .not('assigned_to', 'is', null);
      if (error) throw error;
      rows = data.filter(row => KalinTime.isOnDuty(row, now));
    } catch (_) {
      if (load === dutyLoad) dutyLines.forEach(({ duty }) => { duty.hidden = true; });
      return;
    }
    if (load !== dutyLoad) return;
    const names = new Map(rows.map(row => [
      row.circle_id, (row.assigned_name || row.profiles?.full_name)?.trim().split(/\s+/)[0] || 'Member'
    ]));
    dutyLines.forEach(({ duty, dot, label }, circleId) => {
      const name = names.get(circleId);
      label.textContent = name ? 'On duty: ' + name : 'No one on duty';
      dot.classList.toggle('on', Boolean(name));
      duty.hidden = false;
    });
  }

  function render() {
    dutyLoad++;
    dutyLines.clear();
    grid.setAttribute('aria-busy', String(circlesState === 'loading'));
    if (circlesState === 'loading') {
      summary.textContent = 'Loading circles…';
      grid.replaceChildren(...Array.from({ length: 3 }, () => {
        const skeleton = el('div', 'crc-card crc-skeleton');
        skeleton.setAttribute('aria-hidden', 'true');
        return skeleton;
      }));
      return;
    }
    if (circlesState === 'error') {
      summary.textContent = '';
      grid.replaceChildren(stateCard('Couldn’t load your circles', [{
        label: 'Try again',
        primary: true,
        handle: () => { loadCircles(); render(); }
      }]));
      return;
    }

    summary.textContent = circles.length + (circles.length === 1 ? ' circle' : ' circles') +
      (myRequests.length ? ' · ' + myRequests.length + ' waiting' : '');
    if (!circles.length && !myRequests.length) {
      grid.replaceChildren(stateCard('No care circles yet', [
        { label: 'Create circle', primary: true, handle: () => document.getElementById('create-circle').click() },
        { label: 'Join with code', handle: () => document.getElementById('join-circle').click() }
      ]));
      return;
    }

    grid.replaceChildren(...circles.map(joinedTile), ...myRequests.map(pendingTile));
    refreshDuty();
  }

  window.addEventListener('kalin:circles', render);
  render();
  window.kalinReady.then(user => {
    if (user) KalinTime.onMinute(refreshDuty);
  });
})();
