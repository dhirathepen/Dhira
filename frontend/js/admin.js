'use strict';

/**
 * Dhira admin.
 *
 * A small hash-routed application on top of the public API helpers.
 * Every API call is cookie-authenticated and CSRF-protected; nothing is
 * stored in localStorage. Author text is always inserted with textContent.
 */
(function () {
  const { api, el, clear, assetUrl, formatDate, renderContent } = window.Dhira;

  const byId = (id) => document.getElementById(id);

  const loginScreen = byId('login-screen');
  const loginForm = byId('login-form');
  const loginError = byId('login-error');
  const loginSubmit = byId('login-submit');
  const adminApp = byId('admin-app');
  const viewRoot = byId('view-root');
  const pageTitle = byId('page-title');
  const headerActions = byId('header-actions');
  const modalOverlay = byId('modal-overlay');
  const modalBox = byId('modal');
  const toastEl = byId('toast');
  const messageBadge = byId('message-badge');

  const CONTACT_CATEGORY_LABELS = {
    general: 'General',
    reader: 'Reader message',
    book: 'About the book',
    poetry: 'About a poem',
    other: 'Other',
  };

  const BOOK_STATUS_OPTIONS = [
    ['drafting', 'Drafting'],
    ['editing', 'Editing'],
    ['with_editor', 'With editor'],
    ['cover_design', 'Cover design'],
    ['preorder', 'Pre-order'],
    ['published', 'Published'],
  ];

  const SOCIAL_FIELDS = [
    ['website', 'Website'],
    ['instagram', 'Instagram'],
    ['x', 'X (Twitter)'],
    ['facebook', 'Facebook'],
    ['goodreads', 'Goodreads'],
    ['linkedin', 'LinkedIn'],
    ['youtube', 'YouTube'],
    ['newsletter', 'Newsletter'],
  ];

  let currentAdmin = null;
  let categoriesCache = null;
  let activeView = 0;
  let viewCleanup = null;
  let toastTimer = null;
  let modalOnClose = null;

  /* ── tiny utilities ───────────────────────────────────────────────────── */

  function btn(label, className, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function link(label, href, className, external) {
    const node = el('a', className, label);
    node.href = href;
    if (external) {
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    }
    return node;
  }

  function iconSpan(symbol) {
    return el('span', 'icon', symbol);
  }

  function loadingBlock(label) {
    const wrap = el('div', 'loading-block');
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.appendChild(el('span', 'loading-dot'));
    wrap.appendChild(el('span', '', label || 'Loading…'));
    return wrap;
  }

  function errorBlock(message, retry) {
    const wrap = el('div', 'error-block');
    wrap.appendChild(el('p', '', message || 'Something went wrong.'));
    if (retry) wrap.appendChild(btn('Try again', 'btn-outline btn-small', retry));
    return wrap;
  }

  function emptyBlock(title, message, action) {
    const wrap = el('div', 'empty-admin');
    wrap.appendChild(el('p', 'empty-title', title || 'Nothing here yet'));
    if (message) wrap.appendChild(el('p', '', message));
    if (action) wrap.appendChild(action);
    return wrap;
  }

  function card(headTitle, body, headExtra) {
    const wrap = el('div', 'card');
    if (headTitle || headExtra) {
      const head = el('div', 'card-head');
      head.appendChild(el('h2', '', headTitle || ''));
      if (headExtra) head.appendChild(headExtra);
      wrap.appendChild(head);
    }
    if (body) wrap.appendChild(body);
    return wrap;
  }

  function statusBadge(status) {
    return el(
      'span',
      'badge ' + (status === 'published' ? 'badge-published' : 'badge-draft'),
      status === 'published' ? 'Published' : 'Draft'
    );
  }

  function categoryBadge(name) {
    return el('span', 'badge badge-category', name || '—');
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function fillSelect(select, items, getValue, getLabel, placeholder) {
    clear(select);
    if (placeholder !== undefined) {
      const option = el('option', '', placeholder);
      option.value = '';
      select.appendChild(option);
    }
    items.forEach((item) => {
      const option = el('option', '', getLabel(item));
      option.value = String(getValue(item));
      select.appendChild(option);
    });
  }

  function dataTable(headers, rows) {
    const wrap = el('div', 'table-wrap');
    const table = el('table', 'data-table');
    const thead = el('thead');
    const headRow = el('tr');
    headers.forEach((header) => headRow.appendChild(el('th', '', header)));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    rows.forEach((cells) => {
      const row = el('tr');
      cells.forEach((cell) => {
        const td = el('td');
        if (cell instanceof Node) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function paginationBlock(meta, onPage) {
    if (!meta || meta.total_pages <= 1) return null;
    const wrap = el('div', 'admin-pagination');
    const prev = btn('← Newer', 'page-btn', () => onPage(meta.page - 1));
    prev.disabled = !meta.has_prev;
    const next = btn('Older →', 'page-btn', () => onPage(meta.page + 1));
    next.disabled = !meta.has_next;
    wrap.appendChild(prev);
    wrap.appendChild(el('span', 'pagination-status', `Page ${meta.page} of ${meta.total_pages} · ${meta.total} total`));
    wrap.appendChild(next);
    return wrap;
  }

  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = 'toast';
    }, 3400);
  }

  function toastError(error) {
    toast((error && error.message) || 'Something went wrong.', 'error');
  }

  function setHeader(title, actions) {
    pageTitle.textContent = title;
    document.title = `${title} — Dhira Admin`;
    clear(headerActions);
    (actions || []).forEach((action) => headerActions.appendChild(action));
  }

  function setCleanup(fn) {
    viewCleanup = fn;
  }

  function runCleanup() {
    if (viewCleanup) {
      try { viewCleanup(); } catch { /* ignore */ }
      viewCleanup = null;
    }
  }

  function setValue(root, name, value) {
    const input = root.querySelector(`[name="${name}"]`);
    if (!input) return;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value === null || value === undefined ? '' : String(value);
  }

  function getValue(root, name) {
    const input = root.querySelector(`[name="${name}"]`);
    if (!input) return '';
    return input.type === 'checkbox' ? input.checked : input.value;
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach((node) => { node.textContent = ''; });
    form.querySelectorAll('.is-invalid').forEach((node) => node.classList.remove('is-invalid'));
    const banner = form.querySelector('.form-banner');
    if (banner) {
      banner.textContent = '';
      banner.classList.remove('visible', 'success');
    }
  }

  function applyFieldErrors(form, fields) {
    Object.entries(fields || {}).forEach(([name, message]) => {
      const slot = form.querySelector(`[data-error-for="${name}"]`);
      if (slot) slot.textContent = message;
      const input = form.querySelector(`[name="${name}"]`);
      if (input) input.classList.add('is-invalid');
    });
  }

  function formBanner(form, message, success) {
    const banner = form.querySelector('.form-banner');
    if (!banner) return;
    banner.textContent = message;
    banner.classList.add('visible');
    banner.classList.toggle('success', Boolean(success));
  }

  async function withBusy(button, label, task) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  /** Wrap an admin call so an expired session drops cleanly to the login screen. */
  async function call(task) {
    try {
      return await task();
    } catch (error) {
      if (error && error.status === 401) {
        showLogin('Your session has expired. Please sign in again.');
      }
      throw error;
    }
  }

  /* ── modal ────────────────────────────────────────────────────────────── */

  function openModal(options) {
    const { title, body, actions, wide, onClose } = options;
    modalBox.className = 'modal' + (wide ? ' wide' : '');
    clear(modalBox);

    const head = el('div', 'modal-head');
    const heading = el('h3', '', title || '');
    heading.id = 'modal-title';
    head.appendChild(heading);
    const close = el('button', 'modal-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close dialog');
    close.addEventListener('click', closeModal);
    head.appendChild(close);
    modalBox.appendChild(head);

    const bodyWrap = el('div', 'modal-body');
    if (body instanceof Node) bodyWrap.appendChild(body);
    else if (body) bodyWrap.textContent = String(body);
    modalBox.appendChild(bodyWrap);

    if (actions && actions.length) {
      const actionWrap = el('div', 'modal-actions');
      actions.forEach((action) => actionWrap.appendChild(action));
      modalBox.appendChild(actionWrap);
    }

    modalOverlay.hidden = false;
    modalOnClose = typeof onClose === 'function' ? onClose : null;

    const focusTarget = modalBox.querySelector('input, textarea, select, .btn-primary, .btn-danger');
    if (focusTarget) setTimeout(() => focusTarget.focus(), 30);
  }

  function closeModal() {
    modalOverlay.hidden = true;
    clear(modalBox);
    const callback = modalOnClose;
    modalOnClose = null;
    if (callback) callback();
  }

  function confirmAction(options) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const cancel = btn('Cancel', 'btn-outline', () => {
        finish(false);
        closeModal();
      });
      const confirm = btn(
        options.confirmLabel || 'Delete',
        options.danger === false ? 'btn-primary' : 'btn-danger',
        () => {
          finish(true);
          closeModal();
        }
      );

      openModal({
        title: options.title || 'Are you sure?',
        body: el('p', '', options.message || 'This cannot be undone.'),
        actions: [cancel, confirm],
        onClose: () => finish(false),
      });
    });
  }

  /* ── image uploader ───────────────────────────────────────────────────── */

  function createUploader(options) {
    let image = options.initial || null;
    let busy = false;

    const wrap = el('div', 'uploader');
    const preview = el('div', 'upload-preview');
    const status = el('div', 'upload-status');
    const actions = el('div', 'upload-actions');
    const choose = btn(options.label || 'Choose image', 'btn-outline btn-small', () => fileInput.click());
    const remove = btn('Remove', 'btn-danger btn-small', () => setImage(null));
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.hidden = true;

    function renderPreview() {
      clear(preview);
      if (image && image.url) {
        const img = el('img');
        img.src = assetUrl(image.url);
        img.alt = 'Selected image';
        preview.appendChild(img);
      } else {
        preview.appendChild(el('span', '', options.emptyText || 'No image selected'));
      }
      remove.hidden = !image;
      choose.disabled = busy;
    }

    function setImage(next) {
      image = next || null;
      renderPreview();
      status.textContent = image ? 'Image ready.' : '';
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file || busy) return;
      busy = true;
      choose.disabled = true;
      status.textContent = 'Uploading…';
      try {
        const data = await call(() => api.upload(file));
        if (data && data.image) {
          setImage(data.image);
          status.textContent = 'Uploaded. Save the form to keep it.';
        }
      } catch (error) {
        status.textContent = (error && error.message) || 'Upload failed.';
        toastError(error);
      } finally {
        busy = false;
        choose.disabled = false;
        fileInput.value = '';
        renderPreview();
      }
    });

    actions.appendChild(choose);
    actions.appendChild(remove);
    wrap.appendChild(preview);
    wrap.appendChild(actions);
    wrap.appendChild(status);
    wrap.appendChild(fileInput);
    renderPreview();

    return {
      node: wrap,
      getValue: () => (image ? image.id : null),
      getImage: () => image,
      setValue: setImage,
    };
  }

  /* ── auth ─────────────────────────────────────────────────────────────── */

  function showLogin(message) {
    currentAdmin = null;
    runCleanup();
    closeModal();
    closeSidebar();
    loginScreen.hidden = false;
    adminApp.hidden = true;
    messageBadge.hidden = true;
    document.title = 'Admin — Dhira';
    if (message) {
      loginError.textContent = message;
      loginError.hidden = false;
    } else {
      loginError.hidden = true;
    }
    const pass = byId('login-pass');
    if (pass) pass.value = '';
  }

  function showApp() {
    loginScreen.hidden = true;
    adminApp.hidden = false;
    loginError.hidden = true;
  }

  async function boot() {
    try {
      const data = await api.get('/auth/me');
      currentAdmin = data.admin;
      showApp();
      await refreshMessageBadge();
      if (!location.hash || location.hash === '#/') {
        location.hash = '#/dashboard';
      } else {
        renderRoute();
      }
    } catch (error) {
      const message = error && error.status === 0
        ? 'Could not reach the server. Check that the backend is running, then reload.'
        : error && error.status && error.status !== 401
          ? error.message
          : '';
      showLogin(message);
    }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = byId('login-user').value.trim();
    const password = byId('login-pass').value;
    if (!username || !password) {
      loginError.textContent = 'Enter your username and password.';
      loginError.hidden = false;
      return;
    }

    loginError.hidden = true;
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Signing in…';

    try {
      const data = await api.post('/auth/login', { username, password });
      currentAdmin = data.admin;
      loginForm.reset();
      showApp();
      await refreshMessageBadge();
      toast('Welcome back.');
      if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
      else renderRoute();
    } catch (error) {
      loginError.textContent = (error && error.message) || 'Could not sign in.';
      loginError.hidden = false;
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'Sign In';
    }
  });

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch { /* sign out locally regardless */ }
    showLogin('You have signed out.');
    history.replaceState(null, '', location.pathname);
  }

  byId('logout-btn').addEventListener('click', logout);
  byId('account-logout') && byId('account-logout').addEventListener('click', logout);

  /* ── sidebar ──────────────────────────────────────────────────────────── */

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    const toggle = byId('sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    const toggle = byId('sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  byId('sidebar-toggle').addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-open')) closeSidebar();
    else openSidebar();
  });
  byId('sidebar-scrim').addEventListener('click', closeSidebar);
  document.querySelectorAll('.sidebar-link').forEach((anchor) => {
    anchor.addEventListener('click', closeSidebar);
  });

  /* ── router ───────────────────────────────────────────────────────────── */

  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'dashboard', parts, id: parts[1] || null };
  }

  function navigate(hash) {
    if (location.hash === hash) renderRoute();
    else location.hash = hash;
  }

  function setActiveNav(route) {
    let key = route.name;
    if (route.name === 'posts' && route.parts[1] === 'new') key = 'posts-new';
    document.querySelectorAll('.sidebar-link').forEach((anchor) => {
      anchor.classList.toggle('active', anchor.getAttribute('data-nav') === key);
    });
  }

  function loadCategories(force) {
    if (categoriesCache && !force) return Promise.resolve(categoriesCache);
    return call(() => api.get('/admin/categories')).then((data) => {
      categoriesCache = data.items || [];
      return categoriesCache;
    });
  }

  function categoryOptions(select, selectedId, allowEmpty) {
    fillSelect(
      select,
      categoriesCache || [],
      (item) => item.id,
      (item) => item.name + (item.published_count ? ` (${item.published_count} live)` : ''),
      allowEmpty ? 'Choose a category…' : undefined
    );
    if (selectedId) select.value = String(selectedId);
  }

  async function refreshMessageBadge() {
    try {
      const data = await api.get('/admin/messages?per_page=1');
      const unread = (data.counts && data.counts.unread) || 0;
      messageBadge.hidden = unread === 0;
      messageBadge.textContent = unread > 99 ? '99+' : String(unread);
    } catch { /* badge is optional */ }
  }

  function renderRoute() {
    if (!currentAdmin) return;
    runCleanup();
    closeSidebar();
    if (!modalOverlay.hidden) closeModal();

    const route = parseRoute();
    setActiveNav(route);

    if (route.name === 'dashboard') return viewDashboard();
    if (route.name === 'posts') {
      if (route.parts[1] === 'new') return viewEditor(null);
      if (route.parts[1]) {
        const id = Number(route.parts[1]);
        if (Number.isInteger(id) && id > 0) return viewEditor(id);
        return viewNotFound();
      }
      return viewPosts();
    }
    if (route.name === 'categories') return viewCategories();
    if (route.name === 'books') {
      if (route.parts[1] === 'new') return viewBookEditor(null);
      if (route.parts[1]) {
        const id = Number(route.parts[1]);
        if (Number.isInteger(id) && id > 0) return viewBookEditor(id);
        return viewNotFound();
      }
      return viewBooks();
    }
    if (route.name === 'author') return viewAuthor();
    if (route.name === 'messages') return viewMessages();
    if (route.name === 'account') return viewAccount();
    return viewNotFound();
  }

  window.addEventListener('hashchange', renderRoute);

  function viewNotFound() {
    setHeader('Not found', [btn('Dashboard', 'btn-primary', () => navigate('#/dashboard'))]);
    clear(viewRoot);
    viewRoot.appendChild(
      emptyBlock(
        'This panel does not exist',
        'The address in the URL does not match a section of the admin.',
        btn('Go to the dashboard', 'btn-outline', () => navigate('#/dashboard'))
      )
    );
  }

  /* ── dashboard ────────────────────────────────────────────────────────── */

  async function viewDashboard() {
    const token = ++activeView;
    setHeader('Dashboard', [btn('+ New Post', 'btn-primary', () => navigate('#/posts/new'))]);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Gathering your desk…'));

    try {
      const data = await call(() => api.get('/admin/stats'));
      if (token !== activeView) return;
      const stats = data.stats || {};
      clear(viewRoot);

      const grid = el('div', 'stats-grid');
      const statCards = [
        { label: 'Published', value: stats.published_posts, note: 'Live pieces', accent: true },
        { label: 'Drafts', value: stats.draft_posts, note: 'Unpublished' },
        { label: 'Poems', value: stats.published_poems, note: 'Published' },
        { label: 'Essays', value: stats.published_articles, note: 'Published' },
        { label: 'Books', value: stats.books_total, note: 'In the library' },
        { label: 'Unread messages', value: stats.messages_unread, note: `${stats.messages_total || 0} total`, accent: Number(stats.messages_unread) > 0 },
      ];
      statCards.forEach((stat) => {
        const node = el('div', 'stat-card' + (stat.accent ? ' accent' : ''));
        node.appendChild(el('span', 'stat-value', stat.value == null ? '0' : String(stat.value)));
        node.appendChild(el('span', 'stat-label', stat.label));
        node.appendChild(el('span', 'stat-note', stat.note));
        grid.appendChild(node);
      });
      viewRoot.appendChild(grid);

      const dashGrid = el('div', 'dashboard-grid');

      const postsBody = el('div');
      if (!data.recent_posts || !data.recent_posts.length) {
        postsBody.appendChild(emptyBlock('No posts yet', 'Start with a poem, an essay or a note.', btn('+ New Post', 'btn-primary btn-small', () => navigate('#/posts/new'))));
      } else {
        data.recent_posts.forEach((post) => {
          const row = el('div', 'message-item');
          row.style.cursor = 'pointer';
          row.addEventListener('click', () => navigate(`#/posts/${post.id}`));

          const left = el('div');
          left.appendChild(el('div', 'message-from', `${post.category_name || 'Uncategorised'} · ${post.type === 'poem' ? 'Poem' : 'Essay'}`));
          left.appendChild(el('div', 'message-subject', post.title || '(untitled)'));
          left.appendChild(el('div', 'message-preview', `Updated ${formatDate(post.updated_at, 'short')}`));
          row.appendChild(left);

          const right = el('div', 'message-side');
          right.appendChild(statusBadge(post.status));
          row.appendChild(right);
          postsBody.appendChild(row);
        });
      }
      const postsCard = card('Recent posts', postsBody, link('All posts →', '#/posts', 'link-btn'));
      postsCard.querySelector('.card-head .link-btn').addEventListener('click', (event) => {
        event.preventDefault();
        navigate('#/posts');
      });
      dashGrid.appendChild(postsCard);

      const messagesBody = el('div');
      if (!data.recent_messages || !data.recent_messages.length) {
        messagesBody.appendChild(emptyBlock('No messages yet', 'Reader messages will appear here.'));
      } else {
        data.recent_messages.forEach((message) => {
          const row = el('div', 'message-item' + (message.is_read ? '' : ' unread'));
          row.style.cursor = 'pointer';
          row.addEventListener('click', () => openMessage(message.id, () => viewDashboard()));

          const left = el('div');
          const from = el('div', 'message-from');
          if (!message.is_read) from.appendChild(el('span', 'dot-unread'));
          from.appendChild(document.createTextNode(message.name || 'Unknown'));
          left.appendChild(from);
          left.appendChild(el('div', 'message-subject', message.subject || '(no subject)'));
          left.appendChild(el('div', 'message-preview', message.email || ''));
          row.appendChild(left);

          const right = el('div', 'message-side');
          right.appendChild(el('span', '', formatDate(message.created_at, 'short')));
          row.appendChild(right);
          messagesBody.appendChild(row);
        });
      }
      const messagesCard = card(
        'Recent messages',
        messagesBody,
        link('Inbox →', '#/messages', 'link-btn')
      );
      messagesCard.querySelector('.card-head .link-btn').addEventListener('click', (event) => {
        event.preventDefault();
        navigate('#/messages');
      });
      dashGrid.appendChild(messagesCard);

      viewRoot.appendChild(dashGrid);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'The dashboard could not be loaded.', viewDashboard));
    }
  }

  /* ── posts list ───────────────────────────────────────────────────────── */

  const postsState = {
    page: 1,
    status: '',
    category: '',
    type: '',
    q: '',
    perPage: 20,
  };

  async function viewPosts() {
    const token = ++activeView;
    setHeader('All Posts', [btn('+ New Post', 'btn-primary', () => navigate('#/posts/new'))]);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Loading posts…'));

    try {
      await loadCategories();
      if (token !== activeView) return;
      clear(viewRoot);

      const container = el('div', 'card');
      const filters = buildPostFilters(() => loadPostList(container, token), () => {
        postsState.page = 1;
        postsState.status = '';
        postsState.category = '';
        postsState.type = '';
        postsState.q = '';
        loadPostList(container, token);
      });
      viewRoot.appendChild(filters);
      viewRoot.appendChild(container);
      await loadPostList(container, token);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'Posts could not be loaded.', viewPosts));
    }
  }

  function buildPostFilters(onChange, onReset) {
    const bar = el('div', 'filter-bar');

    const status = el('select');
    status.setAttribute('aria-label', 'Filter by status');
    fillSelect(status, [
      { value: '', label: 'All statuses' },
      { value: 'published', label: 'Published' },
      { value: 'draft', label: 'Drafts' },
    ], (item) => item.value, (item) => item.label);
    status.value = postsState.status;
    status.addEventListener('change', () => { postsState.status = status.value; postsState.page = 1; onChange(); });

    const category = el('select');
    category.setAttribute('aria-label', 'Filter by category');
    fillSelect(category, categoriesCache || [], (item) => item.slug, (item) => item.name, 'All categories');
    category.value = postsState.category;
    category.addEventListener('change', () => { postsState.category = category.value; postsState.page = 1; onChange(); });

    const type = el('select');
    type.setAttribute('aria-label', 'Filter by type');
    fillSelect(type, [
      { value: '', label: 'All types' },
      { value: 'article', label: 'Essays' },
      { value: 'poem', label: 'Poems' },
    ], (item) => item.value, (item) => item.label);
    type.value = postsState.type;
    type.addEventListener('change', () => { postsState.type = type.value; postsState.page = 1; onChange(); });

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search title, subtitle or excerpt…';
    search.value = postsState.q;
    search.setAttribute('aria-label', 'Search posts');
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        postsState.q = search.value.trim();
        postsState.page = 1;
        onChange();
      }, 320);
    });

    const reset = btn('Reset', 'btn-outline btn-small', onReset);

    bar.appendChild(status);
    bar.appendChild(category);
    bar.appendChild(type);
    bar.appendChild(search);
    bar.appendChild(reset);
    return bar;
  }

  async function loadPostList(container, token) {
    clear(container);
    container.appendChild(loadingBlock('Loading posts…'));

    try {
      const params = new URLSearchParams({ page: String(postsState.page), per_page: String(postsState.perPage) });
      if (postsState.status) params.set('status', postsState.status);
      if (postsState.category) params.set('category', postsState.category);
      if (postsState.type) params.set('type', postsState.type);
      if (postsState.q) params.set('q', postsState.q);

      const data = await call(() => api.get(`/admin/posts?${params.toString()}`));
      if (token !== activeView) return;
      clear(container);

      const items = data.items || [];
      if (!items.length) {
        container.appendChild(emptyBlock(
          postsState.q || postsState.status || postsState.category || postsState.type ? 'No matching posts' : 'No posts yet',
          postsState.q || postsState.status || postsState.category || postsState.type
            ? 'Try a different search or clear the filters.'
            : 'Write your first piece to begin.',
          btn('+ New Post', 'btn-primary btn-small', () => navigate('#/posts/new'))
        ));
      } else {
        const rows = items.map((post) => {
          const titleCell = el('div');
          const titleLink = el('a', 'cell-title', post.title || '(untitled)');
          titleLink.href = `#/posts/${post.id}`;
          titleLink.addEventListener('click', (event) => { event.preventDefault(); navigate(`#/posts/${post.id}`); });
          titleCell.appendChild(titleLink);
          titleCell.appendChild(el('div', 'cell-sub', `/${post.slug}`));

          const actions = el('div', 'row-actions');
          actions.appendChild(btn('Edit', 'link-btn', () => navigate(`#/posts/${post.id}`)));
          if (post.status === 'published') {
            const view = el('a', 'link-btn', 'View');
            view.href = `post.html?slug=${encodeURIComponent(post.slug)}`;
            view.target = '_blank';
            view.rel = 'noopener noreferrer';
            actions.appendChild(view);
          }
          actions.appendChild(btn(post.status === 'published' ? 'Unpublish' : 'Publish', 'link-btn', async () => {
            try {
              await call(() => api.patch(`/admin/posts/${post.id}/status`, { status: post.status === 'published' ? 'draft' : 'published' }));
              toast(post.status === 'published' ? 'Post unpublished.' : 'Post published.');
              loadPostList(container, token);
            } catch (error) { toastError(error); }
          }));
          actions.appendChild(btn('Duplicate', 'link-btn', async () => {
            try {
              await call(() => api.post(`/admin/posts/${post.id}/duplicate`));
              toast('Copy created as a draft.');
              loadPostList(container, token);
            } catch (error) { toastError(error); }
          }));
          actions.appendChild(btn('Delete', 'link-btn danger', async () => {
            const ok = await confirmAction({
              title: 'Delete this post?',
              message: `“${post.title}” will be permanently removed, along with its place in the site.`,
            });
            if (!ok) return;
            try {
              await call(() => api.del(`/admin/posts/${post.id}`));
              toast('Post deleted.');
              loadPostList(container, token);
            } catch (error) { toastError(error); }
          }));

          return [
            titleCell,
            categoryBadge(post.category ? post.category.name : ''),
            el('span', 'badge badge-type', post.type === 'poem' ? 'Poem' : 'Essay'),
            statusBadge(post.status),
            el('span', 'cell-muted', formatDate(post.updated_at, 'short')),
            actions,
          ];
        });

        container.appendChild(dataTable(['Title', 'Category', 'Type', 'Status', 'Updated', 'Actions'], rows));
      }

      const pagination = paginationBlock(data.pagination, (page) => {
        postsState.page = page;
        loadPostList(container, token);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      if (pagination) container.appendChild(pagination);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(container);
      container.appendChild(errorBlock(error.message || 'Posts could not be loaded.', () => loadPostList(container, token)));
    }
  }

  /* ── post editor ──────────────────────────────────────────────────────── */

  async function viewEditor(id) {
    const token = ++activeView;
    setHeader(id ? 'Edit post' : 'New post', []);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Opening the editor…'));

    try {
      const postData = id
        ? await call(() => api.get(`/admin/posts/${id}`))
        : Promise.resolve(null);
      if (token !== activeView) return;
      if (id && (!postData || !postData.post)) {
        clear(viewRoot);
        viewRoot.appendChild(emptyBlock('Post not found', 'It may have been deleted.', btn('Back to posts', 'btn-outline', () => navigate('#/posts'))));
        return;
      }
      renderEditor(postData ? postData.post : null);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'The editor could not be opened.', () => viewEditor(id)));
    }
  }

  function renderEditor(post) {
    clear(viewRoot);
    const isEdit = Boolean(post);

    const banner = el('div', 'form-banner');
    banner.setAttribute('role', 'alert');

    const form = document.createElement('form');
    form.id = 'post-form';
    form.setAttribute('novalidate', '');
    form.innerHTML = `
      ${banner.outerHTML}
      <div class="editor-layout">
        <div class="editor-card">
          <label class="visually-hidden" for="post-title">Title</label>
          <input class="editor-title" id="post-title" name="title" placeholder="Post title…" maxlength="300" autocomplete="off" />
          <span class="field-error" data-error-for="title"></span>
          <label class="visually-hidden" for="post-subtitle">Subtitle</label>
          <input class="editor-subtitle" id="post-subtitle" name="subtitle" placeholder="An optional subtitle…" maxlength="300" autocomplete="off" />
          <label class="visually-hidden" for="post-content">Content</label>
          <textarea class="editor-body" id="post-content" name="content" placeholder="Start writing…&#10;&#10;Leave a blank line between paragraphs. Poems keep every line break exactly as typed."></textarea>
          <span class="field-error" data-error-for="content"></span>
          <label class="visually-hidden" for="post-footer-note">Footer note</label>
          <textarea class="editor-footer-note" id="post-footer-note" name="footer_note" maxlength="20000" placeholder="Footer — add tags, related writing or a closing note…"></textarea>
          <span class="field-error" data-error-for="footer_note"></span>
          <div class="editor-footer">
            <span id="word-count">0 words · 1 min read</span>
            <span id="save-state">Not saved</span>
          </div>
        </div>
      <aside class="editor-side">
        <div class="side-card">
          <div class="side-card-head">Publish</div>
          <div class="side-card-body">
            <div class="field">
              <label for="post-status">Status</label>
              <select id="post-status" name="status">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
              <span class="field-error" data-error-for="status"></span>
            </div>
            <div class="field">
              <label for="post-date">Publish date</label>
              <input type="date" id="post-date" name="published_on" />
              <span class="hint">Leave blank to use today when publishing.</span>
              <span class="field-error" data-error-for="published_on"></span>
            </div>
            <label class="inline-actions" style="font-size:0.78rem;color:var(--mid-grey);cursor:pointer;">
              <input type="checkbox" name="featured" style="width:auto;" /> Feature on the writing page
            </label>
          </div>
        </div>

        <div class="side-card">
          <div class="side-card-head">Details</div>
          <div class="side-card-body">
            <div class="field">
              <label for="post-type">Type</label>
              <select id="post-type" name="type">
                <option value="article">Essay</option>
                <option value="poem">Poem</option>
              </select>
              <span class="field-error" data-error-for="type"></span>
            </div>
            <div class="field">
              <label for="post-slug">Slug</label>
              <input id="post-slug" name="slug" placeholder="auto from title" maxlength="90" autocomplete="off" />
              <span class="hint">Lowercase letters, numbers and hyphens.</span>
              <span class="field-error" data-error-for="slug"></span>
            </div>
          </div>
        </div>

        <div class="side-card">
          <div class="side-card-head">Excerpt &amp; tags</div>
          <div class="side-card-body">
            <div class="field">
              <label for="post-excerpt">Excerpt</label>
              <textarea id="post-excerpt" name="excerpt" maxlength="500" placeholder="A short summary. Left blank, it is taken from the writing." style="min-height:90px;"></textarea>
              <span class="field-error" data-error-for="excerpt"></span>
            </div>
            <div class="field">
              <label for="post-tags">Tags</label>
              <input id="post-tags" name="tags" placeholder="reflection, morning, quiet" autocomplete="off" />
              <span class="hint">Separate tags with commas.</span>
              <span class="field-error" data-error-for="tags"></span>
            </div>
          </div>
        </div>

        <div class="side-card">
          <div class="side-card-head">Cover image</div>
          <div class="side-card-body">
            <div id="cover-slot"></div>
            <span class="field-error" data-error-for="cover_image_id"></span>
          </div>
        </div>
      </aside>
      </div>
    `;

    // Re-insert the banner element we serialised above (keeps its role attribute).
    const serialisedBanner = form.querySelector('.form-banner');
    serialisedBanner.replaceWith(banner);

    viewRoot.appendChild(form);

    const titleInput = form.querySelector('[name="title"]');
    const subtitleInput = form.querySelector('[name="subtitle"]');
    const contentInput = form.querySelector('[name="content"]');
    const footerInput = form.querySelector('[name="footer_note"]');
    const excerptInput = form.querySelector('[name="excerpt"]');
    const tagsInput = form.querySelector('[name="tags"]');
    const slugInput = form.querySelector('[name="slug"]');
    const dateInput = form.querySelector('[name="published_on"]');
    const statusSelect = form.querySelector('[name="status"]');
    const typeSelect = form.querySelector('[name="type"]');
    const featuredInput = form.querySelector('[name="featured"]');
    const wordCount = form.querySelector('#word-count');
    const saveState = form.querySelector('#save-state');

    if (post) {
      titleInput.value = post.title || '';
      subtitleInput.value = post.subtitle || '';
      contentInput.value = post.content || '';
      footerInput.value = post.footer_note || '';
      excerptInput.value = post.excerpt || '';
      tagsInput.value = (post.tags || []).map((tag) => tag.name).join(', ');
      slugInput.value = post.slug || '';
      dateInput.value = post.published_on || '';
      statusSelect.value = post.status || 'draft';
      typeSelect.value = post.type || 'article';
      featuredInput.checked = Boolean(post.featured);
    } else {
      statusSelect.value = 'draft';
      typeSelect.value = 'article';
    }

    const uploader = createUploader({
      initial: post ? post.cover : null,
      label: post && post.cover ? 'Replace image' : 'Choose image',
      emptyText: 'No cover selected',
    });
    form.querySelector('#cover-slot').appendChild(uploader.node);

    function updateWordCount() {
      const words = contentInput.value.trim().split(/\s+/).filter(Boolean).length;
      const minutes = Math.max(1, Math.ceil(words / 200));
      wordCount.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${minutes} min read`;
    }
    updateWordCount();

    let dirty = Boolean(!post);
    function markDirty() {
      dirty = true;
      saveState.textContent = 'Unsaved changes';
    }
    form.addEventListener('input', () => {
      if (form.querySelector('[name="content"]') === document.activeElement) updateWordCount();
      markDirty();
    });
    form.addEventListener('change', markDirty);

    function onBeforeUnload(event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    setCleanup(() => window.removeEventListener('beforeunload', onBeforeUnload));

    function collect() {
      return {
        title: titleInput.value.trim(),
        subtitle: subtitleInput.value.trim(),
        content: contentInput.value,
        footer_note: footerInput.value,
        excerpt: excerptInput.value.trim(),
        type: typeSelect.value,
        status: statusSelect.value,
        featured: featuredInput.checked,
        published_on: dateInput.value || null,
        tags: tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean),
        slug: slugInput.value.trim(),
        cover_image_id: uploader.getValue(),
      };
    }

    function validate(payload) {
      const errors = {};
      if (!payload.title) errors.title = 'Add a title.';
      else if (payload.title.length > 300) errors.title = 'Keep the title under 300 characters.';
      if (!payload.content || !payload.content.trim()) errors.content = 'Write something first.';
      if (payload.footer_note.length > 20000) errors.footer_note = 'Keep the footer under 20,000 characters.';
      if (payload.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)) {
        errors.slug = 'Use lowercase letters, numbers and hyphens only.';
      }
      if (payload.published_on && !/^\d{4}-\d{2}-\d{2}$/.test(payload.published_on)) {
        errors.published_on = 'Use a real date.';
      }
      return errors;
    }

    async function save(status) {
      const payload = collect();
      payload.status = status;
      clearFieldErrors(form);
      const errors = validate(payload);
      if (Object.keys(errors).length) {
        applyFieldErrors(form, errors);
        formBanner(form, 'Please fix the highlighted fields before saving.');
        const first = form.querySelector('.is-invalid');
        if (first) first.focus();
        return;
      }

      const button = status === 'published' ? publishButton : draftButton;
      await withBusy(button, 'Saving…', async () => {
        try {
          const result = isEdit
            ? await call(() => api.put(`/admin/posts/${post.id}`, payload))
            : await call(() => api.post('/admin/posts', payload));
          dirty = false;
          saveState.textContent = 'Saved';
          toast(status === 'published' ? 'Post published.' : 'Draft saved.');
          const savedId = result.post.id;
          if (location.hash === `#/posts/${savedId}`) renderRoute();
          else location.hash = `#/posts/${savedId}`;
        } catch (error) {
          if (error.status === 401) return;
          const fields = (error && error.fields) || {};
          if (Object.keys(fields).length) applyFieldErrors(form, fields);
          formBanner(form, (error && error.message) || 'The post could not be saved.');
        }
      });
    }

    function openPreview() {
      const payload = collect();
      const wrap = el('div', 'preview-page');
      const kicker = el('div', 'preview-kicker');
      kicker.appendChild(el('span', '', formatDate(payload.published_on, 'short') || 'Not dated'));
      kicker.appendChild(el('span', 'badge badge-type', payload.type === 'poem' ? 'Poem' : 'Essay'));
      kicker.appendChild(el('span', '', `${Math.max(1, Math.ceil(payload.content.trim().split(/\s+/).filter(Boolean).length / 200))} min read`));
      wrap.appendChild(kicker);

      wrap.appendChild(el('h1', 'preview-title', payload.title || 'Untitled'));
      if (payload.subtitle) wrap.appendChild(el('p', 'preview-subtitle', payload.subtitle));

      const image = uploader.getImage();
      if (image && image.url) {
        const cover = el('img', 'preview-cover');
        cover.src = assetUrl(image.url);
        cover.alt = payload.title || 'Cover';
        wrap.appendChild(cover);
      }

      const body = el('div', 'preview-body' + (payload.type === 'poem' ? ' is-poem' : ''));
      renderContent(body, payload.content || 'Nothing written yet.');
      wrap.appendChild(body);

      if (payload.footer_note && payload.footer_note.trim()) {
        const footer = el('div', 'preview-footer-note');
        renderContent(footer, payload.footer_note.trim());
        wrap.appendChild(footer);
      }

      openModal({
        title: 'Preview',
        body: wrap,
        wide: true,
        actions: [btn('Close preview', 'btn-outline', closeModal)],
      });
    }

    const previewButton = btn('Preview', 'btn-outline', openPreview);
    const draftButton = btn('Save draft', 'btn-outline', () => save('draft'));
    const publishButton = btn('Publish', 'btn-primary', () => save('published'));

    const actions = [previewButton, draftButton, publishButton];
    if (isEdit) {
      actions.push(link('View live', `post.html?slug=${encodeURIComponent(post.slug)}`, 'btn-outline', true));
      if (post.status === 'published') {
        actions.push(btn('Unpublish', 'btn-danger', async () => {
          const ok = await confirmAction({
            title: 'Unpublish this post?',
            message: 'It will disappear from the public site but stay here as a draft.',
            confirmLabel: 'Unpublish',
          });
          if (!ok) return;
          try {
            await call(() => api.patch(`/admin/posts/${post.id}/status`, { status: 'draft' }));
            dirty = false;
            toast('Post unpublished.');
            renderRoute();
          } catch (error) { toastError(error); }
        }));
      }
    }
    setHeader(isEdit ? 'Edit post' : 'New post', actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      save(statusSelect.value);
    });

    requestAnimationFrame(() => titleInput.focus());
  }

  /* ── categories & tags ────────────────────────────────────────────────── */

  async function viewCategories() {
    const token = ++activeView;
    setHeader('Categories', [btn('+ New Category', 'btn-primary', () => openCategoryForm(null))]);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Loading categories…'));

    try {
      const [categories, tags] = await Promise.all([
        loadCategories(true),
        call(() => api.get('/admin/categories/tags/all')),
      ]);
      if (token !== activeView) return;
      clear(viewRoot);

      const rows = categories.map((category) => {
        const actions = el('div', 'row-actions');
        actions.appendChild(btn('Edit', 'link-btn', () => openCategoryForm(category)));
        actions.appendChild(btn('Delete', 'link-btn danger', async () => {
          const ok = await confirmAction({
            title: 'Delete this category?',
            message: `“${category.name}” will be removed. A category holding posts cannot be deleted until they are moved.`,
          });
          if (!ok) return;
          try {
            await call(() => api.del(`/admin/categories/${category.id}`));
            toast('Category deleted.');
            categoriesCache = null;
            viewCategories();
          } catch (error) { toastError(error); }
        }));

        return [
          el('span', 'cell-title', category.name),
          el('span', 'cell-muted', `/${category.slug}`),
          category.description || '—',
          el('span', 'cell-muted', `${category.published_count || 0} live · ${category.post_count || 0} total`),
          actions,
        ];
      });

      const categoriesCard = card('Categories', dataTable(['Name', 'Slug', 'Description', 'Posts', 'Actions'], rows));
      viewRoot.appendChild(categoriesCard);

      const tagItems = (tags.items || []).filter((tag) => tag.post_count > 0);
      const tagWrap = el('div', 'chip-list');
      if (!tagItems.length) {
        tagWrap.appendChild(el('p', 'muted', 'Tags appear here once they are used on a post.'));
      } else {
        tagItems.forEach((tag) => {
          const chip = el('span', 'tag-chip');
          chip.appendChild(el('span', '', tag.name));
          chip.appendChild(el('span', 'tag-count', String(tag.post_count)));
          chip.appendChild(btn('×', '', async () => {
            const ok = await confirmAction({
              title: 'Remove this tag?',
              message: `“${tag.name}” will be detached from every post. The posts themselves are untouched.`,
              confirmLabel: 'Remove tag',
            });
            if (!ok) return;
            try {
              await call(() => api.del(`/admin/categories/tags/${tag.id}`));
              toast('Tag removed.');
              viewCategories();
            } catch (error) { toastError(error); }
          }));
          tagWrap.appendChild(chip);
        });
      }
      viewRoot.appendChild(card('Tags in use', tagWrap));
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'Categories could not be loaded.', viewCategories));
    }
  }

  function openCategoryForm(category) {
    const isEdit = Boolean(category);
    const form = document.createElement('form');
    form.setAttribute('novalidate', '');
    form.innerHTML = `
      <div class="form-banner" role="alert"></div>
      <div class="stack">
        <div class="field">
          <label for="cat-name">Name <span class="req">*</span></label>
          <input id="cat-name" name="name" maxlength="80" autocomplete="off" />
          <span class="field-error" data-error-for="name"></span>
        </div>
        <div class="field">
          <label for="cat-slug">Slug</label>
          <input id="cat-slug" name="slug" maxlength="90" placeholder="auto from name" autocomplete="off" />
          <span class="hint">Lowercase letters, numbers and hyphens.</span>
          <span class="field-error" data-error-for="slug"></span>
        </div>
        <div class="field">
          <label for="cat-description">Description</label>
          <textarea id="cat-description" name="description" maxlength="300" style="min-height:90px;"></textarea>
          <span class="field-error" data-error-for="description"></span>
        </div>
      </div>
    `;

    if (category) {
      form.querySelector('[name="name"]').value = category.name || '';
      form.querySelector('[name="slug"]').value = category.slug || '';
      form.querySelector('[name="description"]').value = category.description || '';
    }

    const saveButton = btn(isEdit ? 'Save category' : 'Create category', 'btn-primary', async () => {
      clearFieldErrors(form);
      const payload = {
        name: form.querySelector('[name="name"]').value.trim(),
        slug: form.querySelector('[name="slug"]').value.trim(),
        description: form.querySelector('[name="description"]').value.trim(),
      };
      if (!payload.name) {
        applyFieldErrors(form, { name: 'Add a category name.' });
        return;
      }
      await withBusy(saveButton, 'Saving…', async () => {
        try {
          if (isEdit) await call(() => api.put(`/admin/categories/${category.id}`, payload));
          else await call(() => api.post('/admin/categories', payload));
          closeModal();
          toast(isEdit ? 'Category updated.' : 'Category created.');
          categoriesCache = null;
          viewCategories();
        } catch (error) {
          if (error.status === 401) return;
          const fields = (error && error.fields) || {};
          if (Object.keys(fields).length) applyFieldErrors(form, fields);
          formBanner(form, (error && error.message) || 'The category could not be saved.');
        }
      });
    });

    openModal({
      title: isEdit ? 'Edit category' : 'New category',
      body: form,
      actions: [btn('Cancel', 'btn-outline', closeModal), saveButton],
    });
  }

  /* ── books ─────────────────────────────────────────────────────────────── */

  const booksState = { page: 1, status: '', q: '', perPage: 20 };

  function bookStatusLabel(status) {
    const found = BOOK_STATUS_OPTIONS.find(([value]) => value === status);
    return found ? found[1] : status || '—';
  }

  async function viewBooks() {
    const token = ++activeView;
    setHeader('Books', [btn('+ New Book', 'btn-primary', () => navigate('#/books/new'))]);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Loading books…'));

    try {
      if (token !== activeView) return;
      clear(viewRoot);
      const container = el('div', 'card');
      viewRoot.appendChild(buildBookFilters(() => loadBooksList(container, token), () => {
        booksState.page = 1;
        booksState.status = '';
        booksState.q = '';
        loadBooksList(container, token);
      }));
      viewRoot.appendChild(container);
      await loadBooksList(container, token);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'Books could not be loaded.', viewBooks));
    }
  }

  function buildBookFilters(onChange, onReset) {
    const bar = el('div', 'filter-bar');

    const status = el('select');
    status.setAttribute('aria-label', 'Filter by status');
    fillSelect(status, BOOK_STATUS_OPTIONS.map(([value, label]) => ({ value, label })), (item) => item.value, (item) => item.label, 'All statuses');
    status.value = booksState.status;
    status.addEventListener('change', () => {
      booksState.status = status.value;
      booksState.page = 1;
      onChange();
    });

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search books…';
    search.value = booksState.q;
    search.setAttribute('aria-label', 'Search books');
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        booksState.q = search.value.trim();
        booksState.page = 1;
        onChange();
      }, 320);
    });

    bar.appendChild(status);
    bar.appendChild(search);
    bar.appendChild(btn('Reset', 'btn-outline btn-small', onReset));
    return bar;
  }

  async function loadBooksList(container, token) {
    clear(container);
    container.appendChild(loadingBlock('Loading books…'));

    try {
      const params = new URLSearchParams({
        page: String(booksState.page),
        per_page: String(booksState.perPage),
      });
      if (booksState.status) params.set('status', booksState.status);
      if (booksState.q) params.set('q', booksState.q);

      const data = await call(() => api.get(`/admin/books?${params.toString()}`));
      if (token !== activeView) return;
      clear(container);

      const items = data.items || [];
      if (!items.length) {
        container.appendChild(emptyBlock(
          'No books yet',
          'Add a book to give readers a place to follow the writing.',
          btn('+ New Book', 'btn-primary btn-small', () => navigate('#/books/new'))
        ));
      } else {
        const rows = items.map((book) => {
          const titleCell = el('div');
          titleCell.appendChild(el('span', 'cell-title', book.title || '(untitled)'));
          if (book.subtitle) titleCell.appendChild(el('span', 'cell-sub', book.subtitle));

          const actions = el('div', 'row-actions');
          actions.appendChild(btn('Edit', 'link-btn', () => navigate(`#/books/${book.id}`)));
          actions.appendChild(btn('Delete', 'link-btn danger', async () => {
            const ok = await confirmAction({
              title: 'Delete this book?',
              message: `“${book.title}” will be permanently removed from the library.`,
            });
            if (!ok) return;
            try {
              await call(() => api.del(`/admin/books/${book.id}`));
              toast('Book deleted.');
              loadBooksList(container, token);
              refreshMessageBadge();
            } catch (error) { toastError(error); }
          }));

          const progress = el('div', 'book-progress-cell');
          progress.appendChild(el('span', '', `${Number(book.progress_percent) || 0}%`));
          progress.appendChild(el('span', 'cell-sub', book.progress_note || bookStatusLabel(book.status)));

          return [
            titleCell,
            el('span', 'badge badge-category', bookStatusLabel(book.status)),
            progress,
            formatDate(book.release_date, 'short'),
            actions,
          ];
        });

        container.appendChild(dataTable(['Book', 'Status', 'Progress', 'Release', 'Actions'], rows));
      }

      const pagination = paginationBlock(data.pagination, (page) => {
        booksState.page = page;
        loadBooksList(container, token);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      if (pagination) container.appendChild(pagination);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(container);
      container.appendChild(errorBlock(error.message || 'Books could not be loaded.', () => loadBooksList(container, token)));
    }
  }

  async function viewBookEditor(id) {
    const token = ++activeView;
    setHeader(id ? 'Edit book' : 'New book', [btn('← Books', 'btn-outline', () => navigate('#/books'))]);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Opening the book…'));

    try {
      const book = id ? (await call(() => api.get(`/admin/books/${id}`))).book : null;
      if (token !== activeView) return;
      if (id && !book) {
        clear(viewRoot);
        viewRoot.appendChild(emptyBlock('Book not found', 'It may have been deleted.', btn('Back to books', 'btn-outline', () => navigate('#/books'))));
        return;
      }
      renderBookEditor(book);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'The book could not be opened.', () => viewBookEditor(id)));
    }
  }

  function renderBookEditor(book) {
    clear(viewRoot);
    const isEdit = Boolean(book);

    const form = document.createElement('form');
    form.id = 'book-form';
    form.setAttribute('novalidate', '');
    form.innerHTML = `
      <div class="form-banner" role="alert"></div>
      <div class="card">
        <div class="card-body">
          <div class="form-grid">
            <div class="field span-2">
              <label for="book-title">Title <span class="req">*</span></label>
              <input id="book-title" name="title" maxlength="200" autocomplete="off" />
              <span class="field-error" data-error-for="title"></span>
            </div>
            <div class="field span-2">
              <label for="book-subtitle">Subtitle</label>
              <input id="book-subtitle" name="subtitle" maxlength="300" autocomplete="off" />
              <span class="field-error" data-error-for="subtitle"></span>
            </div>
            <div class="field span-2">
              <label for="book-introduction">Introduction</label>
              <textarea id="book-introduction" name="introduction" maxlength="4000"></textarea>
              <span class="field-error" data-error-for="introduction"></span>
            </div>
            <div class="field span-2">
              <label for="book-synopsis">Synopsis</label>
              <textarea id="book-synopsis" name="synopsis" maxlength="12000" style="min-height:160px;"></textarea>
              <span class="field-error" data-error-for="synopsis"></span>
            </div>
            <div class="field">
              <label for="book-progress">Progress (%)</label>
              <input id="book-progress" name="progress_percent" type="number" min="0" max="100" step="1" />
              <div class="progress-track mt-1"><div class="progress-fill" id="book-progress-fill"></div></div>
              <span class="field-error" data-error-for="progress_percent"></span>
            </div>
            <div class="field">
              <label for="book-progress-note">Progress note</label>
              <input id="book-progress-note" name="progress_note" maxlength="120" placeholder="e.g. Second draft" />
              <span class="field-error" data-error-for="progress_note"></span>
            </div>
            <div class="field">
              <label for="book-status">Status</label>
              <select id="book-status" name="status"></select>
              <span class="field-error" data-error-for="status"></span>
            </div>
            <div class="field">
              <label for="book-release">Release date</label>
              <input id="book-release" name="release_date" type="date" />
              <span class="field-error" data-error-for="release_date"></span>
            </div>
            <div class="field span-2">
              <span class="field-label">Cover image</span>
              <div id="book-cover-slot"></div>
              <span class="field-error" data-error-for="cover_image_id"></span>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-primary" type="submit" id="book-save">${isEdit ? 'Save book' : 'Create book'}</button>
            ${isEdit ? '<button class="btn-danger" type="button" id="book-delete">Delete book</button>' : ''}
            <a class="btn-outline" href="book.html" target="_blank" rel="noopener">Preview books page</a>
          </div>
        </div>
      </div>
    `;
    viewRoot.appendChild(form);

    fillSelect(form.querySelector('[name="status"]'), BOOK_STATUS_OPTIONS.map(([value, label]) => ({ value, label })), (item) => item.value, (item) => item.label);
    setValue(form, 'title', book ? book.title : '');
    setValue(form, 'subtitle', book ? book.subtitle : '');
    setValue(form, 'introduction', book ? book.introduction : '');
    setValue(form, 'synopsis', book ? book.synopsis : '');
    setValue(form, 'progress_percent', book ? book.progress_percent : 0);
    setValue(form, 'progress_note', book ? book.progress_note : '');
    setValue(form, 'status', book ? (book.status || 'drafting') : 'drafting');
    setValue(form, 'release_date', book ? book.release_date : '');

    const fill = form.querySelector('#book-progress-fill');
    const progressInput = form.querySelector('[name="progress_percent"]');
    function updateProgress() {
      const value = Math.max(0, Math.min(100, Number(progressInput.value) || 0));
      fill.style.width = `${value}%`;
    }
    updateProgress();
    progressInput.addEventListener('input', updateProgress);

    const uploader = createUploader({
      initial: book ? book.cover : null,
      label: book && book.cover ? 'Replace cover' : 'Choose cover',
      emptyText: 'No cover selected',
    });
    form.querySelector('#book-cover-slot').appendChild(uploader.node);

    const saveButton = form.querySelector('#book-save');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFieldErrors(form);
      const payload = {
        title: getValue(form, 'title').trim(),
        subtitle: getValue(form, 'subtitle').trim(),
        introduction: getValue(form, 'introduction'),
        synopsis: getValue(form, 'synopsis'),
        progress_percent: Number(getValue(form, 'progress_percent')) || 0,
        progress_note: getValue(form, 'progress_note').trim(),
        status: getValue(form, 'status'),
        release_date: getValue(form, 'release_date') || null,
        cover_image_id: uploader.getValue(),
      };
      if (!payload.title) {
        applyFieldErrors(form, { title: 'Add the book title.' });
        formBanner(form, 'Please fix the highlighted fields.');
        return;
      }

      await withBusy(saveButton, 'Saving…', async () => {
        try {
          const result = isEdit
            ? await call(() => api.put(`/admin/books/${book.id}`, payload))
            : await call(() => api.post('/admin/books', payload));
          toast(isEdit ? 'Book saved.' : 'Book created.');
          navigate(`#/books/${result.book.id}`);
        } catch (error) {
          if (error.status === 401) return;
          const fields = (error && error.fields) || {};
          if (Object.keys(fields).length) applyFieldErrors(form, fields);
          formBanner(form, (error && error.message) || 'The book could not be saved.');
        }
      });
    });

    if (isEdit) {
      const deleteButton = form.querySelector('#book-delete');
      deleteButton.addEventListener('click', async () => {
        const ok = await confirmAction({
          title: 'Delete this book?',
          message: `“${book.title}” will be permanently removed from the library.`,
          confirmLabel: 'Delete book',
        });
        if (!ok) return;
        await withBusy(deleteButton, 'Deleting…', async () => {
          try {
            await call(() => api.del(`/admin/books/${book.id}`));
            toast('Book deleted.');
            navigate('#/books');
          } catch (error) { toastError(error); }
        });
      });
    }

    requestAnimationFrame(() => form.querySelector('#book-title').focus());
  }

  /* ── author profile ───────────────────────────────────────────────────── */

  async function viewAuthor() {
    const token = ++activeView;
    setHeader('Author Profile', [link('View about page', 'about.html', 'btn-outline', true)]);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Loading the author profile…'));

    try {
      const data = await call(() => api.get('/admin/author'));
      if (token !== activeView) return;
      const author = data.author || {};
      const socials = author.social_links || {};
      clear(viewRoot);

      const socialFields = SOCIAL_FIELDS.map(([key, label]) => `
        <div class="field">
          <label for="author-social-${key}">${label}</label>
          <input id="author-social-${key}" name="social_${key}" maxlength="500" placeholder="https://" autocomplete="off" />
          <span class="field-error" data-error-for="social_${key}"></span>
        </div>
      `).join('');

      const form = document.createElement('form');
      form.id = 'author-form';
      form.setAttribute('novalidate', '');
      form.innerHTML = `
        <div class="form-banner" role="alert"></div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>The person</h2></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="field">
                  <label for="author-name">Name <span class="req">*</span></label>
                  <input id="author-name" name="name" maxlength="120" />
                  <span class="field-error" data-error-for="name"></span>
                </div>
                <div class="field">
                  <label for="author-pen">Pen name</label>
                  <input id="author-pen" name="pen_name" maxlength="120" />
                  <span class="field-error" data-error-for="pen_name"></span>
                </div>
                <div class="field span-2">
                  <label for="author-tagline">Tagline</label>
                  <input id="author-tagline" name="tagline" maxlength="240" />
                  <span class="field-error" data-error-for="tagline"></span>
                </div>
                <div class="field span-2">
                  <label for="author-introduction">Introduction</label>
                  <textarea id="author-introduction" name="introduction" maxlength="4000"></textarea>
                  <span class="field-error" data-error-for="introduction"></span>
                </div>
                <div class="field span-2">
                  <label for="author-biography">Biography</label>
                  <textarea id="author-biography" name="biography" maxlength="12000" style="min-height:140px;"></textarea>
                  <span class="field-error" data-error-for="biography"></span>
                </div>
                <div class="field span-2">
                  <label for="author-personal">Beyond the page</label>
                  <textarea id="author-personal" name="personal_description" maxlength="8000"></textarea>
                  <span class="field-error" data-error-for="personal_description"></span>
                </div>
                <div class="field">
                  <label for="author-interests">Writing interests</label>
                  <input id="author-interests" name="writing_interests" maxlength="500" placeholder="Essays · Poetry · Observation" />
                  <span class="field-error" data-error-for="writing_interests"></span>
                </div>
                <div class="field">
                  <label for="author-location">Location</label>
                  <input id="author-location" name="location" maxlength="120" />
                  <span class="field-error" data-error-for="location"></span>
                </div>
                <div class="field">
                  <label for="author-email">Public email</label>
                  <input id="author-email" name="public_email" type="email" maxlength="200" />
                  <span class="field-error" data-error-for="public_email"></span>
                </div>
                <div class="field">
                  <span class="field-label">Profile image</span>
                  <div id="author-image-slot"></div>
                  <span class="field-error" data-error-for="profile_image_id"></span>
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2>Elsewhere on the internet</h2></div>
            <div class="card-body">
              <div class="form-grid">${socialFields}</div>
              <p class="hint mt-1">Full links starting with http:// or https://. Empty fields are hidden.</p>
            </div>
          </div>

          <div class="form-actions">
            <button class="btn-primary" type="submit" id="author-save">Save author profile</button>
            <a class="btn-outline" href="about.html" target="_blank" rel="noopener">Preview about page</a>
          </div>
        </div>
      `;
      viewRoot.appendChild(form);

      const textFields = [
        'name', 'pen_name', 'tagline', 'introduction', 'biography',
        'personal_description', 'writing_interests', 'location', 'public_email',
      ];
      textFields.forEach((name) => setValue(form, name, author[name]));
      SOCIAL_FIELDS.forEach(([key]) => setValue(form, `social_${key}`, socials[key]));

      const uploader = createUploader({ initial: author.profile_image, label: 'Choose portrait', emptyText: 'No portrait selected' });
      form.querySelector('#author-image-slot').appendChild(uploader.node);

      const saveButton = form.querySelector('#author-save');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFieldErrors(form);
        const social_links = {};
        SOCIAL_FIELDS.forEach(([key]) => {
          social_links[key] = getValue(form, `social_${key}`).trim();
        });

        const payload = {
          name: getValue(form, 'name').trim(),
          pen_name: getValue(form, 'pen_name').trim(),
          tagline: getValue(form, 'tagline').trim(),
          introduction: getValue(form, 'introduction'),
          biography: getValue(form, 'biography'),
          writing_interests: getValue(form, 'writing_interests').trim(),
          personal_description: getValue(form, 'personal_description'),
          location: getValue(form, 'location').trim(),
          public_email: getValue(form, 'public_email').trim(),
          profile_image_id: uploader.getValue(),
          social_links,
        };
        if (!payload.name) {
          applyFieldErrors(form, { name: 'Add the author name.' });
          return;
        }

        await withBusy(saveButton, 'Saving…', async () => {
          try {
            await call(() => api.put('/admin/author', payload));
            formBanner(form, 'Author profile saved.', true);
            toast('Author profile saved.');
          } catch (error) {
            if (error.status === 401) return;
            const fields = (error && error.fields) || {};
            if (Object.keys(fields).length) applyFieldErrors(form, fields);
            formBanner(form, (error && error.message) || 'The author profile could not be saved.');
          }
        });
      });
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'The author profile could not be loaded.', viewAuthor));
    }
  }

  /* ── messages ─────────────────────────────────────────────────────────── */

  const messagesState = { page: 1, status: '', category: '', q: '', perPage: 20 };

  async function viewMessages() {
    const token = ++activeView;
    setHeader('Messages', [btn('Refresh', 'btn-outline', () => loadMessageList(container, token))]);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Opening the inbox…'));

    let container;

    try {
      if (token !== activeView) return;
      clear(viewRoot);

      container = el('div', 'card');
      const filters = buildMessageFilters(() => loadMessageList(container, token), () => {
        messagesState.page = 1;
        messagesState.status = '';
        messagesState.category = '';
        messagesState.q = '';
        loadMessageList(container, token);
      });
      viewRoot.appendChild(filters);
      viewRoot.appendChild(container);
      await loadMessageList(container, token);
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'Messages could not be loaded.', viewMessages));
    }
  }

  function buildMessageFilters(onChange, onReset) {
    const bar = el('div', 'filter-bar');

    const status = el('select');
    status.setAttribute('aria-label', 'Filter by read status');
    fillSelect(status, [
      { value: '', label: 'All messages' },
      { value: 'unread', label: 'Unread' },
      { value: 'read', label: 'Read' },
    ], (item) => item.value, (item) => item.label);
    status.value = messagesState.status;
    status.addEventListener('change', () => { messagesState.status = status.value; messagesState.page = 1; onChange(); });

    const category = el('select');
    category.setAttribute('aria-label', 'Filter by message category');
    fillSelect(category, Object.entries(CONTACT_CATEGORY_LABELS).map(([value, label]) => ({ value, label })), (item) => item.value, (item) => item.label, 'All topics');
    category.value = messagesState.category;
    category.addEventListener('change', () => { messagesState.category = category.value; messagesState.page = 1; onChange(); });

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search name, email or message…';
    search.value = messagesState.q;
    search.setAttribute('aria-label', 'Search messages');
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        messagesState.q = search.value.trim();
        messagesState.page = 1;
        onChange();
      }, 320);
    });

    bar.appendChild(status);
    bar.appendChild(category);
    bar.appendChild(search);
    bar.appendChild(btn('Reset', 'btn-outline btn-small', onReset));
    return bar;
  }

  async function loadMessageList(container, token) {
    if (!container) return;
    clear(container);
    container.appendChild(loadingBlock('Loading messages…'));

    try {
      const params = new URLSearchParams({ page: String(messagesState.page), per_page: String(messagesState.perPage) });
      if (messagesState.status) params.set('status', messagesState.status);
      if (messagesState.category) params.set('category', messagesState.category);
      if (messagesState.q) params.set('q', messagesState.q);

      const data = await call(() => api.get(`/admin/messages?${params.toString()}`));
      if (token !== activeView) return;
      clear(container);

      const counts = data.counts || { total: 0, unread: 0 };
      const head = el('div', 'card-head');
      head.appendChild(el('h2', '', `${counts.total} message${counts.total === 1 ? '' : 's'} · ${counts.unread} unread`));
      head.appendChild(btn('Refresh', 'btn-outline btn-small', () => loadMessageList(container, token)));
      container.appendChild(head);

      const items = data.items || [];
      if (!items.length) {
        container.appendChild(emptyBlock(
          'The inbox is empty',
          messagesState.q || messagesState.status || messagesState.category
            ? 'No messages match these filters.'
            : 'Messages sent through the contact form will arrive here.'
        ));
      } else {
        const list = el('div', 'message-list');
        items.forEach((message) => {
          const item = el('div', 'message-item' + (message.is_read ? '' : ' unread'));
          item.addEventListener('click', () => openMessage(message.id, () => loadMessageList(container, token)));

          const left = el('div');
          const from = el('div', 'message-from');
          if (!message.is_read) from.appendChild(el('span', 'dot-unread'));
          from.appendChild(document.createTextNode(message.name || 'Unknown'));
          from.appendChild(document.createTextNode(` · ${message.email || ''}`));
          left.appendChild(from);
          left.appendChild(el('div', 'message-subject', message.subject || '(no subject)'));
          left.appendChild(el('div', 'message-preview', message.preview || ''));

          const right = el('div', 'message-side');
          right.appendChild(el('span', 'badge badge-category', CONTACT_CATEGORY_LABELS[message.category] || message.category || ''));
          right.appendChild(el('span', '', formatDate(message.created_at, 'short')));
          const actions = el('div', 'row-actions');
          actions.appendChild(btn(message.is_read ? 'Mark unread' : 'Mark read', 'link-btn', async (event) => {
            event.stopPropagation();
            try {
              await call(() => api.patch(`/admin/messages/${message.id}`, { is_read: !message.is_read }));
              toast(message.is_read ? 'Marked unread.' : 'Marked read.');
              loadMessageList(container, token);
              refreshMessageBadge();
            } catch (error) { toastError(error); }
          }));
          actions.appendChild(btn('Delete', 'link-btn danger', async (event) => {
            event.stopPropagation();
            const ok = await confirmAction({
              title: 'Delete this message?',
              message: `The message from ${message.name || 'this reader'} will be permanently removed.`,
            });
            if (!ok) return;
            try {
              await call(() => api.del(`/admin/messages/${message.id}`));
              toast('Message deleted.');
              loadMessageList(container, token);
              refreshMessageBadge();
            } catch (error) { toastError(error); }
          }));
          right.appendChild(actions);
          item.appendChild(left);
          item.appendChild(right);
          list.appendChild(item);
        });
        container.appendChild(list);
      }

      const pagination = paginationBlock(data.pagination, (page) => {
        messagesState.page = page;
        loadMessageList(container, token);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      if (pagination) container.appendChild(pagination);

      refreshMessageBadge();
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(container);
      container.appendChild(errorBlock(error.message || 'Messages could not be loaded.', () => loadMessageList(container, token)));
    }
  }

  async function openMessage(id, onRead) {
    try {
      const data = await call(() => api.get(`/admin/messages/${id}`));
      const message = data.message;
      if (!message) {
        toast('Message not found.', 'error');
        return;
      }

      const wrap = el('div');
      const head = el('div', 'message-detail-head');
      head.appendChild(el('h4', 'message-detail-subject', message.subject || '(no subject)'));
      const meta = el('div', 'message-detail-meta');
      meta.appendChild(el('span', '', message.name || 'Unknown sender'));
      const email = el('a', '', message.email || '');
      email.href = `mailto:${message.email || ''}`;
      meta.appendChild(email);
      meta.appendChild(el('span', 'badge badge-category', CONTACT_CATEGORY_LABELS[message.category] || message.category || ''));
      meta.appendChild(el('span', '', formatDateTime(message.created_at)));
      head.appendChild(meta);
      wrap.appendChild(head);

      const body = el('div', 'message-detail-body');
      renderContent(body, message.message || '');
      wrap.appendChild(body);

      const actions = [];
      const reply = el('a', 'btn-outline', 'Reply by email');
      reply.href = `mailto:${message.email || ''}?subject=${encodeURIComponent(`Re: ${message.subject || 'Your message'}`)}`;
      actions.push(reply);

      if (message.is_read) {
        actions.push(btn('Mark unread', 'btn-outline', async () => {
          try {
            await call(() => api.patch(`/admin/messages/${message.id}`, { is_read: false }));
            closeModal();
            toast('Marked unread.');
            if (typeof onRead === 'function') onRead();
            refreshMessageBadge();
          } catch (error) { toastError(error); }
        }));
      }

      actions.push(btn('Delete', 'btn-danger', async () => {
        const ok = await confirmAction({
          title: 'Delete this message?',
          message: `The message from ${message.name || 'this reader'} will be permanently removed.`,
        });
        if (!ok) return;
        try {
          await call(() => api.del(`/admin/messages/${message.id}`));
          closeModal();
          toast('Message deleted.');
          if (typeof onRead === 'function') onRead();
          refreshMessageBadge();
        } catch (error) { toastError(error); }
      }));

      actions.push(btn('Close', 'btn-outline', closeModal));

      openModal({
        title: 'Message',
        body: wrap,
        actions,
        wide: true,
      });

      // Opening a message marks it as read on the server.
      if (typeof onRead === 'function') onRead();
      refreshMessageBadge();
    } catch (error) {
      toastError(error);
    }
  }

  /* ── account ──────────────────────────────────────────────────────────── */

  async function viewAccount() {
    const token = ++activeView;
    setHeader('Account', []);
    clear(viewRoot);
    viewRoot.appendChild(loadingBlock('Loading your account…'));

    try {
      const data = await call(() => api.get('/auth/me'));
      if (token !== activeView) return;
      const admin = data.admin || currentAdmin || {};
      clear(viewRoot);

      const details = el('dl', 'kv');
      details.appendChild(el('dt', '', 'Username'));
      details.appendChild(el('dd', '', admin.username || '—'));
      details.appendChild(el('dt', '', 'Last sign in'));
      details.appendChild(el('dd', '', formatDateTime(admin.last_login_at)));
      details.appendChild(el('dt', '', 'Session'));
      details.appendChild(el('dd', '', 'Signed in with a secure, HttpOnly cookie.'));

      viewRoot.appendChild(card('Your account', (() => {
        const body = el('div');
        body.appendChild(details);
        const logoutWrap = el('div', 'mt-2');
        const logoutBtn = btn('Sign out of this device', 'btn-outline', logout);
        logoutBtn.id = 'account-logout';
        logoutWrap.appendChild(logoutBtn);
        body.appendChild(logoutWrap);
        return body;
      })()));

      const form = document.createElement('form');
      form.setAttribute('novalidate', '');
      form.innerHTML = `
        <div class="form-banner" role="alert"></div>
        <div class="form-grid">
          <div class="field span-2">
            <label for="pass-current">Current password <span class="req">*</span></label>
            <input id="pass-current" name="current_password" type="password" autocomplete="current-password" />
            <span class="field-error" data-error-for="current_password"></span>
          </div>
          <div class="field">
            <label for="pass-new">New password <span class="req">*</span></label>
            <input id="pass-new" name="new_password" type="password" autocomplete="new-password" />
            <span class="hint">At least 10 characters.</span>
            <span class="field-error" data-error-for="new_password"></span>
          </div>
          <div class="field">
            <label for="pass-confirm">Confirm new password <span class="req">*</span></label>
            <input id="pass-confirm" name="confirm_password" type="password" autocomplete="new-password" />
            <span class="field-error" data-error-for="confirm_password"></span>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-primary" type="submit" id="password-save">Change password</button>
        </div>
        <p class="note-box mt-2">Changing your password signs out every other device. This session stays signed in. Never reuse a password you use elsewhere.</p>
      `;
      viewRoot.appendChild(card('Change password', form));

      const saveButton = form.querySelector('#password-save');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFieldErrors(form);
        const current = getValue(form, 'current_password');
        const next = getValue(form, 'new_password');
        const confirm = getValue(form, 'confirm_password');

        const errors = {};
        if (!current) errors.current_password = 'Enter your current password.';
        if (!next) errors.new_password = 'Enter a new password.';
        else if (next.length < 10) errors.new_password = 'Use at least 10 characters.';
        if (next && next !== confirm) errors.confirm_password = 'The passwords do not match.';
        if (Object.keys(errors).length) {
          applyFieldErrors(form, errors);
          return;
        }

        await withBusy(saveButton, 'Changing…', async () => {
          try {
            await call(() => api.post('/auth/password', { current_password: current, new_password: next }));
            form.reset();
            clearFieldErrors(form);
            formBanner(form, 'Password changed. Other sessions have been signed out.', true);
            toast('Password changed.');
          } catch (error) {
            if (error.status === 401) return;
            const fields = (error && error.fields) || {};
            if (Object.keys(fields).length) applyFieldErrors(form, fields);
            formBanner(form, (error && error.message) || 'The password could not be changed.');
          }
        });
      });
    } catch (error) {
      if (token !== activeView) return;
      if (error.status === 401) return;
      clear(viewRoot);
      viewRoot.appendChild(errorBlock(error.message || 'Your account could not be loaded.', viewAccount));
    }
  }

  /* ── global UI events ─────────────────────────────────────────────────── */

  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modalOverlay.hidden) closeModal();
  });

  boot();
})();
