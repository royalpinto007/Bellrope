import { ago, intervalLabel } from './src/schedule.js';
import * as store from './src/store.js';
import type { Interval, Watch } from './src/types.js';
import { sortWatches, statusOf, type Status } from './src/watch.js';

/**
 * The panel.
 *
 * Rendered from storage every time rather than from anything held here: the
 * worker that writes a change can run while this panel is closed, and can be
 * evicted between two of its own messages.
 */

const watchBtn = must<HTMLButtonElement>('watch-btn');
const checkAllBtn = must<HTMLButtonElement>('check-all');
const intervalSelect = must<HTMLSelectElement>('interval');
const listEl = must<HTMLElement>('list');
const toastEl = must<HTMLElement>('toast');
const toastText = must<HTMLElement>('toast-text');
const countEl = must<HTMLElement>('count');
const searchWrap = must<HTMLElement>('search-wrap');
const searchInput = must<HTMLInputElement>('search');
const searchClear = must<HTMLButtonElement>('search-clear');
const filterTabs = must<HTMLElement>('filter-tabs');

/** Which watches have their history open, kept across re-renders. */
const expanded = new Set<string>();
let statusFilter: Status | 'all' = 'all';
let query = '';

watchBtn.addEventListener('click', () => void startWatch());
checkAllBtn.addEventListener('click', () => void checkAll());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'WATCHES_CHANGED') void render();
  if (message?.type === 'START_PICK') void startWatch();
  return undefined;
});

void render();

/**
 * Ask for page access, once, from the panel.
 *
 * A click inside the side panel does not grant activeTab, and the background
 * checks need to fetch the watched page long after any tab is gone, so the
 * permission is a real one rather than a per-use grant. Asking here is the
 * only place a request can be tied to a genuine user gesture.
 */
async function ensureAccess(): Promise<boolean> {
  const request = { origins: ['<all_urls>'] };
  if (await chrome.permissions.contains(request)) return true;
  try {
    return await chrome.permissions.request(request);
  } catch {
    return false;
  }
}

function setBusy(busy: boolean, text: string): void {
  watchBtn.disabled = busy;
  watchBtn.classList.toggle('is-busy', busy);
  const label = watchBtn.querySelector('.primary-label');
  if (label) label.textContent = text;
}

async function startWatch(): Promise<void> {
  if (!(await ensureAccess())) {
    toast('Bellrope needs permission to read the pages it watches.');
    return;
  }

  const picked = await chrome.runtime.sendMessage({ type: 'PICK' });
  if (!picked?.ok) {
    if (picked?.error && picked.error !== 'Cancelled.') toast(picked.error);
    return;
  }

  setBusy(true, 'Setting up…');
  try {
    const created = await chrome.runtime.sendMessage({
      type: 'CREATE',
      picked: picked.picked,
      intervalMinutes: Number(intervalSelect.value) as Interval,
    });
    if (!created?.ok) {
      toast(created?.error ?? 'That could not be watched.');
      return;
    }
    await render();
    toast(created.note ?? 'Watching. You will be told when it changes.');
  } finally {
    setBusy(false, 'Watch something on this page');
  }
}

async function checkAll(): Promise<void> {
  checkAllBtn.disabled = true;
  checkAllBtn.textContent = 'Checking…';
  try {
    await chrome.runtime.sendMessage({ type: 'CHECK_ALL' });
    await render();
  } finally {
    checkAllBtn.disabled = false;
    checkAllBtn.textContent = 'Check all';
  }
}

function matches(watch: Watch, now: number): boolean {
  if (statusFilter !== 'all' && statusOf(watch, now) !== statusFilter) return false;
  if (query) {
    const hay = `${watch.label} ${watch.url} ${watch.text}`.toLowerCase();
    if (!hay.includes(query.toLowerCase())) return false;
  }
  return true;
}

async function render(): Promise<void> {
  const now = Date.now();
  const watches = await store.readAll();
  const news = watches.filter((w) => statusOf(w, now) === 'changed').length;

  countEl.textContent = watches.length
    ? `${watches.length} watch${watches.length === 1 ? '' : 'es'}`
    : '';
  countEl.classList.toggle('has-news', news > 0);

  const showChrome = watches.length > 0;
  searchWrap.hidden = !showChrome;
  filterTabs.hidden = !showChrome;
  searchClear.hidden = !query;
  for (const btn of filterTabs.querySelectorAll<HTMLButtonElement>('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === statusFilter));
  }

  if (!watches.length) {
    listEl.replaceChildren(empty());
    return;
  }

  const visible = sortWatches(watches, now).filter((w) => matches(w, now));
  if (!visible.length) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.append(
      art('🔍'),
      emptyTitle('Nothing matches that filter.'),
      emptyBody('Try a different search, or switch back to All watches.')
    );
    listEl.replaceChildren(el);
    return;
  }
  listEl.replaceChildren(...visible.map((w) => card(w, now)));
}

function art(emoji: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'empty-art';
  d.textContent = emoji;
  d.setAttribute('aria-hidden', 'true');
  return d;
}

function emptyTitle(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'empty-title';
  el.textContent = text;
  return el;
}

