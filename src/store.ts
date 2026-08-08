import type { Watch } from './types.js';

/**
 * Watches on disk.
 *
 * chrome.storage.local rather than IndexedDB: the whole list is small, is read
 * in full on every panel open and every alarm tick, and the service worker
 * that writes it can be evicted at any moment. A single atomic set is the
 * right shape for that.
 */
const KEY = 'bellrope.watches';

export async function readAll(): Promise<Watch[]> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY];
  return Array.isArray(value) ? (value as Watch[]) : [];
}

export async function writeAll(watches: readonly Watch[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: watches });
}

/**
 * Replace one watch, by id.
 *
 * Read, change, write the whole list. Two checks finishing at once would
 * otherwise have the second overwrite the first, and losing a change the user
 * was waiting for is the one failure this product cannot have. Alarm ticks are
 * serialised upstream, which is what actually makes this safe.
 */
export async function update(id: string, change: (watch: Watch) => Watch): Promise<Watch[]> {
  const all = await readAll();
  const next = all.map((w) => (w.id === id ? change(w) : w));
  await writeAll(next);
  return next;
}

export async function add(watch: Watch): Promise<Watch[]> {
  const all = await readAll();
  const next = [watch, ...all];
  await writeAll(next);
  return next;
}

export async function remove(id: string): Promise<Watch[]> {
  const next = (await readAll()).filter((w) => w.id !== id);
  await writeAll(next);
  return next;
}
