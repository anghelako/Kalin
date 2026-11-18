/* Kalin circle page. Runs after dashboard.js, which provides: client, currentUser,
   el(), colorFor(), loadCircles(), window.kalinReady and the sidebar. */
(function () {
  const root = document.getElementById('circle-root');
  const titleEl = document.getElementById('circle-title');
  const subEl = document.getElementById('circle-sub');
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

  function render() {
    document.title = thisCircle.name + '’s care circle · Kalin';
    titleEl.textContent = thisCircle.name + '’s care circle';
    subEl.textContent = thisCircle.description || '';
    subEl.hidden = !thisCircle.description;

    root.replaceChildren();
    const grid = el('div', 'circle-page-grid');
    grid.append(dutyCard(), weekCard(), membersCard());
    if (isOwner()) grid.appendChild(settingsCard());
    root.appendChild(grid);
  }

  /* ---------- Load ---------- */

  async function load() {
    const user = await window.kalinReady;
    if (!user || !client) return;

    if (!circleId) {
      titleEl.textContent = 'Circle not found';
      return showMessage('No circle selected', 'Pick a circle from the sidebar or the Home page.', true);
    }

    const { data, error } = await client
      .from('circles')
      .select('id, name, description, created_by, created_at, is_active, circle_members(user_id, role, joined_at)')
      .eq('id', circleId)
      .maybeSingle();

    if (error) {
      console.error('Could not load circle:', error);
      titleEl.textContent = 'Something went wrong';
      return showMessage('Couldn’t load this circle', 'Check your connection and refresh the page.', true);
    }
    if (!data) {
      titleEl.textContent = 'Circle not found';
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