function emptyBody(text: string): HTMLElement {
  const el = document.createElement('p');
  el.textContent = text;
  return el;
}

function empty(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty';
  el.append(art('🔔'), emptyTitle('Nothing being watched yet.'));

  const body = document.createElement('p');
  body.textContent =
    'Open a page, press the button above, then click the price, the stock line, the version number, whatever you keep coming back to check.';
  el.append(body);
  return el;
}

function avatarLetter(label: string): string {
  return (label.trim().charAt(0) || 'W').toUpperCase();
}

function card(watch: Watch, now: number): HTMLElement {
  const status = statusOf(watch, now);
  const isOpen = expanded.has(watch.id);
  const card = document.createElement('section');
  card.className = `card ${status}${isOpen ? ' open' : ''}`;

  const head = document.createElement('button');
  head.className = 'card-head';
  head.type = 'button';
  head.setAttribute('aria-expanded', String(isOpen));
  head.setAttribute('aria-label', `${watch.label}, ${subtitle(watch, status, now)}`);

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = avatarLetter(watch.label);
  avatar.setAttribute('aria-hidden', 'true');

  const dot = document.createElement('span');
  dot.className = `dot ${status}`;
  // Status is in the text too, never in the colour alone.
  dot.setAttribute('aria-hidden', 'true');

  const main = document.createElement('span');
  main.className = 'card-main';

  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = watch.label;

  const sub = document.createElement('span');
  sub.className = 'card-sub';
  sub.textContent = subtitle(watch, status, now);

  main.append(title, sub);

  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.textContent = '▾';
  chev.setAttribute('aria-hidden', 'true');

  head.append(avatar, dot, main, chev);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.hidden = !isOpen;
  body.append(...details(watch, now));

  head.addEventListener('click', () => {
    const open = Boolean(body.hidden);
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    card.classList.toggle('open', open);
    if (open) expanded.add(watch.id);
    else expanded.delete(watch.id);
  });

  card.append(head, body);
  return card;
}

function subtitle(watch: Watch, status: string, now: number): string {
  if (status === 'paused') return `Paused · ${hostOf(watch.url)}`;
  if (status === 'failing') return watch.lastError ?? 'Last check failed.';
  if (status === 'changed' && watch.history[0]) return `Changed · ${watch.history[0].summary}`;
  return `${hostOf(watch.url)} · checked ${ago(watch.lastCheckedAt, now)}`;
}

function details(watch: Watch, now: number): HTMLElement[] {
  const out: HTMLElement[] = [];

  const current = document.createElement('div');
  current.className = 'field';
  current.append(label('Currently'), changedValue(watch));
  out.push(current);

  const where = document.createElement('div');
  where.className = 'field';
  const link = document.createElement('a');
  link.href = watch.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = watch.url;
  link.className = 'value link';
  where.append(
    label(
      `${intervalLabel(watch.intervalMinutes)} · last checked ${ago(watch.lastCheckedAt, now)}`
    ),
    link
  );
  out.push(where);

  if (watch.history.length) {
    const history = document.createElement('div');
    history.className = 'field';
    history.append(label(`${watch.history.length} change${watch.history.length === 1 ? '' : 's'}`));
    const timeline = document.createElement('div');
    timeline.className = 'history';
    for (const change of watch.history.slice(0, 5)) {
      const row = document.createElement('div');
      row.className = 'change';

      const when = document.createElement('span');
      when.className = 'change-when';
      when.textContent = ago(change.at, now);

      const what = document.createElement('span');
      what.className = 'change-what';
      what.textContent = change.summary;

      row.append(when, what);
      timeline.append(row);
    }
    history.append(timeline);
    out.push(history);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    action('Check now', async () => {
      await chrome.runtime.sendMessage({ type: 'CHECK_NOW', id: watch.id });
      await render();
      toast('Checked.');
    }),
    action(watch.paused ? 'Resume' : 'Pause', async () => {
      await store.update(watch.id, (w) => ({
        ...w,
        paused: !w.paused,
        failures: 0,
        lastError: null,
      }));
      await render();
    }),
    action(
      'Remove',
      async () => {
        await store.remove(watch.id);
        expanded.delete(watch.id);
        await render();
      },
      'danger'
    )
  );
  out.push(actions);
  return out;
}

function changedValue(watch: Watch): HTMLElement {
  const el = document.createElement('span');
  el.className = 'value';
  // Watched text comes from arbitrary pages, so it is never markup.
  el.textContent = watch.text || '(empty)';
  return el;
}

function label(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'label';
  el.textContent = text;
  return el;
}

function action(text: string, run: () => Promise<void>, kind = ''): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `act ${kind}`.trim();
  el.textContent = text;
  el.addEventListener('click', () => {
    el.disabled = true;
    void run().finally(() => {
      el.disabled = false;
    });
  });
  return el;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

let toastTimer = 0;
function toast(message: string): void {
  toastText.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 3600);
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

searchInput.addEventListener('input', () => {
  query = searchInput.value;
  void render();
  searchInput.focus();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  query = '';
  void render();
  searchInput.focus();
});

filterTabs.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest('button[data-filter]');
  if (!btn) return;
  statusFilter = (btn as HTMLButtonElement).dataset.filter as Status | 'all';
  void render();
});
