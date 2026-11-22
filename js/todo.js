/* Shared tasks on a single care-circle page. */
(function () {
  const columns = 'id, title, due_date, is_done, created_by, created_at';
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const dialog = document.getElementById('todo-dialog');
  const form = document.getElementById('todo-form');
  const titleInput = document.getElementById('todo-title');
  const dueInput = document.getElementById('todo-due');
  const formError = document.getElementById('todo-error');
  const save = document.getElementById('todo-save');
  const closeButtons = dialog.querySelectorAll('[data-todo-close]');

  for (const button of closeButtons) {
    button.addEventListener('click', () => dialog.close());
  }
  dialog.addEventListener('cancel', event => {
    if (save.disabled) event.preventDefault();
  });

  function button(label, classes = 'btn-ghost small') {
    const control = el('button', classes, label);
    control.type = 'button';
    return control;
  }

  function errorMessage(error, fallback) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return 'To do needs the Supabase setup in supabase/todo_setup.sql.';
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

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('is-error', isError);
    }

    function render() {
      const lastDay = new Date();
      if (selectedFilter === 'Week') lastDay.setDate(lastDay.getDate() + 7);
      const cutoff = [
        String(lastDay.getFullYear()).padStart(4, '0'),
        String(lastDay.getMonth() + 1).padStart(2, '0'),
        String(lastDay.getDate()).padStart(2, '0')
      ].join('-');
      const visible = selectedFilter === 'All'
        ? tasks
        : tasks.filter(task => task.due_date && task.due_date <= cutoff);
      const remaining = visible.filter(task => !task.is_done).length;
      summary.textContent = visible.length ? remaining + ' of ' + visible.length + ' open' : '';
      if (!visible.length) {
        content.replaceChildren(el('p', 'empty', emptyStates[selectedFilter]));
        return;
      }

      const ordered = visible.slice().sort((a, b) =>
        Number(a.is_done) - Number(b.is_done) ||
        (a.due_date || '9999-12-32').localeCompare(b.due_date || '9999-12-32') ||
        b.created_at.localeCompare(a.created_at)
      );
      const list = el('ul', 'todo-list');
      for (const task of ordered) list.appendChild(taskRow(task));
      content.replaceChildren(list);
    }

    function taskRow(task) {
      const row = el('li', 'todo-row');
      row.classList.toggle('is-done', task.is_done);
      row.dataset.taskId = task.id;

      const label = el('label', 'todo-label');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = task.is_done;
      check.setAttribute('aria-label', 'Complete task: ' + task.title);
      check.addEventListener('change', () => {
        const isDone = check.checked;
        check.checked = task.is_done;
        changeTask(task, { is_done: isDone }, 'input');
      });

      const details = el('span');
      details.appendChild(el('strong', '', task.title));
      if (task.due_date) {
        const due = el('time', 'muted', 'Due ' + dateFormat.format(new Date(task.due_date + 'T00:00:00')));
        due.dateTime = task.due_date;
        details.appendChild(due);
      }
      label.append(check, details);

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
      row.append(label, actions);
      return row;
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
        render();
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
      save.textContent = task ? 'Save changes' : action;
      titleInput.value = task?.title || '';
      dueInput.value = task?.due_date || '';

      form.onsubmit = async event => {
        event.preventDefault();
        const title = titleInput.value.trim();
        formError.textContent = '';
        if (!title) {
          formError.textContent = 'Enter a task name.';
          titleInput.focus();
          return;
        }

        const values = { title, due_date: dueInput.value || null };
        const controls = [save, titleInput, dueInput, ...closeButtons];
        for (const control of controls) control.disabled = true;
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
        }
      };
      dialog.showModal();
    }

    load();
  }

  window.KalinTodo = { mount };
})();
