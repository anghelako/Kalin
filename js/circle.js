/* Kalin circle page. Runs after dashboard.js, which provides: client, currentUser,
   el(), colorFor(), loadCircles(), window.kalinReady and the sidebar. */
(function () {
  const root = document.getElementById('circle-root');
  const circleId = new URLSearchParams(window.location.search).get('id');

  let thisCircle = null; // { id, name, description, created_by, created_at, circle_members: [...] }

  function formatDate(value) {
    const d = new Date(value);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isOwner() {
    return !!(currentUser && thisCircle && thisCircle.created_by === currentUser.id);
  }

  function showMessage(title, text, withHome) {
    root.replaceChildren();
    const box = el('div', 'page-state');
    box.append(el('h2', '', title), el('p', '', text));
    if (withHome) {
      const link = el('a', 'btn-solid link-btn', 'Back to Home');
      link.href = 'dashboard.html';
      box.appendChild(link);
    }
    root.appendChild(box);
  }

  /* ---------- Cards ---------- */

  function card(title, subtitle) {
    const section = el('section', 'panel');
    const head = el('header', 'panel-head');
    const text = el('div');
    text.appendChild(el('h2', '', title));
    if (subtitle) text.appendChild(el('p', 'widget-sub', subtitle));
    head.appendChild(text);
    section.appendChild(head);
    return { section, head };
  }

  function linkButton(label, href) {
    const a = el('a', 'btn-ghost link-btn', label);
    a.href = href;
    return a;
  }

  function dutyCard() {
    const { section } = card('On duty now', 'Who is looking after this person right now');
    const row = el('div', 'duty-row');
    const dot = el('span', 'duty-dot big');
    const text = el('div');
    text.append(el('strong', '', 'No one assigned'), el('p', 'muted', 'Shifts aren’t connected yet.'));
    row.append(dot, text);
    section.append(row, linkButton('Open calendar', 'calendar.html'));
    return section;
  }

  function weekCard() {
    const { section } = card('This week', 'Upcoming shifts for this circle');
    section.appendChild(el('p', 'empty', 'No shifts scheduled yet.'));
    section.appendChild(linkButton('Open calendar', 'calendar.html'));
    return section;
  }

  function memberName(member) {
    if (currentUser && member.user_id === currentUser.id) {
      const meta = currentUser.user_metadata || {};
      const full = (meta.full_name || meta.name || (currentUser.email || '').split('@')[0] || 'You').trim();
      return full + ' (you)';
    }
    // Other members' names need a profiles table; until then show a neutral label
    return 'Member';
  }

  function memberRow(member) {
    const li = el('li', 'member');
    const name = memberName(member);

    const avatar = el('span', 'member-avatar', name.charAt(0).toUpperCase());
    avatar.style.background = colorFor({ id: member.user_id });

    const info = el('div', 'member-info');
    info.append(el('strong', '', name), el('span', 'muted', 'Joined ' + formatDate(member.joined_at)));

    li.append(avatar, info);
    if (member.role === 'owner') li.appendChild(el('span', 'tag-owner', 'Owner'));
    return li;
  }

  function membersCard() {
    const members = (thisCircle.circle_members || []).slice().sort((a, b) => {
      if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
      return new Date(a.joined_at) - new Date(b.joined_at);
    });

    const { section, head } = card('Members', members.length === 1 ? '1 person in this circle' : members.length + ' people in this circle');

    const invite = el('button', 'btn-ghost small', 'Invite');
    invite.type = 'button';
    invite.disabled = true;
    invite.title = 'Invites are not connected yet';
    head.appendChild(invite);

    const list = el('ul', 'member-list');
    members.forEach(m => list.appendChild(memberRow(m)));
    section.appendChild(list);
    return section;
  }

  function settingsCard() {
    const { section } = card('Circle settings', 'Only the owner can change these');

    const actions = el('div', 'settings-actions');

    const edit = el('button', 'btn-ghost', 'Edit details');
    edit.type = 'button';
    edit.addEventListener('click', openEdit);

    const del = el('button', 'btn-danger', 'Delete circle');
    del.type = 'button';
    del.addEventListener('click', deleteCircle);

    actions.append(edit, del);
    section.appendChild(actions);
    return section;
  }

  /* ---------- Render ---------- */

  /* ---------- Header card: name, description, members, who's on duty ---------- */

  /* ---------- Settings menu (owner only; delete for now) ---------- */

  const ICON_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/></svg>';

  function settingsMenu() {
    const wrap = el('div', 'settings');

    const button = el('button', 'settings-btn');
    button.type = 'button';
    button.setAttribute('aria-label', 'Circle settings');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = ICON_GEAR;

    const menu = el('div', 'settings-menu');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    const del = el('button', 'settings-item danger');
    del.type = 'button';
    del.setAttribute('role', 'menuitem');
    del.innerHTML = ICON_TRASH;
    del.appendChild(el('span', '', 'Delete circle'));
    del.addEventListener('click', () => {
      setOpen(false);
      deleteCircle();
    });
    menu.appendChild(del);

    function setOpen(open) {
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    }

    button.addEventListener('click', e => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') setOpen(false);
    });

    wrap.append(button, menu);
    return wrap;
  }

  /* ---------- Placeholder sections (not connected yet) ---------- */

  function placeholder(cls, title, text) {
    const { section } = card(title, text);
    section.classList.add('slot', cls);
    section.appendChild(el('p', 'empty', 'Coming soon'));
    return section;
  }

  function placeholderGrid() {
    const grid = el('div', 'circle-slots');
    grid.append(
      placeholder('slot-todo', 'To do', 'Tasks for this circle'),
      placeholder('slot-ai', 'AI log', 'Summaries of recent activity'),
      placeholder('slot-meds', 'Medication', 'Doses and schedules'),
      placeholder('slot-board', 'Shift volunteering board', 'Open shifts members can pick up')
    );
    return grid;
  }

  function headerCard() {
    const section = el('section', 'circle-hero');
    if (isOwner()) section.appendChild(settingsMenu());

    const title = el('h1', 'hero-title', thisCircle.name + '’s care circle');
    section.appendChild(title);
    if (thisCircle.description) section.appendChild(el('p', 'hero-desc', thisCircle.description));

    // Who's on duty (placeholder until shifts are connected)
    const duty = el('div', 'duty');
    duty.append(el('span', 'duty-dot'), el('span', '', 'On duty: No one assigned'));
    section.appendChild(duty);
    return section;
  }

  function render() {
    document.title = thisCircle.name + '’s care circle · Kalin';
    const page = el('div', 'circle-layout');
    page.append(headerCard(), placeholderGrid());
    root.replaceChildren(page);
  }

  /* ---------- Load ---------- */

  async function load() {
    const user = await window.kalinReady;
    if (!user || !client) return;

    if (!circleId) {
      return showMessage('No circle selected', 'Pick a circle from the sidebar or the Home page.', true);
    }

    const { data, error } = await client
      .from('circles')
      .select('id, name, description, created_by, created_at, is_active, circle_members(user_id, role, joined_at)')
      .eq('id', circleId)
      .maybeSingle();

    if (error) {
      console.error('Could not load circle:', error);
      return showMessage('Couldn’t load this circle', 'Check your connection and refresh the page.', true);
    }
    if (!data) {
      return showMessage('Circle not found', 'It may have been deleted, or you may not be a member.', true);
    }

    thisCircle = data;
    render();
  }

  /* ---------- Edit dialog ---------- */

  const editDialog = document.getElementById('edit-dialog');
  const editForm = document.getElementById('edit-form');
  const editError = document.getElementById('edit-error');
  const editSave = document.getElementById('edit-save');

  function openEdit() {
    editError.textContent = '';
    document.getElementById('edit-name').value = thisCircle.name;
    document.getElementById('edit-desc').value = thisCircle.description || '';
    editDialog.showModal();
    document.getElementById('edit-name').focus();
  }

  document.getElementById('edit-close').addEventListener('click', () => editDialog.close());
  document.getElementById('edit-cancel').addEventListener('click', () => editDialog.close());
  editDialog.addEventListener('click', e => {
    if (e.target === editDialog) editDialog.close();
  });

  editForm.addEventListener('submit', async e => {
    e.preventDefault();
    editError.textContent = '';

    const name = document.getElementById('edit-name').value.trim();
    const description = document.getElementById('edit-desc').value.trim();
    if (!name) { editError.textContent = 'Give your circle a name.'; return; }

    editSave.disabled = true;
    editSave.textContent = 'Saving…';

    const { data, error } = await client
      .from('circles')
      .update({ name, description: description || null })
      .eq('id', thisCircle.id)
      .select('id, name, description')
      .maybeSingle();

    editSave.disabled = false;
    editSave.textContent = 'Save changes';

    if (error || !data) {
      console.error('Could not update circle:', error);
      editError.textContent = error ? error.message : 'You don’t have permission to change this circle.';
      return;
    }

    thisCircle.name = data.name;
    thisCircle.description = data.description;
    render();
    editDialog.close();
    loadCircles(); // refresh the sidebar list
  });

  /* ---------- Delete ---------- */

  async function deleteCircle() {
    const ok = window.confirm(
      'Delete “' + thisCircle.name + '’s care circle”? This removes the circle for everyone and cannot be undone.'
    );
    if (!ok) return;

    const { data, error } = await client
      .from('circles')
      .delete()
      .eq('id', thisCircle.id)
      .select('id');

    if (error || !data || !data.length) {
      console.error('Could not delete circle:', error);
      window.alert(error ? error.message : 'You don’t have permission to delete this circle.');
      return;
    }
    window.location.replace('dashboard.html');
  }

  load();
})();