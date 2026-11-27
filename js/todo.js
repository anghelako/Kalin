/* Shared tasks on a single care-circle page. */
(function () {
  const Rx = KalinRx;
  const columns = 'id, title, due_date, is_done, created_by, created_at, frequency, days_of_week, interval_days, times, end_date, instructions';
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
  const dialog = document.getElementById('todo-dialog');
  const form = document.getElementById('todo-form');
  const titleInput = document.getElementById('todo-title');
  const dueInput = document.getElementById('todo-due');
  const endInput = document.getElementById('todo-end');
  const frequencyInput = document.getElementById('todo-frequency');
  const intervalInput = document.getElementById('todo-interval');
  const instructionsInput = document.getElementById('todo-instructions');
  const timesBox = document.getElementById('todo-times');
  const addTimeButton = document.getElementById('todo-add-time');
  const daysBox = document.getElementById('todo-days');
  const formError = document.getElementById('todo-error');
  const save = document.getElementById('todo-save');
  const closeButtons = dialog.querySelectorAll('[data-todo-close]');

  for (const button of closeButtons) {
    button.addEventListener('click', () => dialog.close());
  }
  dialog.addEventListener('cancel', event => {
    if (save.disabled) event.preventDefault();
  });
  // Click on the backdrop closes the dialog, same as Add medication
  dialog.addEventListener('click', event => {
    if (event.target === dialog && !save.disabled) dialog.close();
  });

  /* ---------- Repeat fields (same behavior as Add medication) ---------- */

  const dayButtons = [];
  let selectedDays = new Set();

  function setDay(day, on) {
    if (on) selectedDays.add(day);
    else selectedDays.delete(day);
    dayButtons[day].setAttribute('aria-pressed', String(on));
  }

  Rx.DAY_NAMES.forEach((name, day) => {
    const dayButton = el('button', 'rx-day', name);
    dayButton.type = 'button';
    dayButton.setAttribute('aria-pressed', 'false');
    dayButton.addEventListener('click', () => setDay(day, !selectedDays.has(day)));
    dayButtons.push(dayButton);
    daysBox.appendChild(dayButton);
  });

  function syncTimeButtons() {
    const rows = timesBox.children;
    Array.from(rows).forEach(row => { row.querySelector('button').hidden = rows.length === 1; });
    addTimeButton.hidden = rows.length >= 8;
  }

  function timeRow(value) {
    const row = el('div', 'rx-time-row');
    const input = document.createElement('input');
    input.type = 'time';
    input.className = 'rx-control';
    input.value = value || '08:00';
    input.setAttribute('aria-label', 'Time of day');
    const remove = el('button', 'btn-ghost small', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => { row.remove(); syncTimeButtons(); });
    row.append(input, remove);
    return row;
  }

  function syncFrequency() {
    const frequency = frequencyInput.value;
    document.getElementById('todo-days-field').hidden = frequency !== 'weekly';
    document.getElementById('todo-interval-field').hidden = frequency !== 'interval';
  }

  frequencyInput.addEventListener('change', syncFrequency);
  addTimeButton.addEventListener('click', () => { timesBox.appendChild(timeRow('')); syncTimeButtons(); });

  function repeatText(task) {
    const parts = [];
    if (task.frequency === 'daily') parts.push('Every day');
    else if (task.frequency === 'weekly') parts.push(Rx.frequencyText(task));
    else if (task.frequency === 'interval') parts.push(Rx.frequencyText(task));
    if (task.times?.length) parts.push(task.times.map(Rx.formatTime).join(', '));
    return parts.join(' · ');
  }

  function button(label, classes = 'btn-ghost small') {
    const control = el('button', classes, label);
    control.type = 'button';
    return control;
  }

  function errorMessage(error, fallback, forSlots = false) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return forSlots
        ? 'Repeating tasks need the Supabase update in supabase/migrations/20261126110000_task_completions.sql.'
        : 'To do needs the Supabase setup in supabase/todo_setup.sql.';
    }
    return fallback;
  }

  function mount({ section, head }, circle, userId) {
    const isOwner = (circle.circle_members || []).some(member => member.user_id === userId && member.role === 'owner');
    const summary = el('p', 'widget-sub');
    const add = button('Add task', 'btn-solid small');
    const status = el('p', 'ai-status');
    const content = el('div', 'ai-list');
    let tasks = [];
    let doneKeys = new Set();
    let selectedFilter = 'Today';
    const emptyStates = {
      Today: 'Nothing due today',
      Week: 'Nothing due this week',
      All: 'No tasks yet.'
    };
    const filters = el('div', 'todo-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter tasks by due date');

    for (const filter of Object.keys(emptyStates)) {
      const control = button(filter, 'todo-filter');
      control.setAttribute('aria-pressed', String(filter === selectedFilter));
      control.addEventListener('click', () => {
        selectedFilter = filter;
        for (const tab of filters.children) {
          tab.setAttribute('aria-pressed', String(tab === control));
        }
        if (!add.disabled) render();
      });
      filters.appendChild(control);
    }

    section.classList.add('slot', 'slot-todo');
    head.firstElementChild.appendChild(summary);
    const actions = el('div', 'todo-head-actions');
    actions.append(filters, add);
    head.appendChild(actions);
    status.setAttribute('role', 'status');
    section.append(status, content);
    add.addEventListener('click', () => openEditor());

    // Open = still needs doing today. Repeating tasks only count on the days they are due.
    function taskOpen(task, today) {
      if ((task.frequency || 'once') === 'once') return !task.is_done;
      if (!Rx.taskDueOn(task, today)) return false;
      const progress = Rx.taskProgress(task, today, doneKeys);
      return progress.done < progress.total;
    }

    function nextDue(task, today) {
      let day = task.due_date > today ? task.due_date : KalinTime.addDays(today, 1);
      for (let i = 0; i < 70; i += 1, day = KalinTime.addDays(day, 1)) {
        if (task.end_date && day > task.end_date) return null;
        if (Rx.taskDueOn(task, day)) return day;
      }
      return null;
    }

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('is-error', isError);
    }

    function render() {
      const today = KalinTime.manilaToday();
      const cutoff = KalinTime.addDays(today, selectedFilter === 'Week' ? 7 : 0);
      const dueInWindow = task => {
        if ((task.frequency || 'once') === 'once') return task.due_date && task.due_date <= cutoff;
        for (let day = today; day <= cutoff; day = KalinTime.addDays(day, 1)) {
          if (Rx.taskDueOn(task, day)) return true;
        }
        return false;
      };
      const visible = selectedFilter === 'All' ? tasks : tasks.filter(dueInWindow);
      const remaining = visible.filter(task => taskOpen(task, today)).length;
      summary.textContent = visible.length ? remaining + ' of ' + visible.length + ' open' : '';
      if (!visible.length) {
        content.replaceChildren(el('p', 'empty', emptyStates[selectedFilter]));
        return;
      }

      const ordered = visible.slice().sort((a, b) =>
        Number(!taskOpen(a, today)) - Number(!taskOpen(b, today)) ||
        (a.due_date || '9999-12-32').localeCompare(b.due_date || '9999-12-32') ||
        b.created_at.localeCompare(a.created_at)
      );
      const list = el('ul', 'todo-list');
      for (const task of ordered) list.appendChild(taskRow(task));
      content.replaceChildren(list);
    }

    function taskRow(task) {
      const row = el('li', 'todo-row');
      const today = KalinTime.manilaToday();
      const repeats = (task.frequency || 'once') !== 'once';
      row.dataset.taskId = task.id;

      const details = el('span');
      details.appendChild(el('strong', '', task.title));
      if (task.due_date) {
        const due = el('time', 'muted', (repeats ? 'Starts ' : 'Due ') + dateFormat.format(new Date(task.due_date + 'T00:00:00Z')));
        due.dateTime = task.due_date;
        details.appendChild(due);
      }
      const repeat = repeatText(task);
      if (repeat) details.appendChild(el('span', 'muted', repeat));
      if (task.instructions) details.appendChild(el('span', 'muted', task.instructions));

      let main;
      if (!repeats) {
        row.classList.toggle('is-done', !!task.is_done);
        main = el('label', 'todo-label');
        const check = el('input');
        check.type = 'checkbox';
        check.checked = !!task.is_done;
        check.setAttribute('aria-label', 'Complete task: ' + task.title);
        check.addEventListener('change', () => {
          const checked = check.checked;
          check.checked = !!task.is_done;
          changeTask(task, { is_done: checked }, 'input');
        });
        main.append(check, details);
      } else {
        main = el('div', 'todo-label todo-repeat');
        main.appendChild(details);
        if (Rx.taskDueOn(task, today)) {
          const progress = Rx.taskProgress(task, today, doneKeys);
          row.classList.toggle('is-done', progress.done === progress.total);
          const slots = el('div', 'todo-slots');
          for (const time of Rx.taskSlots(task)) {
            const slot = el('label', 'todo-slot');
            const check = el('input');
            check.type = 'checkbox';
            check.dataset.time = time;
            check.checked = doneKeys.has(Rx.taskSlotKey(task.id, today, time));
            const wholeDay = !(task.times || []).length;
            check.setAttribute('aria-label', task.title + (wholeDay ? ' today' : ' at ' + Rx.formatTime(time)));
            check.addEventListener('change', () => toggleSlot(task, time, check.checked));
            slot.append(check, el('span', '', wholeDay ? 'Today' : Rx.formatTime(time)));
            slots.appendChild(slot);
          }
          main.appendChild(slots);
        } else {
          const next = nextDue(task, today);
          details.appendChild(el('span', 'muted', next
            ? 'Next ' + dateFormat.format(new Date(next + 'T00:00:00Z'))
            : 'No more due dates'));
        }
      }

      const actions = el('div', 'todo-actions');
      const edit = button('Edit');
      edit.setAttribute('aria-label', 'Edit ' + task.title);
      edit.addEventListener('click', () => openEditor(task));
      actions.appendChild(edit);

      if (isOwner || task.created_by === userId) {
        const remove = button('Delete', 'btn-ghost small todo-delete');
        remove.setAttribute('aria-label', 'Delete ' + task.title);
        remove.addEventListener('click', () => {
          if (window.confirm('Delete “' + task.title + '”?')) changeTask(task, null, '.todo-delete');
        });
        actions.appendChild(remove);
      }
      row.append(main, actions);
      return row;
    }

    // Tick or untick one time of day for a repeating task, for today.
    async function toggleSlot(task, time, checked) {
      const date = KalinTime.manilaToday();
      const controls = section.querySelectorAll('button, input');
      for (const control of controls) control.disabled = true;
      setStatus('');
      try {
        const table = client.from('circle_task_completions');
        const { error } = checked
          ? await table.insert({ circle_id: circle.id, task_id: task.id, slot_date: date, slot_time: time })
          : await table.delete().eq('circle_id', circle.id).eq('task_id', task.id)
            .eq('slot_date', date).eq('slot_time', time);
        // 23505: someone else already ticked this time, which is the state we wanted anyway.
        if (error && error.code !== '23505') throw error;
        const key = Rx.taskSlotKey(task.id, date, time);
        if (checked) doneKeys.add(key);
        else doneKeys.delete(key);
        setStatus(checked ? 'Marked done.' : 'Marked not done.');
      } catch (error) {
        setStatus(errorMessage(error, 'Couldn’t update the task. Try again.', true), true);
      } finally {
        render();
        for (const control of controls) control.disabled = false;
        const row = content.querySelector('[data-task-id="' + task.id + '"]');
        const slot = row?.querySelectorAll('input').find(input => input.dataset.time === time);
        (slot || add).focus();
      }
    }

    async function load() {
      add.disabled = true;
      summary.textContent = '';
      setStatus('');
      content.replaceChildren(el('p', 'empty', 'Loading tasks…'));
      const loaded = [];
      const pageSize = 200;
      let lastId;

      try {
        while (true) {
          let query = client.from('circle_tasks').select(columns).eq('circle_id', circle.id)
            .order('id').limit(pageSize);
          if (lastId) query = query.gt('id', lastId);
          const { data, error } = await query;
          if (error) throw error;
          loaded.push(...data);
          if (data.length < pageSize) break;
          lastId = data.at(-1).id;
        }
        tasks = loaded;
        const today = KalinTime.manilaToday();
        const { data: slotRows, error: slotError } = await client.from('circle_task_completions')
          .select('task_id, slot_time').eq('circle_id', circle.id).eq('slot_date', today);
        doneKeys = new Set(slotError ? [] : slotRows.map(row => Rx.taskSlotKey(row.task_id, today, row.slot_time)));
        render();
        if (slotError) setStatus(errorMessage(slotError, 'Couldn’t load which times are done. Try again.', true), true);
        add.disabled = false;
        return true;
      } catch (error) {
        const retry = button('Retry');
        retry.addEventListener('click', load);
        const retryActions = el('div', 'panel-actions');
        retryActions.appendChild(retry);
        content.replaceChildren(retryActions);
        setStatus(errorMessage(error, 'Couldn’t load tasks. Try again.'), true);
        return false;
      }
    }

    function saveRow(task, row) {
      tasks = tasks.filter(existing => existing.id !== task?.id);
      if (row) tasks.push(row);
      render();
    }

    async function changeTask(task, values, focusSelector) {
      const controls = section.querySelectorAll('button, input');
      for (const control of controls) control.disabled = true;
      setStatus('');
      let canAdd = true;

      try {
        const table = client.from('circle_tasks');
        const query = values ? table.update(values) : table.delete();
        const { data, error } = await query.eq('circle_id', circle.id).eq('id', task.id)
          .select(values ? columns : 'id').maybeSingle();
        if (error) throw error;
        if (!data) {
          canAdd = await load();
          if (canAdd) setStatus('The task changed or is no longer available.', true);
          return;
        }
        saveRow(task, values ? data : null);
        setStatus(values ? (data.is_done ? 'Task completed.' : 'Task reopened.') : 'Task deleted.');
      } catch (error) {
        setStatus(errorMessage(error, values ? 'Couldn’t update the task. Try again.' : 'Couldn’t delete the task. Try again.'), true);
      } finally {
        for (const control of controls) control.disabled = false;
        add.disabled = !canAdd;
        const row = content.querySelector('[data-task-id="' + task.id + '"]');
        const fallback = canAdd ? add : content.querySelector('button');
        (row?.querySelector(focusSelector) || fallback)?.focus();
      }
    }

    function openEditor(task) {
      form.reset();
      formError.textContent = '';
      const action = task ? 'Edit task' : 'Add task';
      document.getElementById('todo-dialog-title').textContent = action;
      document.getElementById('todo-dialog-eyebrow').textContent = task ? 'Edit' : 'New';
      save.textContent = task ? 'Save changes' : action;
      titleInput.value = task?.title || '';
      dueInput.value = task?.due_date || KalinTime.manilaToday();
      endInput.value = task?.end_date || '';
      frequencyInput.value = task?.frequency || 'once';
      intervalInput.value = task?.interval_days || 2;
      instructionsInput.value = task?.instructions || '';
      selectedDays = new Set();
      dayButtons.forEach((_, day) => setDay(day, (task?.days_of_week || []).includes(day)));
      const savedTimes = (task?.times || []).map(time => time.slice(0, 5));
      timesBox.replaceChildren(...(savedTimes.length ? savedTimes : ['08:00']).map(timeRow));
      syncFrequency();
      syncTimeButtons();

      form.onsubmit = async event => {
        event.preventDefault();
        const title = titleInput.value.trim();
        formError.textContent = '';
        if (!title) {
          formError.textContent = 'Enter a task name.';
          titleInput.focus();
          return;
        }

        const frequency = frequencyInput.value;
        const start = dueInput.value;
        const end = endInput.value;
        const interval = parseInt(intervalInput.value, 10);
        if (!start) { formError.textContent = 'Pick a start date.'; dueInput.focus(); return; }
        if (end && end < start) { formError.textContent = 'The end date can’t be before the start date.'; return; }
        if (frequency === 'weekly' && !selectedDays.size) { formError.textContent = 'Pick at least one day of the week.'; return; }
        if (frequency === 'interval' && !(interval >= 2 && interval <= 60)) {
          formError.textContent = 'Enter a number of days between 2 and 60.';
          return;
        }
        let times = Array.from(timesBox.querySelectorAll('input')).map(input => input.value);
        if (times.some(time => !time)) { formError.textContent = 'Fill in every time, or remove the empty one.'; return; }
        times = Array.from(new Set(times)).sort();

        const values = {
          title,
          due_date: start,
          end_date: end || null,
          frequency,
          days_of_week: frequency === 'weekly' ? Array.from(selectedDays).sort() : [],
          interval_days: frequency === 'interval' ? interval : null,
          times,
          instructions: instructionsInput.value.trim() || null
        };
        const controls = [save, titleInput, dueInput, endInput, frequencyInput, intervalInput, instructionsInput,
          addTimeButton, ...dayButtons, ...timesBox.querySelectorAll('input, button'), ...closeButtons];
        const idleLabel = save.textContent;
        for (const control of controls) control.disabled = true;
        save.textContent = 'Saving…';
        try {
          const table = client.from('circle_tasks');
          const query = task
            ? table.update(values).eq('circle_id', circle.id).eq('id', task.id)
            : table.insert({ ...values, circle_id: circle.id });
          const { data, error } = await query.select(columns).maybeSingle();
          if (error) throw error;
          if (!data) {
            await load();
            formError.textContent = 'This task is no longer available. Close the editor to see the current list.';
            return;
          }
          saveRow(task, data);
          setStatus(task ? 'Task updated.' : 'Task added.');
          dialog.close();
          const row = content.querySelector('[data-task-id="' + data.id + '"]');
          (row?.querySelector(task ? '.todo-actions button' : 'input') || add).focus();
        } catch (error) {
          formError.textContent = errorMessage(error, 'Couldn’t save the task. Try again.');
        } finally {
          for (const control of controls) control.disabled = false;
          save.textContent = idleLabel;
        }
      };
      dialog.showModal();
      titleInput.focus();
    }

    load();
  }

  window.KalinTodo = { mount };
})();
