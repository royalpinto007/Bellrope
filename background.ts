import { clip } from './src/diff.js';
import { decodePage } from './src/encoding.js';
import type { Extraction, Feasibility } from './src/extract.js';
import { TICK_MINUTES, dueNow } from './src/schedule.js';
import { confidenceNote, confidenceOf } from './src/selector.js';
import * as store from './src/store.js';
import type { CheckResult, Interval, Watch } from './src/types.js';
import { applyCheck, createWatch } from './src/watch.js';

/**
 * The service worker: scheduling, fetching, and telling the user.
 *
 * MV3 evicts this constantly, so every listener is registered at the top level
 * on each start and all state lives in storage rather than in memory.
 */

const ALARM = 'bellrope.tick';

chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) {
    await chrome.alarms.create(ALARM, { periodInMinutes: TICK_MINUTES, delayInMinutes: 1 });
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'watch-page')
    void chrome.runtime.sendMessage({ type: 'START_PICK' }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runDueChecks();
});

/** Opening the notification opens the page it is about. */
chrome.notifications.onClicked.addListener((id) => {
  void (async () => {
    const watch = (await store.readAll()).find((w) => w.id === id);
    if (watch) await chrome.tabs.create({ url: watch.url });
    chrome.notifications.clear(id);
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers: Record<string, () => Promise<unknown>> = {
    PICK: () => pick(),
    CREATE: () => create(message.picked, message.intervalMinutes),
    CHECK_NOW: () => checkOne(message.id, true),
    CHECK_ALL: () => runDueChecks(true),
  };

  const handler = handlers[message?.type];
  if (!handler) return undefined;

  handler().then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, error: describe(error) })
  );
  return true;
});

/* Creating a watch ---------------------------------------------------------- */

interface Picked {
  selector: string;
  text: string;
  title: string;
  url: string;
}

/** Run the picker in the active tab and hand back what the user clicked. */
async function pick(): Promise<{ ok: boolean; picked?: Picked; error?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (tabId === undefined || !tab?.url) return { ok: false, error: 'No page to watch.' };

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/picker.js'] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const picked = await window.__bellropePick;
        delete window.__bellropePick;
        return picked;
      },
    });

    const picked = result?.result as Omit<Picked, 'url'> | null | undefined;
    if (!picked) return { ok: false, error: 'Cancelled.' };
    return { ok: true, picked: { ...picked, url: tab.url } };
  } catch (error) {
    return { ok: false, error: `This page cannot be watched (${describe(error)}).` };
  }
}

/**
 * Turn a pick into a watch, but only if it can actually be checked.
 *
 * The page is fetched once, straight away, and the selector tried against what
 * the server sent. A watch that could only ever report "not found" is worse
 * than a refusal, because the user believes it is working and stops looking.
 */
async function create(
  picked: Picked,
  intervalMinutes: Interval
): Promise<{ ok: boolean; watch?: Watch; error?: string; note?: string }> {
  let html: string;
  try {
    html = await fetchPage(picked.url);
  } catch (error) {
    return {
      ok: false,
      error: `Could not fetch the page to set up the watch (${describe(error)}).`,
    };
  }

  const feasible = (await parse(html, picked.selector, picked.text, 'FEASIBLE')) as Feasibility;
  if (!feasible.canWatch) return { ok: false, error: feasible.reason };

  const watch = createWatch({
    id: crypto.randomUUID(),
    url: picked.url,
    selector: picked.selector,
    // The text as the server sends it, not as the browser rendered it, since
    // that is what every future check will be compared against.
    text:
      ((await parse(html, picked.selector, picked.text, 'PARSE')) as Extraction & { text?: string })
        .text ?? picked.text,
    pageTitle: picked.title,
    intervalMinutes,
    now: Date.now(),
  });

  await store.add(watch);
  await ensureAlarm();

  // Said now, while the user is still looking, rather than left to be inferred
  // from a notification that never arrives.
  const confidence = confidenceOf(watch.selector);
  return { ok: true, watch, note: confidence === 'high' ? undefined : confidenceNote(confidence) };
}

