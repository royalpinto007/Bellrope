/**
 * Working out what changed, and saying it in one line.
 *
 * The summary is the entire product. A notification saying "the page changed"
 * makes someone open the page to find out what, which is the work they
 * installed this to avoid. "£39.00 is now £29.00" does not.
 */

/** Collapse whitespace so a reflow is not mistaken for a change. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function hasChanged(before: string, after: string): boolean {
  return normalise(before) !== normalise(after);
}

export interface NumberChange {
  before: number;
  after: number;
  /** The text around the number, so "£" or "%" survives into the summary. */
  prefix: string;
  suffix: string;
}

/**
 * The numbers in a piece of text, with whatever symbol sits against them.
 *
 * Thousands separators are dropped and a comma decimal is read as a decimal,
 * so "1.299,50" and "1,299.50" both come out as 1299.5. Getting this wrong
 * turns a small price rise into a report of a hundredfold one.
 */
export function numbersIn(text: string): { value: number; prefix: string; suffix: string }[] {
  const found: { value: number; prefix: string; suffix: string }[] = [];
  const pattern = /([^\s\d]{0,3})(\d[\d.,]*)([^\s\d]{0,3})/g;

  for (const match of text.matchAll(pattern)) {
    const [, prefix = '', raw = '', suffix = ''] = match;
    const value = parseNumber(raw);
    if (value === null) continue;
    found.push({ value, prefix: prefix.trim(), suffix: suffix.trim() });
  }
  return found;
}

function parseNumber(raw: string): number | null {
  const trimmed = raw.replace(/[.,]$/, '');
  if (!trimmed) return null;

  // Whichever separator is last is the decimal point, if it has two or three
  // digits after it. Anything else is a grouping separator.
  const lastComma = trimmed.lastIndexOf(',');
  const lastDot = trimmed.lastIndexOf('.');
  const lastSeparator = Math.max(lastComma, lastDot);

  let normalised: string;
  if (lastSeparator === -1) {
    normalised = trimmed;
  } else {
    const tail = trimmed.slice(lastSeparator + 1);
    if (/^\d{1,2}$/.test(tail)) {
      normalised = trimmed.slice(0, lastSeparator).replace(/[.,]/g, '') + '.' + tail;
    } else {
      normalised = trimmed.replace(/[.,]/g, '');
    }
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/**
 * The single number that changed, if exactly one did.
 *
 * Only when the shape of the text is otherwise identical. Two prices moving at
 * once, or a number appearing where there was none, is not something a
 * one-line summary can honestly describe, so those fall through to the word
 * diff instead of being reported as a tidy delta.
 */
export function singleNumberChange(before: string, after: string): NumberChange | null {
  const a = numbersIn(normalise(before));
  const b = numbersIn(normalise(after));
  if (a.length !== b.length || a.length === 0) return null;

  let changed: NumberChange | null = null;
  for (const [i, one] of a.entries()) {
    const two = b[i]!;
    if (one.prefix !== two.prefix || one.suffix !== two.suffix) return null;
    if (one.value === two.value) continue;
    if (changed) return null;
    changed = { before: one.value, after: two.value, prefix: one.prefix, suffix: one.suffix };
  }
  return changed;
}

export interface WordDiff {
  added: string[];
  removed: string[];
}

/**
 * Words, with sentence punctuation taken off the ends.
 *
 * "unstable" and "unstable," are the same word, and treating them as different
 * turns dropping one clause into a rewrite of the whole line, which then reads
 * as "this is now that" instead of "this was removed". Currency and percent
 * signs are left alone: they are part of the value, not punctuation around it.
 */
function tokens(text: string): string[] {
  return normalise(text)
    .split(' ')
    .map((word) => word.replace(/^[.,;:!?"'“”‘’()[\]]+|[.,;:!?"'“”‘’()[\]]+$/g, ''))
    .filter(Boolean);
}

/**
 * Which words came and went.
 *
 * A word-level set difference rather than a real diff algorithm: the summary
 * only needs to name what appeared and disappeared, and the panel shows both
 * versions in full for anyone who wants the detail. Multiplicity is kept, so a
 * word going from one occurrence to three still registers.
 */
export function wordDiff(before: string, after: string): WordDiff {
  const count = (text: string) => {
    const counts = new Map<string, number>();
    for (const word of tokens(text)) counts.set(word, (counts.get(word) ?? 0) + 1);
    return counts;
  };

  const a = count(before);
  const b = count(after);
  const added: string[] = [];
  const removed: string[] = [];

  for (const [word, n] of b) {
    const extra = n - (a.get(word) ?? 0);
    for (let i = 0; i < extra; i++) added.push(word);
  }
  for (const [word, n] of a) {
    const missing = n - (b.get(word) ?? 0);
    for (let i = 0; i < missing; i++) removed.push(word);
  }
  return { added, removed };
}

/** Trim a string for a notification, which has very little room. */
export function clip(text: string, max = 60): string {
  const clean = normalise(text);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * One line describing the change, for the notification and the list.
 *
 * Ordered by how much it tells the reader: a number moving is the most useful
 * thing this can say, text appearing where there was none is the next, and the
 * before-and-after pair is the honest fallback.
 */
export function describeChange(before: string, after: string): string {
  const from = normalise(before);
  const to = normalise(after);

  if (from === to) return 'No change.';
  if (!from) return `Now says "${clip(to)}".`;
  if (!to) return `"${clip(from)}" is gone.`;

  const number = singleNumberChange(from, to);
  if (number) {
    const format = (value: number) =>
      `${number.prefix}${trimZeros(value)}${number.suffix}`.trim() || String(value);
    const direction = number.after > number.before ? 'up' : 'down';
    const delta = trimZeros(Math.abs(number.after - number.before));
    return `${format(number.before)} is now ${format(number.after)}, ${direction} ${number.prefix}${delta}${number.suffix}.`;
  }

  const { added, removed } = wordDiff(from, to);
  if (added.length && !removed.length) return `Added: "${clip(added.join(' '), 50)}".`;
  if (removed.length && !added.length) return `Removed: "${clip(removed.join(' '), 50)}".`;

  return `"${clip(from, 28)}" is now "${clip(to, 28)}".`;
}

/** Numbers as a person would write them: 29, not 29.00, and 29.5, not 29.50. */
function trimZeros(value: number): string {
  return String(Math.round(value * 100) / 100);
}
