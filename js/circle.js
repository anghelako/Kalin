/* Kalin circle page. Runs after dashboard.js, which provides: client, currentUser,
   el(), colorFor(), loadCircles(), window.kalinReady and the sidebar. */
(function () {
  const Time = KalinTime;
  const root = document.getElementById('circle-root');
  const circleId = new URLSearchParams(window.location.search).get('id');

  let thisCircle = null; // { id, name, description, created_by, created_at, circle_members: [...] }

  function formatDate(value) {
    const d = new Date(value);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: Time.zone
    });
  }

  function isOwner() {
    return !!(currentUser && thisCircle && thisCircle.created_by === currentUser.id);
  }

  function showMessage(title, text, withCirclesLink) {
    root.replaceChildren();
    const box = el('div', 'page-state');
    box.append(el('h2', '', title), el('p', '', text));
    if (withCirclesLink) {
      const link = el('a', 'btn-solid link-btn', 'All circles');
      link.href = 'circles.html';
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
      const full = meta.full_name?.trim() || meta.name?.trim() || 'Member';
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

  /* ---------- Settings menu ---------- */

  const ICON_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/></svg>';
  const ICON_LEAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3m9-8h7a2 2 0 012 2v12a2 2 0 01-2 2h-7"/></svg>';

  function settingsMenu(owner) {
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

    if (owner) {
      aiSettingBtn = el('button', 'settings-item');
      aiSettingBtn.type = 'button';
      aiSettingBtn.setAttribute('role', 'menuitem');
      aiSettingBtn.addEventListener('click', changeAiSetting);
      menu.appendChild(aiSettingBtn);
    }

    const action = el('button', 'settings-item danger');
    action.type = 'button';
    action.setAttribute('role', 'menuitem');
    action.innerHTML = owner ? ICON_TRASH : ICON_LEAVE;
    action.appendChild(el('span', '', owner ? 'Delete circle' : 'Leave circle'));
    action.addEventListener('click', () => {
      setOpen(false);
      if (owner) deleteCircle();
      else leaveCircle(button);
    });
    menu.appendChild(action);

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
  const AI_ERRORS = {
    unauthorized: 'Please sign in again.',
    ai_disabled: "AI drafts aren't available yet.",
    not_a_member: 'You no longer have access to this circle.',
    no_notes: 'Add a care note before requesting a draft.',
    preview_unavailable: 'Couldn’t load the preview. Try again.',
    preview_changed: 'The notes changed. Close this dialog and review a new preview.',
    invalid_request: 'Close this preview and try again.',
    body_too_large: 'The preview is too large to send.',
    cooldown: 'Wait a minute before requesting another draft for this circle.',
    daily_limit: 'You’ve reached today’s limit of 10 AI drafts.',
    provider_busy: 'The AI service is busy. Try again later.',
    provider_unavailable: 'The AI service is unavailable. Try again later.',
    timeout: 'The AI service took too long. Try again later.',
    unsafe_output: 'The draft could not be shown safely. Review the care notes instead.',
    save_failed: 'Couldn’t save the draft. Try again later.',
    origin_denied: 'This site is not allowed to use AI.',
    not_owner: 'Only the circle owner can change this setting.'
  };
  const aiMessage = code => Object.hasOwn(AI_ERRORS, code) ? AI_ERRORS[code] : 'AI is unavailable. Try again later.';

  let aiEntries = [];
  let aiState = 'loading'; // 'loading' | 'ready' | 'error'
  let aiError = '';
  let aiBusy = false;
  let aiListEl = null;
  let aiStatusEl = null;
  let aiStatusTimer = null;
  let generateBtn = null;
  let aiSettingBtn = null;
  let aiSettingBusy = false;
  let aiUnavailable = false;

  const handoffBtn = document.getElementById('handoff');
  const aiUnavailableKey = () => 'kalin.aiUnavailable.' + currentUser.id;

  function canGenerateAi() {
    return thisCircle?.ai_enabled === true && !aiUnavailable;
  }

  function formatDateTime(value) {
    const d = new Date(value);
    return isNaN(d)
      ? ''
      : d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: Time.zone
      });
  }

  function setAiBusy(busy) {
    aiBusy = busy;
    const hidden = !canGenerateAi();
    if (generateBtn) {
      generateBtn.hidden = hidden;
      generateBtn.disabled = busy || aiSettingBusy;
      generateBtn.textContent = busy ? 'Generating…' : 'Generate summary';
    }
    if (handoffBtn) {
      handoffBtn.hidden = hidden;
      handoffBtn.disabled = busy || aiSettingBusy;
    }
    if (aiSettingBtn) {
      aiSettingBtn.disabled = busy || aiSettingBusy;
      aiSettingBtn.textContent = thisCircle.ai_enabled ? 'Disable AI drafts' : 'Enable AI drafts';
    }
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
          if (body?.code === 'ai_disabled') {
            aiUnavailable = true;
            try {
              window.sessionStorage.setItem(aiUnavailableKey(), 'true');
            } catch {
              // The in-memory flag still applies when storage is unavailable.
            }
            setAiBusy(aiBusy);
            flashStatus(aiMessage(body.code), true);
          }
          if (body && Object.hasOwn(AI_ERRORS, body.code)) return aiMessage(body.code);
      }
    } catch (_) {
      // A gateway or network error may have no JSON body.
    }
    return aiMessage(error.context?.status === 401 ? 'unauthorized' : undefined);
  }

  async function requestAi(circle, kind, notes) {
    const { data, error } = await client.functions.invoke('handoff-brief', {
      body: { circle_id: circle, kind, notes }
    });
    if (error) return { error: await functionErrorMessage(error) };
    if (data?.verified_generation !== true || typeof data.body !== 'string' || !data.body) {
      return { error: aiMessage() };
    }

    aiEntries = [{ ...data, kind }, ...aiEntries.filter(entry => entry.id !== data.id)].slice(0, 20);
    aiState = 'ready';
    renderAiList();
    return { entry: data };
  }

  async function changeAiSetting() {
    if (!isOwner() || aiBusy || aiSettingBusy) return;
    const enabled = !thisCircle.ai_enabled;
    if (enabled && !window.confirm(
      'Allow this circle’s members to send reviewed, minimized care notes to Gemini for AI drafts? Enable only after getting consent for sharing.'
    )) return;

    aiSettingBusy = true;
    setAiBusy(false);
    try {
      const { data, error } = await client.rpc('set_circle_ai_enabled', {
        p_circle_id: thisCircle.id, p_enabled: enabled
      });
      if (error || data !== 'ok') {
        flashStatus(aiMessage(error ? undefined : data), true);
      } else {
        thisCircle.ai_enabled = enabled;
        if (aiUnavailable) flashStatus(aiMessage('ai_disabled'), true);
        else flashStatus(enabled ? 'AI drafts are enabled for this circle.' : 'AI drafts are disabled for this circle.');
      }
    } catch {
      flashStatus(aiMessage(), true);
    } finally {
      aiSettingBusy = false;
      setAiBusy(false);
    }
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
      item.appendChild(meta);
      if (entry.verified_generation) {
        item.append(el('p', 'hint', 'AI-generated draft. Not medical advice.'), el('div', 'ai-body', entry.body));
      } else {
        const history = document.createElement('details');
        history.append(el('summary', '', 'Unverified historical draft. Not medical advice.'), el('div', 'ai-body', entry.body));
        item.appendChild(history);
      }
      list.appendChild(item);
    });
    aiListEl.appendChild(list);
  }

  async function loadAiLog() {
    aiState = 'loading';
    renderAiList();

    const { data, error } = await client
      .from('ai_log')
      .select('id, kind, body, created_at, verified_generation')
      .eq('circle_id', thisCircle.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      aiError = 'Couldn’t load the AI log. Try refreshing the page.';
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

    const addNoteBtn = el('button', 'btn-ghost small', 'Add note');
    addNoteBtn.type = 'button';
    addNoteBtn.addEventListener('click', openNote);

    generateBtn = el('button', 'btn-solid small', 'Generate summary');
    generateBtn.type = 'button';
    generateBtn.addEventListener('click', () => openBrief('summary'));

    actions.append(addNoteBtn, generateBtn);
    setAiBusy(aiBusy);
    head.appendChild(actions);

    aiStatusEl = el('p', 'ai-status');
    aiStatusEl.setAttribute('role', 'status');
    if (aiUnavailable) flashStatus(aiMessage('ai_disabled'), true);
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
  const briefDone = document.getElementById('brief-done');
  const briefTitle = document.getElementById('brief-dialog-title');
  const briefPreview = el('div', 'handoff-preview');
  const briefSend = el('button', 'btn-solid', 'Send to AI');
  briefSend.type = 'button';
  briefSend.hidden = true;
  briefText.before(briefPreview);
  briefDone.before(briefSend);
  let activePreview = null;

  function previewError(code) {
    briefStatus.textContent = aiMessage(code);
    briefStatus.classList.add('is-error');
  }

  async function openBrief(kind) {
    if (!canGenerateAi() || aiBusy || aiSettingBusy || briefDialog.open) return;
    const session = { kind, circleId: thisCircle.id, notes: null };
    activePreview = session;
    briefTitle.textContent = KIND_LABEL[kind];
    briefText.textContent = '';
    briefPreview.replaceChildren();
    briefStatus.textContent = 'Loading preview…';
    briefStatus.classList.remove('is-error');
    briefCopy.disabled = true;
    briefCopy.hidden = true;
    briefCopy.textContent = 'Copy';
    briefDone.textContent = 'Cancel';
    briefSend.hidden = true;
    briefDialog.showModal();

    try {
      const { firstCharacters, loadHandoffNotes } = await import('../supabase/functions/_shared/handoff-content.mjs');
      const result = await loadHandoffNotes(client, session.circleId);
      if (activePreview !== session || !briefDialog.open) return;
      if (result.code) {
        previewError(result.code);
        return;
      }
      session.notes = result.notes;
      const count = result.notes.length;
      briefStatus.textContent = count + (count === 1 ? ' note will be sent to Gemini.' : ' notes will be sent to Gemini.');
      const list = el('ol', 'handoff-preview-notes');
      for (const note of result.notes) {
        const item = document.createElement('li');
        const date = el('time', '', note.date);
        date.dateTime = note.date;
        const excerpt = firstCharacters(note.text, 80);
        item.append(date, el('p', '', excerpt === note.text ? excerpt : excerpt + '…'));
        if (excerpt !== note.text) {
          const more = document.createElement('details');
          more.append(el('summary', '', 'Show full text to be sent'), el('p', '', note.text));
          item.appendChild(more);
        }
        list.appendChild(item);
      }
      briefPreview.replaceChildren(list);
      briefSend.hidden = false;
      briefDone.focus();
    } catch {
      if (activePreview === session && briefDialog.open) previewError('preview_unavailable');
    }
  }

  briefSend.addEventListener('click', async () => {
    const session = activePreview;
    if (!session?.notes || !canGenerateAi() || aiBusy || aiSettingBusy || !briefDialog.open) return;
    const notes = session.notes;
    session.notes = null;
    briefSend.hidden = true;
    briefDone.textContent = 'Close';
    briefPreview.replaceChildren();
    briefStatus.textContent = 'Writing the draft…';
    setAiBusy(true);
    try {
      const result = await requestAi(session.circleId, session.kind, notes);
      if (activePreview !== session || !briefDialog.open) return;
      if (result.error) {
        briefStatus.textContent = result.error;
        briefStatus.classList.add('is-error');
        return;
      }
      briefStatus.textContent = '';
      briefText.textContent = result.entry.body;
      briefCopy.hidden = false;
      briefCopy.disabled = false;
    } catch {
      if (activePreview === session && briefDialog.open) previewError();
    } finally {
      setAiBusy(false);
    }
  });

  if (handoffBtn) handoffBtn.addEventListener('click', () => openBrief('handoff_brief'));
  document.getElementById('brief-close').addEventListener('click', () => briefDialog.close());
  briefDone.addEventListener('click', () => briefDialog.close());
  briefDialog.addEventListener('close', () => {
    if (briefDialog.open) return;
    activePreview = null;
    briefPreview.replaceChildren();
    briefText.textContent = '';
    briefSend.hidden = true;
  });
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
      noteError.textContent = isMissingTable(error)
        ? 'Saving care notes isn’t available yet.'
        : 'Couldn’t save the note. Try again.';
      return;
    }

    noteDialog.close();
    flashStatus('Note saved.');
  });

  /* ---------- Shifts: who's on duty + volunteering board ---------- */

  const SLOT_INFO = {
    morning: { name: 'Morning shift', time: '7:00 AM – 3:00 PM', order: 0 },
    evening: { name: 'Evening shift', time: '3:00 PM – 10:00 PM', order: 1 }
  };
  const BOARD_DAYS = 14;
  const BOARD_PREVIEW_LIMIT = 3;

  let dutyDot = null;
  let dutyText = null;
  let dutyProgress = null;
  let dutyHours = null;
  let dutyOpenShifts = null;
  let boardListEl = null;
  let boardStatusEl = null;
  let boardTimer = null;
  let boardBusy = false;

  function localYmd(date) {
    return Time.manilaToday(date);
  }

  function currentSlot(now) {
    return Time.currentSlot(now);
  }

  function nameOf(row) {
    const name = row.assigned_name?.trim() || row.profiles?.full_name?.trim();
    if (row.assigned_to && currentUser && row.assigned_to === currentUser.id) {
      const meta = currentUser.user_metadata || {};
      const full = name || meta.full_name?.trim() || meta.name?.trim() || 'Member';
      return full + ' (you)';
    }
    return name || 'Member';
  }

  function setDuty(name, slot, now) {
    if (!dutyText || !dutyDot) return;
    dutyText.textContent = name || 'No one assigned';
    dutyDot.classList.toggle('on', !!name);
    const shift = name && Time.slots[slot];
    dutyProgress.hidden = !shift;
    dutyHours.hidden = !shift;
    dutyOpenShifts.hidden = !!name;
    if (shift) {
      dutyProgress.max = (shift.to - shift.from) * 60;
      dutyProgress.value = Time.manilaNow(now).minutes - shift.from * 60;
      dutyHours.textContent = SLOT_INFO[slot].time;
    }
  }

  async function loadDuty() {
    if (!thisCircle) return;
    const now = Time.now();
    const slot = currentSlot(now);
    if (!slot) { setDuty(null); return; }

    const { data, error } = await client
      .from('shifts')
      .select('assigned_to, assigned_name, profiles:assigned_to(full_name)')
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
    return new Date(value + 'T00:00:00Z').toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
    });
  }

  async function volunteerFor(shiftId) {
    if (boardBusy) return;
    const shift = boardRows.find(row => row.id === shiftId);
    if (shift && Time.hasStarted(shift)) {
      boardStatus(KalinRx.databaseMessage({ message: 'shift_started' }), true);
      await loadBoard();
      return;
    }
    boardBusy = true;
    boardStatus('');
    renderBoard(boardRows, true);

    const { error } = await client.rpc('claim_shift', { shift_id: shiftId });
    boardBusy = false;

    if (error) {
      console.error('Could not volunteer:', error);
      boardStatus(
        KalinRx.databaseMessage(error),
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
  const boardButtons = new Map();

  function updateBoardButtons(disabled = boardBusy) {
    const now = Time.now();
    for (const [row, button] of boardButtons) {
      const started = Time.hasStarted(row, now);
      button.disabled = disabled || started;
      if (started) {
        button.title = 'This shift has already started.';
        button.setAttribute('aria-label', 'Volunteer unavailable. This shift has already started.');
      } else {
        button.removeAttribute('title');
        button.removeAttribute('aria-label');
      }
    }
  }

  function renderBoard(rows, disabled) {
    if (!boardListEl) return;
    boardButtons.clear();
    boardListEl.replaceChildren();

    if (boardState === 'loading') { boardListEl.appendChild(el('p', 'empty', 'Loading…')); return; }
    if (boardState === 'error') { boardListEl.appendChild(el('p', 'empty', boardError)); return; }
    if (!rows.length) {
      boardListEl.appendChild(el('p', 'empty', 'No open shifts in the next two weeks.'));
      return;
    }

    const list = el('ul', 'board-list');
    rows.slice(0, BOARD_PREVIEW_LIMIT).forEach(row => {
      const info = SLOT_INFO[row.slot];
      const item = el('li', 'board-item');

      const text = el('div', 'board-text');
      text.append(
        el('strong', '', boardDayLabel(row.shift_date)),
        el('span', 'muted', info.name + ' · ' + info.time)
      );

      const button = el('button', 'btn-solid small', 'Volunteer');
      button.type = 'button';
      boardButtons.set(row, button);
      button.addEventListener('click', () => volunteerFor(row.id));

      item.append(text, button);
      list.appendChild(item);
    });
    updateBoardButtons(disabled);
    boardListEl.appendChild(list);
    const remaining = rows.length - BOARD_PREVIEW_LIMIT;
    if (remaining > 0) {
      const more = el('a', 'board-more', '+' + remaining + ' more in Calendar');
      more.href = 'calendar.html';
      boardListEl.appendChild(more);
    }
  }

  async function loadBoard() {
    if (!thisCircle) return;
    const start = localYmd();
    const end = Time.addDays(start, BOARD_DAYS - 1);

    const { data, error } = await client
      .from('shifts')
      .select('id, shift_date, slot, assigned_to, assigned_name')
      .eq('circle_id', thisCircle.id)
      .is('assigned_to', null)
      .gte('shift_date', start)
      .lte('shift_date', end)
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
    section.id = 'open-shifts';
    section.tabIndex = -1;

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
    dutyOpenShifts = el('a', 'hero-open-shifts', 'See open shifts');
    dutyOpenShifts.href = '#open-shifts';
    shift.append(duty, dutyProgress, dutyHours, dutyOpenShifts);

    const actions = el('div', 'hero-actions');
    if (handoffBtn) actions.appendChild(handoffBtn);
    const owner = isOwner();
    const isMember = (thisCircle.circle_members || []).some(member =>
      member.user_id === currentUser.id && member.role === 'member'
    );
    if (owner || isMember) actions.appendChild(settingsMenu(owner));

    const row = el('div', 'hero-row');
    row.append(actions, shift);
    section.appendChild(row);

    if (owner) {
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
      .select('id, name, description, created_by, created_at, is_active, ai_enabled, circle_members(user_id, role, joined_at)')
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
      aiUnavailable ||= window.sessionStorage.getItem(aiUnavailableKey()) === 'true';
    } catch {
      // Storage may be unavailable.
    }
    try {
      window.localStorage.setItem('kalin.lastCircle', circleId);
    } catch (_) {
      // The current page remains usable without persistent storage.
    }
    document.getElementById('circle-back-link').hidden = false;
    render();
    loadAiLog();
    loadDuty();
    loadBoard();
    Time.onMinute(() => {
      loadDuty();
      updateBoardButtons();
    });
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
      editError.textContent = error
        ? KalinRx.databaseMessage(error, 'Couldn’t save this circle. Try again.')
        : 'You don’t have permission to change this circle.';
      return;
    }

    thisCircle.name = data.name;
    thisCircle.description = data.description;
    render();
    editDialog.close();
    loadCircles(); // refresh the sidebar list
  });

  /* ---------- Leave or delete ---------- */

  async function leaveCircle(settingsButton) {
    settingsButton.focus();
    const ok = window.confirm(
      'Leave “' + thisCircle.name + '’s care circle”? You’ll lose access, and all your claimed shifts in this circle will become vacant.'
    );
    if (!ok) return;

    settingsButton.disabled = true;
    try {
      const { data, error } = await client
        .from('circle_members')
        .delete()
        .eq('circle_id', thisCircle.id)
        .eq('user_id', currentUser.id)
        .eq('role', 'member')
        .select('circle_id');

      if (error) throw error;
      if (!data?.length) throw new Error('No membership was removed.');
    } catch (error) {
      console.error('Could not leave circle:', error);
      settingsButton.disabled = false;
      settingsButton.focus();
      window.alert(KalinRx.databaseMessage(error, 'Couldn’t confirm you left this circle. Refresh the page and try again.'));
      return;
    }

    try {
      if (window.localStorage.getItem('kalin.lastCircle') === thisCircle.id) {
        window.localStorage.removeItem('kalin.lastCircle');
      }
    } catch (_) {
      // Leaving still works when browser storage is unavailable.
    }
    window.location.replace('dashboard.html');
  }

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
      window.alert(error
        ? KalinRx.databaseMessage(error, 'Couldn’t delete this circle. Try again.')
        : 'You don’t have permission to delete this circle.');
      return;
    }
    window.location.replace('dashboard.html');
  }

  load();
})();