/* Checking ------------------------------------------------------------------ */

/**
 * Check whatever is due.
 *
 * Serialised on purpose. Each check reads the whole list, changes one watch
 * and writes it back, so two running at once would have the second overwrite
 * the first, and the change it dropped is exactly what the user was waiting
 * for.
 */
async function runDueChecks(force = false): Promise<{ ok: true; checked: number }> {
  const now = Date.now();
  const all = await store.readAll();
  const due = force ? all.filter((w) => !w.paused) : dueNow(all, now);

  for (const watch of due) await checkOne(watch.id, false);
  return { ok: true, checked: due.length };
}

async function checkOne(id: string, manual: boolean): Promise<{ ok: boolean; watch?: Watch }> {
  const watch = (await store.readAll()).find((w) => w.id === id);
  if (!watch) return { ok: false };

  const result = await check(watch);
  const applied = applyCheck(watch, result, Date.now());
  await store.update(id, () => applied.watch);

  if (applied.change) await notify(applied.watch, applied.change.summary);
  await tellPanel();

  // A manual check that found nothing still deserves an answer, or the button
  // looks broken.
  if (manual && !applied.change) await tellPanel();
  return { ok: true, watch: applied.watch };
}

async function check(watch: Watch): Promise<CheckResult> {
  let html: string;
  try {
    html = await fetchPage(watch.url);
  } catch (error) {
    const message = describe(error);
    // 404 and 410 mean the page is gone for good; everything else may recover.
    const permanent = /\b(404|410)\b/.test(message);
    return { ok: false, error: message, permanent };
  }

  const found = (await parse(html, watch.selector, watch.text, 'PARSE')) as Extraction;
  if (found.found) return { ok: true, text: found.text };

  return {
    ok: false,
    error:
      found.reason === 'empty'
        ? 'The element is there but has no text now.'
        : 'The part being watched is no longer on the page.',
    permanent: false,
  };
}

/**
 * Fetch a page as the server sends it.
 *
 * No credentials: a watch must never read a signed-in view, both because the
 * result would be wrong for anyone else and because storing it would mean
 * keeping someone's account page in extension storage.
 */
async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  // Not response.text(): that assumes UTF-8 whenever the header is silent, and
  // a page declaring its charset only in a meta tag would then decode into the
  // same mojibake on every check, so it would never appear to change.
  return decodePage(await response.arrayBuffer(), response.headers.get('content-type'));
}

/* Parsing ------------------------------------------------------------------- */

/**
 * Parse fetched HTML in the offscreen document.
 *
 * A service worker has no DOMParser. The offscreen document runs no page
 * script and loads no subresource, which is why the HTML is parsed there
 * rather than opened in a tab.
 */
let offscreenReady: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existing.length) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Parse fetched HTML to read the watched element.',
    });
  })().catch((error) => {
    // A failed creation must not be cached, or every later check fails too.
    offscreenReady = null;
    throw error;
  });
  return offscreenReady;
}

async function parse(
  html: string,
  selector: string,
  seenText: string,
  mode: 'PARSE' | 'FEASIBLE'
): Promise<unknown> {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({
    type: mode === 'PARSE' ? 'PARSE' : 'FEASIBLE',
    html,
    selector,
    seenText,
  });
}

/* Telling the user ---------------------------------------------------------- */

async function notify(watch: Watch, summary: string): Promise<void> {
  try {
    await chrome.notifications.create(watch.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: clip(watch.label, 40),
      message: summary,
      contextMessage: hostOf(watch.url),
    });
  } catch {
    // Notifications can be off at the OS level. The panel still shows it.
  }
}

async function tellPanel(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'WATCHES_CHANGED' });
  } catch {
    // Nothing listening when the panel is closed, which is the normal case.
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
