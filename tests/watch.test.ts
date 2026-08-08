import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Watch } from '../src/types.js';
import {
  HISTORY_LIMIT,
  applyCheck,
  createWatch,
  normaliseUrl,
  sortWatches,
  statusOf,
  suggestLabel,
} from '../src/watch.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function watch(over: Partial<Watch> = {}): Watch {
  return {
    id: 'w',
    url: 'https://example.com/p',
    label: 'A watch',
    selector: '#price',
    text: '£39',
    intervalMinutes: 60,
    createdAt: NOW,
    lastCheckedAt: NOW,
    lastChangedAt: null,
    failures: 0,
    lastError: null,
    paused: false,
    history: [],
    ...over,
  };
}

test('the fragment goes, the query stays', () => {
  // A query string is usually the entire point of the page being watched.
  assert.equal(normaliseUrl('https://a.com/p?size=9#reviews'), 'https://a.com/p?size=9');
  assert.equal(normaliseUrl('not a url'), 'not a url');
});

test('a watch is named after what it watches', () => {
  assert.equal(suggestLabel('Shop | Widget', 'In stock'), 'In stock');
});

test('long text falls back to the page title', () => {
  const long = 'x'.repeat(80);
  assert.equal(suggestLabel('Widget 3000 | Shop', long), 'Widget 3000');
});

test('with neither, it still gets a name', () => {
  assert.equal(suggestLabel('', ''), 'Untitled watch');
});

test('a new watch counts as already checked', () => {
  // The text was read from the live page a moment ago, so claiming otherwise
  // would make it due instantly and check the same page twice.
  const w = createWatch({
    id: 'a',
    url: 'https://a.com/p#x',
    selector: '#price',
    text: '  £39  ',
    pageTitle: 'Shop',
    intervalMinutes: 60,
    now: NOW,
  });
  assert.equal(w.lastCheckedAt, NOW);
  assert.equal(w.text, '£39');
  assert.equal(w.url, 'https://a.com/p');
  assert.equal(w.lastChangedAt, null);
});

test('an unchanged check clears the error state', () => {
  const { watch: after, change } = applyCheck(
    watch({ failures: 3, lastError: 'timed out' }),
    { ok: true, text: '£39' },
    NOW + 1000
  );
  assert.equal(change, null);
  assert.equal(after.failures, 0);
  assert.equal(after.lastError, null);
  assert.equal(after.lastChangedAt, null);
});

test('a changed check records the change and the new text', () => {
  const { watch: after, change } = applyCheck(watch(), { ok: true, text: '£29' }, NOW + 1000);
  assert.ok(change);
  assert.equal(change.before, '£39');
  assert.equal(change.after, '£29');
  assert.match(change.summary, /down £10/);
  assert.equal(after.text, '£29');
  assert.equal(after.lastChangedAt, NOW + 1000);
  assert.equal(after.history.length, 1);
});

test('a change arriving after failures is still a change', () => {
  const { change } = applyCheck(watch({ failures: 4 }), { ok: true, text: '£29' }, NOW);
  assert.ok(change);
});

test('a failure keeps the last known text', () => {
  // Losing what it last saw would mean the next success reports a change that
  // never happened.
  const { watch: after, change } = applyCheck(
    watch(),
    { ok: false, error: 'timed out', permanent: false },
    NOW + 1000
  );
  assert.equal(change, null);
  assert.equal(after.text, '£39');
  assert.equal(after.failures, 1);
  assert.equal(after.lastError, 'timed out');
  assert.equal(after.paused, false);
});

test('a page that is permanently gone pauses itself', () => {
  const { watch: after } = applyCheck(
    watch(),
    { ok: false, error: '404 Not Found', permanent: true },
    NOW
  );
  assert.equal(after.paused, true);
});

test('history is capped and newest first', () => {
  let w = watch();
  for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
    w = applyCheck(w, { ok: true, text: `£${i}` }, NOW + i).watch;
  }
  assert.equal(w.history.length, HISTORY_LIMIT);
  assert.equal(w.history[0]?.after, `£${HISTORY_LIMIT + 5}`);
});

test('status puts failure above news', () => {
  // A watch erroring for two days is still showing what it last saw, and
  // presenting that as news would be a lie by omission.
  const failing = watch({ failures: 2, lastChangedAt: NOW - 1000 });
  assert.equal(statusOf(failing, NOW), 'failing');
  assert.equal(statusOf(watch({ lastChangedAt: NOW - 1000 }), NOW), 'changed');
  assert.equal(statusOf(watch({ lastChangedAt: NOW - 3 * DAY }), NOW), 'watching');
  assert.equal(statusOf(watch({ paused: true, failures: 9 }), NOW), 'paused');
});

test('the list leads with what needs attention', () => {
  const quiet = watch({ id: 'quiet' });
  const changed = watch({ id: 'changed', lastChangedAt: NOW - 1000 });
  const broken = watch({ id: 'broken', failures: 1 });
  const paused = watch({ id: 'paused', paused: true });

  const order = sortWatches([quiet, paused, changed, broken], NOW).map((w) => w.id);
  assert.deepEqual(order, ['broken', 'changed', 'quiet', 'paused']);
});
