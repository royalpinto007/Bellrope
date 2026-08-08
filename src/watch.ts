import { describeChange, hasChanged, normalise } from './diff.js';
import type { CheckResult, Change, Interval, Watch } from './types.js';

/** How many past changes are kept per watch. */
export const HISTORY_LIMIT = 20;

/**
 * The URL a watch is stored against.
 *
 * The fragment goes, because it never reaches the server and so cannot change
 * what is fetched. Everything else stays: a query string is usually the whole
 * point of the page being watched, and quietly stripping tracking parameters
 * would sometimes fetch a different page than the one the user was looking at.
 */
export function normaliseUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = '';
    return url.toString();
  } catch {
    return input;
  }
}

/**
 * A name for a new watch, from the page and the text.
 *
 * The text first, because "In stock" is what the user recognises. The page
 * title is a fallback, and both are shortened: a watch list is scanned, not
 * read.
 */
export function suggestLabel(pageTitle: string, watchedText: string): string {
  const text = normalise(watchedText);
  if (text && text.length <= 40) return text;

  const title = normalise(pageTitle).split(/\s[|·-]\s/)[0] ?? '';
  if (title) return title.length <= 48 ? title : `${title.slice(0, 47)}…`;
  if (text) return `${text.slice(0, 39)}…`;
  return 'Untitled watch';
}

export function createWatch(fields: {
  id: string;
  url: string;
  selector: string;
  text: string;
  pageTitle: string;
  intervalMinutes: Interval;
  now: number;
}): Watch {
  return {
    id: fields.id,
    url: normaliseUrl(fields.url),
    label: suggestLabel(fields.pageTitle, fields.text),
    selector: fields.selector,
    text: normalise(fields.text),
    intervalMinutes: fields.intervalMinutes,
    createdAt: fields.now,
    // Counts as checked: the text was read from the live page a moment ago.
    lastCheckedAt: fields.now,
    lastChangedAt: null,
    failures: 0,
    lastError: null,
    paused: false,
    history: [],
  };
}

export interface Applied {
  watch: Watch;
  /** The change, if the text moved. Null covers both no change and a failure. */
  change: Change | null;
}

/**
 * Fold a check result into a watch.
 *
 * Pure and total: every path returns a watch, so a failure can never lose one.
 * The reason this is separated from the worker is that the interesting cases,
 * a failure clearing on retry, a change arriving after three failures, are
 * awkward to produce against a live site and trivial to write down here.
 */
export function applyCheck(watch: Watch, result: CheckResult, now: number): Applied {
  if (!result.ok) {
    return {
      watch: {
        ...watch,
        lastCheckedAt: now,
        failures: watch.failures + 1,
        lastError: result.error,
        // A page that is permanently gone stops being checked rather than
        // waiting out the backoff, so the user is told once and left alone.
        paused: result.permanent ? true : watch.paused,
      },
      change: null,
    };
  }

  const after = normalise(result.text);
  const base: Watch = { ...watch, lastCheckedAt: now, failures: 0, lastError: null };

  if (!hasChanged(watch.text, after)) return { watch: base, change: null };

  const change: Change = {
    at: now,
    before: watch.text,
    after,
    summary: describeChange(watch.text, after),
  };

  return {
    watch: {
      ...base,
      text: after,
      lastChangedAt: now,
      history: [change, ...base.history].slice(0, HISTORY_LIMIT),
    },
    change,
  };
}

export type Status = 'paused' | 'failing' | 'changed' | 'watching';

/**
 * What the list should say about a watch right now.
 *
 * Failure outranks a change: a watch that has been erroring for two days is
 * still showing whatever it last saw, and presenting that as news would be a
 * lie by omission.
 */
export function statusOf(watch: Watch, now: number, freshMs = 86_400_000): Status {
  if (watch.paused) return 'paused';
  if (watch.failures > 0) return 'failing';
  if (watch.lastChangedAt !== null && now - watch.lastChangedAt < freshMs) return 'changed';
  return 'watching';
}

/** Newest change first, and anything failing above the quiet ones. */
export function sortWatches(watches: readonly Watch[], now: number): Watch[] {
  const rank: Record<Status, number> = { failing: 0, changed: 1, watching: 2, paused: 3 };
  return [...watches].sort((a, b) => {
    const byStatus = rank[statusOf(a, now)] - rank[statusOf(b, now)];
    if (byStatus !== 0) return byStatus;
    return (b.lastChangedAt ?? b.createdAt) - (a.lastChangedAt ?? a.createdAt);
  });
}
