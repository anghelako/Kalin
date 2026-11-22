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

  /* ---------- AI log, handoff brief and care notes ---------- */

  const KIND_LABEL = { handoff_brief: 'Handoff brief', summary: 'Summary' };

  let aiEntries = [];
  let aiState = 'loading'; // 'loading' | 'ready' | 'error'
  let aiError = '';
  let aiBusy = false;
  let aiListEl = null;
  let aiStatusEl = null;
  let aiStatusTimer = null;
  let generateBtn = null;
  let addNoteBtn = null;

  const handoffBtn = document.getElementById('handoff');

  function formatDateTime(value) {
    const d = new Date(value);
    return isNaN(d)
      ? ''
      : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function setAiBusy(busy) {
    aiBusy = busy;
    if (generateBtn) {
      generateBtn.disabled = busy;
      generateBtn.textContent = busy ? 'Generating…' : 'Generate summary';
    }
    if (handoffBtn) handoffBtn.disabled = busy;
  }

  function flashStatus(text, isError) {
    if (!aiStatusEl) return;
    clearTimeout(aiStatusTimer);
    aiStatusEl.textContent = text;
    aiStatusEl.classList.toggle('is-error', !!isError);
    if (text && !isError) aiStatusTimer = setTimeout(() => { aiStatusEl.textContent = ''; }, 3500);
  }

  // Turns an Edge Function failure into a message that is safe to show
  async function functionErrorMessage(error) {
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body && body.error) return String(body.error);
      }
    } catch (_) {
      // fall through to the generic messages
    }
    if (error.name === 'FunctionsFetchError') {
      return 'Couldn’t reach the AI service. Check your connection, and that the handoff-brief function is deployed.';
    }
    return 'Something went wrong. Please try again.';
  }

  async function requestAi(kind) {
    const { data, error } = await client.functions.invoke('handoff-brief', {
      body: { circle_id: thisCircle.id, kind }
    });
    if (error) {
      console.error('AI request failed:', error);
      return { error: await functionErrorMessage(error) };
    }
    if (!data || !data.body) return { error: 'The AI did not return anything. Please try again.' };

    aiEntries.unshift({ id: data.id, kind, body: data.body, created_at: data.created_at });
    aiState = 'ready';
    renderAiList();
    return { entry: data };
  }

  function renderAiList() {
    if (!aiListEl) return;
    aiListEl.replaceChildren();

    if (aiState === 'loading') {
      aiListEl.appendChild(el('p', 'empty', 'Loading…'));
      return;
    }
    if (aiState === 'error') {
      aiListEl.appendChild(el('p', 'empty', aiError));
      return;
    }
    if (!aiEntries.length) {
      aiListEl.appendChild(el('p', 'empty', 'No summaries yet'));
      return;
    }

    const list = el('ul', 'ai-entries');
    aiEntries.forEach(entry => {
      const item = el('li', 'ai-entry');
      const meta = el('div', 'ai-meta');
      meta.append(
        el('span', 'ai-kind', KIND_LABEL[entry.kind] || 'Summary'),
        el('span', '', formatDateTime(entry.created_at))
      );
      item.append(meta, el('div', 'ai-body', entry.body));
      list.appendChild(item);
    });
    aiListEl.appendChild(list);
  }

  async function loadAiLog() {
    aiState = 'loading';
    renderAiList();

    const { data, error } = await client
      .from('ai_log')
      .select('id, kind, body, created_at')
      .eq('circle_id', thisCircle.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Could not load AI log:', error);
      aiError = isMissingTable(error)
        ? 'The AI log tables don’t exist in Supabase yet. Run the care_notes / ai_log SQL first.'
        : 'Couldn’t load the AI log. Try refreshing the page.';
      aiState = 'error';
    } else {
      aiEntries = data;
      aiState = 'ready';
    }
    renderAiList();
  }

  function aiLogCard() {
    const { section, head } = card('Latest summary');
    section.classList.add('slot', 'slot-ai');

    const actions = el('div', 'panel-actions');

    addNoteBtn = el('button', 'btn-ghost small', 'Add note');
    addNoteBtn.type = 'button';
    addNoteBtn.addEventListener('click', openNote);

    generateBtn = el('button', 'btn-solid small', 'Generate summary');
    generateBtn.type = 'button';
    generateBtn.disabled = aiBusy;
    generateBtn.addEventListener('click', async () => {
      if (aiBusy) return;
      setAiBusy(true);
      flashStatus('');
      const result = await requestAi('summary');
      setAiBusy(false);
      if (result.error) flashStatus(result.error, true);
    });

    actions.append(addNoteBtn, generateBtn);
    head.appendChild(actions);

    aiStatusEl = el('p', 'ai-status');
    aiStatusEl.setAttribute('role', 'status');
    aiListEl = el('div', 'ai-list');
    section.append(aiStatusEl, aiListEl);

    renderAiList();
    return section;
  }

  /* ----- Handoff brief dialog ----- */

  const briefDialog = document.getElementById('brief-dialog');
  const briefStatus = document.getElementById('brief-status');
  const briefText = document.getElementById('brief-text');
  const briefCopy = document.getElementById('brief-copy');

  async function openBrief() {
    if (!thisCircle || aiBusy) return;

    briefText.textContent = '';
    briefStatus.textContent = 'Writing the handoff brief…';
    briefStatus.classList.remove('is-error');
    briefCopy.disabled = true;
    briefCopy.textContent = 'Copy';
    briefDialog.showModal();

    setAiBusy(true);
    const result = await requestAi('handoff_brief');
    setAiBusy(false);

    if (result.error) {
      briefStatus.textContent = result.error;
      briefStatus.classList.add('is-error');
      return;
    }
    briefStatus.textContent = '';
    briefText.textContent = result.entry.body;
    briefCopy.disabled = false;
  }

  if (handoffBtn) handoffBtn.addEventListener('click', openBrief);
  document.getElementById('brief-close').addEventListener('click', () => briefDialog.close());
  document.getElementById('brief-done').addEventListener('click', () => briefDialog.close());
  briefDialog.addEventListener('click', e => {
    if (e.target === briefDialog) briefDialog.close();
  });

  briefCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(briefText.textContent);
      briefCopy.textContent = 'Copied';
    } catch (_) {
      briefCopy.textContent = 'Select the text and copy';
    }
    setTimeout(() => { briefCopy.textContent = 'Copy'; }, 2000);
  });

  /* ----- Add care note dialog ----- */

  const noteDialog = document.getElementById('note-dialog');
  const noteForm = document.getElementById('note-form');
  const noteBody = document.getElementById('note-body');
  const noteError = document.getElementById('note-error');
  const noteSave = document.getElementById('note-save');

  function openNote() {
    noteForm.reset();
    noteError.textContent = '';
    noteDialog.showModal();
    noteBody.focus();
  }

  document.getElementById('note-close').addEventListener('click', () => noteDialog.close());
  document.getElementById('note-cancel').addEventListener('click', () => noteDialog.close());
  noteDialog.addEventListener('click', e => {
    if (e.target === noteDialog) noteDialog.close();
  });

  noteForm.addEventListener('submit', async e => {
    e.preventDefault();
    noteError.textContent = '';

    const body = noteBody.value.trim();
    if (!body) { noteError.textContent = 'Write a note first.'; return; }
    if (!thisCircle) return;

    noteSave.disabled = true;
    noteSave.textContent = 'Saving…';

    const { error } = await client
      .from('care_notes')
      .insert({ circle_id: thisCircle.id, body });

    noteSave.disabled = false;
    noteSave.textContent = 'Save note';

    if (error) {
      console.error('Could not save note:', error);
      noteError.textContent = isMissingTable(error)
        ? 'The care_notes table doesn’t exist in Supabase yet. Run the SQL setup first.'
        : error.message;
      return;
    }

    noteDialog.close();
    flashStatus('Note saved.');
  });

  /* ---------- Shifts: who's on duty + volunteering board ---------- */

  const SLOT_INFO = {
    morning: { name: 'Morning shift', time: '7:00 AM – 3:00 PM', from: 7, to: 15, order: 0 },
    evening: { name: 'Evening shift', time: '3:00 PM – 10:00 PM', from: 15, to: 22, order: 1 }
  };
  const BOARD_DAYS = 14;

  let dutyDot = null;
  let dutyText = null;
  let dutyProgress = null;
  let dutyHours = null;
  let boardListEl = null;
  let boardStatusEl = null;
  let boardTimer = null;
  let boardBusy = false;

  function localYmd(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function currentSlot(now) {
    const hour = now.getHours() + now.getMinutes() / 60;
    return Object.keys(SLOT_INFO).find(key => hour >= SLOT_INFO[key].from && hour < SLOT_INFO[key].to) || null;
  }

  function nameOf(row) {
    if (row.assigned_to && currentUser && row.assigned_to === currentUser.id) {
      const meta = currentUser.user_metadata || {};
      const full = (meta.full_name || meta.name || (currentUser.email || '').split('@')[0] || 'You').trim();
      return full + ' (you)';
    }
    return (row.profiles && row.profiles.full_name) || 'Member';
  }

  function setDuty(name, slot, now) {
    if (!dutyText || !dutyDot) return;
    dutyText.textContent = name || 'No one assigned';
    dutyDot.classList.toggle('on', !!name);
    const shift = name && SLOT_INFO[slot];
    dutyProgress.hidden = !shift;
    dutyHours.hidden = !shift;
    if (shift) {
      dutyProgress.max = (shift.to - shift.from) * 60;
      dutyProgress.value = (now.getHours() - shift.from) * 60 + now.getMinutes();
      dutyHours.textContent = shift.time;
    }
  }

  async function loadDuty() {
    if (!thisCircle) return;
    const now = new Date();
    const slot = currentSlot(now);
    if (!slot) { setDuty(null); return; }

    const { data, error } = await client
      .from('shifts')
      .select('assigned_to, profiles:assigned_to(full_name)')
      .eq('circle_id', thisCircle.id)
      .eq('shift_date', localYmd(now))
      .eq('slot', slot)
      .not('assigned_to', 'is', null)
      .limit(1);

    if (error) {
      console.error('Could not load who is on duty:', error);
      return; // keep whatever is shown rather than claiming no one is on duty
    }
    setDuty(data && data.length ? nameOf(data[0]) : null, slot, now);
  }

  function boardStatus(text, isError) {
    if (!boardStatusEl) return;
    clearTimeout(boardTimer);
    boardStatusEl.textContent = text || '';
    boardStatusEl.classList.toggle('is-error', !!isError);
    if (text && !isError) boardTimer = setTimeout(() => { boardStatusEl.textContent = ''; }, 3500);
  }

  function boardDayLabel(value) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  async function volunteerFor(shiftId) {
    if (boardBusy) return;
    boardBusy = true;
    boardStatus('');
    renderBoard(boardRows, true);

    const { error } = await client.rpc('claim_shift', { shift_id: shiftId });
    boardBusy = false;

    if (error) {
      console.error('Could not volunteer:', error);
      boardStatus(
        error.code === 'P0001' && error.message ? error.message : 'Something went wrong. Please try again.',
        true
      );
    } else {
      boardStatus('You volunteered for this shift.');
    }
    await loadBoard();
    loadDuty();
  }

  let boardRows = [];
  let boardState = 'loading';
  let boardError = '';

  function renderBoard(rows, disabled) {
    if (!boardListEl) return;
    boardListEl.replaceChildren();

    if (boardState === 'loading') { boardListEl.appendChild(el('p', 'empty', 'Loading…')); return; }
    if (boardState === 'error') { boardListEl.appendChild(el('p', 'empty', boardError)); return; }
    if (!rows.length) {
      boardListEl.appendChild(el('p', 'empty', 'No open shifts in the next two weeks.'));
      return;
    }

    const list = el('ul', 'board-list');
    rows.forEach(row => {
      const info = SLOT_INFO[row.slot];
      const item = el('li', 'board-item');

      const text = el('div', 'board-text');
      text.append(
        el('strong', '', boardDayLabel(row.shift_date)),
        el('span', 'muted', info.name + ' · ' + info.time)
      );

      const button = el('button', 'btn-solid small', 'Volunteer');
      button.type = 'button';
      button.disabled = !!disabled;
      button.addEventListener('click', () => volunteerFor(row.id));

      item.append(text, button);
      list.appendChild(item);
    });
    boardListEl.appendChild(list);
  }

  async function loadBoard() {
    if (!thisCircle) return;
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + BOARD_DAYS - 1);

    const { data, error } = await client
      .from('shifts')
      .select('id, shift_date, slot')
      .eq('circle_id', thisCircle.id)
      .is('assigned_to', null)
      .gte('shift_date', localYmd(start))
      .lte('shift_date', localYmd(end))
      .order('shift_date', { ascending: true });

    if (error) {
      console.error('Could not load open shifts:', error);
      boardError = isMissingTable(error)
        ? 'The shift tables don’t exist in Supabase yet. Run shifts_setup.sql first.'
        : 'Couldn’t load open shifts. Try refreshing the page.';
      boardState = 'error';
    } else {
      boardRows = data.slice().sort((a, b) =>
        a.shift_date === b.shift_date
          ? SLOT_INFO[a.slot].order - SLOT_INFO[b.slot].order
          : (a.shift_date < b.shift_date ? -1 : 1)
      );
      boardState = 'ready';
    }
    renderBoard(boardRows, false);
  }

  function boardCard() {
    const { section, head } = card('Open shifts', 'Next two weeks');
    section.classList.add('slot', 'slot-board');

    const calendarLink = el('a', 'btn-ghost small link-btn', 'Calendar');
    calendarLink.href = 'calendar.html';
    head.appendChild(calendarLink);

    boardStatusEl = el('p', 'ai-status');
    boardStatusEl.setAttribute('role', 'status');
    boardListEl = el('div', 'ai-list');
    section.append(boardStatusEl, boardListEl);

    renderBoard(boardRows, false);
    return section;
  }

  /* ---------- Placeholder sections (not connected yet) ---------- */

  function placeholder(cls, title, text) {
    const { section } = card(title, text);
    section.classList.add('slot', cls);
    section.appendChild(el('p', 'empty', 'Coming soon'));
    return section;
  }

  /* The real Medication panel (js/medication.js); falls back to the placeholder if that script is missing */
  function medicationSlot() {
    if (window.KalinMedication) return window.KalinMedication.card(thisCircle, isOwner());
    return placeholder('slot-meds', 'Today’s medication', 'Doses and schedules');
  }

  function circleGrid() {
    const grid = el('div', 'circle-slots');
    const todo = card('To do');
    window.KalinTodo.mount(todo, thisCircle, currentUser.id);
    grid.append(
      todo.section,
      aiLogCard(),
      medicationSlot(),
      boardCard()
    );
    return grid;
  }

  /* ---------- Invite code (owner only) ---------- */

  let inviteSlot = null;

  async function fillInvite() {
    if (!inviteSlot) return;

    if (!thisCircle.invite_code) {
      const { data, error } = await client
        .from('circles')
        .select('invite_code')
        .eq('id', thisCircle.id)
        .maybeSingle();

      if (error || !data || !data.invite_code) {
        // Invite codes aren't set up yet (circles_join_setup.sql not run)
        console.warn('Invite code not available:', error);
        inviteSlot.hidden = true;
        return;
      }
      thisCircle.invite_code = data.invite_code;
    }

    inviteSlot.replaceChildren(
      el('span', 'invite-label', 'Invite code'),
      codeChip(thisCircle),
      el('span', 'invite-hint', 'Share it with people you want to add. You’ll approve each request from Home.')
    );
  }

  function headerCard() {
    const section = el('section', 'circle-hero');
    if (isOwner()) section.appendChild(settingsMenu());

    const shift = el('div', 'hero-shift');
    shift.appendChild(el('h2', 'hero-duty-label', 'On duty now'));

    const duty = el('div', 'duty');
    dutyDot = el('span', 'duty-dot');
    dutyDot.setAttribute('aria-hidden', 'true');
    dutyText = el('span', '', 'No one assigned');
    duty.append(dutyDot, dutyText);
    dutyProgress = el('progress', 'hero-progress');
    dutyProgress.setAttribute('aria-label', 'Current shift progress');
    dutyProgress.hidden = true;
    dutyHours = el('p', 'hero-hours');
    dutyHours.hidden = true;
    shift.append(duty, dutyProgress, dutyHours);

    const row = el('div', 'hero-row');
    row.appendChild(shift);
    if (handoffBtn) row.appendChild(handoffBtn);
    section.appendChild(row);

    if (isOwner()) {
      inviteSlot = el('div', 'invite-row');
      section.appendChild(inviteSlot);
      fillInvite();
    }
    return section;
  }

  function render() {
    document.title = thisCircle.name + '’s care circle · Kalin';
    const page = el('div', 'circle-layout');
    const heading = el('div', 'circle-heading');
    heading.appendChild(el('h1', 'hero-title', thisCircle.name + '’s care circle'));
    if (thisCircle.description) heading.appendChild(el('p', 'hero-desc', thisCircle.description));
    page.append(heading, headerCard(), circleGrid());
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
    try {
      window.localStorage.setItem('kalin.lastCircle', circleId);
    } catch (_) {
      // The current page remains usable without persistent storage.
    }
    document.querySelector('[data-circle-tab]').href = 'circle.html?id=' + encodeURIComponent(circleId);
    render();
    loadAiLog();
    loadDuty();
    loadBoard();
    setInterval(loadDuty, 60000); // keep "on duty" current across shift changes
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
