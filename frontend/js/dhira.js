'use strict';

/**
 * Tiny shared helper layer for the public site.
 * All author-supplied text is inserted with textContent — never innerHTML.
 */
(function () {
  const config = window.DHIRA_CONFIG || { API_BASE: '/api' };
  const base = String(config.API_BASE || '/api').replace(/\/+$/, '');

  let csrfToken = null;
  let csrfRequest = null;

  async function getCsrfToken(force) {
    if (csrfToken && !force) return csrfToken;
    if (!csrfRequest) {
      csrfRequest = fetch(`${base}/csrf`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('Could not start a secure session.');
          const data = await res.json();
          csrfToken = data.csrfToken;
          return csrfToken;
        })
        .finally(() => {
          csrfRequest = null;
        });
    }
    return csrfRequest;
  }

  async function request(method, path, body, attempt) {
    const isForm = body instanceof FormData;
    const headers = { Accept: 'application/json' };

    if (method !== 'GET' && method !== 'HEAD') {
      headers['X-CSRF-Token'] = await getCsrfToken();
      if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    }

    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
    } catch (cause) {
      const error = new Error('Could not reach the server. Check your connection and try again.');
      error.status = 0;
      error.cause = cause;
      throw error;
    }

    let data = null;
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      data = await res.json().catch(() => null);
    }

    if (!res.ok) {
      // An expired CSRF cookie is recoverable: fetch a new token and retry once.
      if (res.status === 403 && method !== 'GET' && !attempt) {
        csrfToken = null;
        return request(method, path, body, true);
      }

      const error = new Error((data && data.error) || `Something went wrong (${res.status}).`);
      error.status = res.status;
      error.fields = (data && data.fields) || null;
      error.data = data;
      throw error;
    }

    return data;
  }

  const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
    upload(file) {
      const form = new FormData();
      form.append('image', file);
      return request('POST', '/admin/uploads', form);
    },
  };

  /* ── formatting ─────────────────────────────────────────────────────────── */

  function formatDate(value, style) {
    if (!value) return '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const options =
      style === 'short'
        ? { year: 'numeric', month: 'short', day: 'numeric' }
        : { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-IN', options);
  }

  function assetUrl(path) {
    if (!path) return '';
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    return `${base.replace(/\/api$/, '')}${path}`;
  }

  function excerpt(text, max) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    const limit = max || 180;
    if (flat.length <= limit) return flat;
    return `${flat.slice(0, limit).replace(/\s+\S*$/, '')}…`;
  }

  function readingTime(minutes) {
    const value = Number(minutes) || 1;
    return `${value} min read`;
  }

  /* ── safe DOM helpers ───────────────────────────────────────────────────── */

  /** Build an element. User text always goes through textContent. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Render plain text with preserved line breaks and stanza spacing. */
  function renderContent(target, text) {
    clear(target);
    const blocks = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/);

    for (const block of blocks) {
      const trimmed = block.replace(/^\n+|\n+$/g, '');
      if (!trimmed.trim()) continue;
      const p = document.createElement('p');
      p.textContent = trimmed;
      target.appendChild(p);
    }
    return target;
  }

  function showState(container, options) {
    clear(container);
    const wrap = el('div', options.error ? 'state-card state-error' : 'state-card');
    wrap.appendChild(el('p', 'state-title', options.title || (options.error ? 'Something went wrong' : 'Nothing here yet')));
    if (options.message) wrap.appendChild(el('p', 'state-message', options.message));
    if (options.actionLabel && typeof options.onAction === 'function') {
      const button = el('button', 'btn-send state-action', options.actionLabel);
      button.type = 'button';
      button.addEventListener('click', options.onAction);
      wrap.appendChild(button);
    }
    container.appendChild(wrap);
    return wrap;
  }

  function loading(container, label) {
    clear(container);
    const wrap = el('div', 'loading-state');
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.appendChild(el('span', 'loading-dot'));
    wrap.appendChild(el('span', '', label || 'Loading…'));
    container.appendChild(wrap);
    return wrap;
  }

  /* ── navigation ─────────────────────────────────────────────────────────── */

  function setupNav() {
    const toggle = document.getElementById('nav-toggle');
    const links = document.getElementById('nav-links');
    if (!toggle || !links) return;

    const close = () => {
      document.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
    };

    toggle.addEventListener('click', () => {
      const open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });

    links.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 1080) close();
    });
  }

  document.addEventListener('DOMContentLoaded', setupNav);

  window.Dhira = {
    api,
    assetUrl,
    formatDate,
    excerpt,
    readingTime,
    el,
    clear,
    renderContent,
    showState,
    loading,
    categoryLabels: {
      general: 'General',
      reader: 'Reader message',
      book: 'About the book',
      poetry: 'Poetry',
      other: 'Other',
      progress: 'Writing progress',
      chapter: 'Chapter news',
      cover_reveal: 'Cover reveal',
      milestone: 'Milestone',
      announcement: 'Announcement',
      release_date: 'Release date',
      behind_the_scenes: 'Behind the scenes',
    },
    bookStatusLabels: {
      drafting: 'Drafting',
      editing: 'Editing',
      with_editor: 'With editor',
      cover_design: 'Cover design',
      preorder: 'Pre-order',
      published: 'Published',
    },
  };
})();
