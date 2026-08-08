import { ago, intervalLabel } from './src/schedule.js';
import * as store from './src/store.js';
import type { Interval, Watch } from './src/types.js';
import { sortWatches, statusOf } from './src/watch.js';

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

/** Which watches have their history open, kept across re-renders. */
const expanded = new Set<string>();

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

async function render(): Promise<void> {
  const now = Date.now();
  const watches = await store.readAll();

  if (!watches.length) {
    listEl.replaceChildren(empty());
    return;
  }
  listEl.replaceChildren(...sortWatches(watches, now).map((w) => card(w, now)));
}

function empty(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty';

  const title = document.createElement('p');
  title.className = 'empty-title';
  title.textContent = 'Nothing being watched yet.';

  const body = document.createElement('p');
  body.textContent =
    'Open a page, press the button above, then click the price, the stock line, the version number, whatever you keep coming back to check.';

  el.append(title, body);
  return el;
}

function card(watch: Watch, now: number): HTMLElement {
  const status = statusOf(watch, now);
  const card = document.createElement('section');
  card.className = `card ${status}`;

  const head = document.createElement('button');
  head.className = 'card-head';
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expanded.has(watch.id)));

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
  head.append(dot, main);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.hidden = !expanded.has(watch.id);
  body.append(...details(watch, now));

  head.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    if (open) expanded.add(watch.id);
    else expanded.delete(watch.id);
  });

  card.append(head, body);
  return card;
}

function subtitle(watch: Watch, status: string, now: number): string {
  if (status === 'paused') return `Paused. ${hostOf(watch.url)}`;
  if (status === 'failing') return watch.lastError ?? 'Last check failed.';
  if (status === 'changed' && watch.history[0]) return watch.history[0].summary;
  return `${hostOf(watch.url)}, checked ${ago(watch.lastCheckedAt, now)}`;
}

function details(watch: Watch, now: number): HTMLElement[] {
  const out: HTMLElement[] = [];

  const current = document.createElement('div');
  current.className = 'field';
  current.append(label('Currently'), value(watch.text || '(empty)'));
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
    label(`${intervalLabel(watch.intervalMinutes)}, last checked ${ago(watch.lastCheckedAt, now)}`),
    link
  );
  out.push(where);

  if (watch.history.length) {
    const history = document.createElement('div');
    history.className = 'field';
    history.append(label(`${watch.history.length} change${watch.history.length === 1 ? '' : 's'}`));
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
      history.append(row);
    }
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

function label(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'label';
  el.textContent = text;
  return el;
}

function value(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'value';
  // Watched text comes from arbitrary pages, so it is never markup.
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

function setBusy(busy: boolean, text: string): void {
  watchBtn.disabled = busy;
  watchBtn.textContent = text;
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
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 3600);
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}
