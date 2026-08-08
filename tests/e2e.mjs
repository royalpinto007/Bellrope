/**
 * End to end: the real extension, in a real Chrome, against a page that
 * actually changes.
 *
 * The unit tests cover the diffing, the scheduling and the selectors. None of
 * them touch the parts most likely to break in practice: the offscreen parser,
 * the fetch, the picker running inside a page, and the notification. Those
 * only exist in a browser, so they are only tested in one.
 *
 * Needs Playwright with its Chromium: npx playwright install chromium
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8793;

/*
 * A page whose price we control between requests.
 *
 * Served with no charset in the header and only a meta declaration, which is
 * how a great many real pages do it. Read as UTF-8 by default the pound sign
 * would decode to mojibake, identically on every check, so the watch would
 * never appear to change: the failure that looks exactly like working.
 */
let price = '£39.00';
const page = () => `<!doctype html><html><head><meta charset="utf-8">
    <title>Widget 3000 | Shop</title></head><body>
    <main class="content">
      <h1 class="title">Widget 3000</h1>
      <p id="price">${price}</p>
      <p class="stock">In stock</p>
    </main>
  </body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  if (req.url === '/spa') {
    res.end('<!doctype html><html><body><div id="root"></div></body></html>');
    return;
  }
  res.end(page());
});
await new Promise((r) => server.listen(PORT, r));

/*
 * Loaded from a copy whose manifest declares <all_urls> up front.
 *
 * The shipped extension asks for the same permission from the panel, and that
 * request needs a real click on a real dialog, which cannot be driven here.
 * Everything after the grant is the shipped code, byte for byte.
 */
const TEST_DIR = '/tmp/bellrope-e2e';
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.cpSync(DIR, TEST_DIR, {
  recursive: true,
  filter: (src) => !src.includes('node_modules') && !src.includes('/.git'),
});
const manifest = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
delete manifest.optional_host_permissions;
fs.writeFileSync(path.join(TEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

const profile = '/tmp/bellrope-e2e-profile';
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${TEST_DIR}`,
    `--load-extension=${TEST_DIR}`,
  ],
});

let [worker] = ctx.serviceWorkers();
if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(worker.url()).host;

const fail = [];
const ok = (label, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) fail.push(label);
};

try {
  /* The picker, running inside a real page. ------------------------------- */

  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => {
    window.__clicked = false;
    document.querySelector('#price').addEventListener('click', () => {
      window.__clicked = true;
    });
  });

  await page.addScriptTag({ path: path.join(TEST_DIR, 'dist/picker.js') });
  const box = await page.locator('#price').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);

  const overlay = await page.evaluate(() => ({
    outline: !!document.getElementById('__bellrope-outline'),
    hint: document.getElementById('__bellrope-hint')?.textContent ?? '',
  }));
  ok('the picker outlines what is under the cursor', overlay.outline);
  ok('and says what to do', /Click what you want to watch/.test(overlay.hint));

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const picked = await page.evaluate(async () => {
    const result = await window.__bellropePick;
    return {
      result,
      clicked: window.__clicked,
      leftover: !!document.getElementById('__bellrope-outline'),
    };
  });

  ok('the pick returns the element it was over', picked.result?.selector === '#price');
  ok(
    'with its text and the page title',
    picked.result?.text === '£39.00' && /Widget 3000/.test(picked.result?.title)
  );
  // Picking a "Buy now" button must not buy the thing.
  ok('the click never reaches the page', picked.clicked === false);
  ok('and the picker cleans up after itself', picked.leftover === false);

  /* Creating a watch, which fetches and parses offscreen. ------------------ */

  const panel = await ctx.newPage();
  const panelErrors = [];
  panel.on('pageerror', (e) => panelErrors.push(String(e)));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.waitForSelector('#watch-btn');

  const send = (message) => panel.evaluate((m) => chrome.runtime.sendMessage(m), message);

  const created = await send({
    type: 'CREATE',
    intervalMinutes: 60,
    picked: {
      selector: '#price',
      text: '£39.00',
      title: 'Widget 3000 | Shop',
      url: `http://localhost:${PORT}/`,
    },
  });
  ok('a watch is created from a pick', created?.ok === true);
  ok('named after what it watches', created?.watch?.label === '£39.00');
  ok('and it starts from the served text', created?.watch?.text === '£39.00');

  const contexts = await worker.evaluate(() =>
    chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)
  );
  ok('an offscreen document did the parsing', contexts === 1);

  /* A page that builds itself in the browser is refused. ------------------- */

  const refused = await send({
    type: 'CREATE',
    intervalMinutes: 60,
    picked: {
      selector: '#price',
      text: '£39.00',
      title: 'App',
      url: `http://localhost:${PORT}/spa`,
    },
  });
  ok('a browser-rendered page is refused', refused?.ok === false);
  ok('and the refusal explains itself', /builds itself in your browser/.test(refused?.error ?? ''));

  /* Nothing changed yet. --------------------------------------------------- */

  await send({ type: 'CHECK_ALL' });
  let watches = await panel.evaluate(() =>
    chrome.storage.local.get('bellrope.watches').then((s) => s['bellrope.watches'])
  );
  ok('a check with no change records no change', watches[0].history.length === 0);
  ok('and clears any error state', watches[0].failures === 0 && watches[0].lastError === null);

  /* The price moves. ------------------------------------------------------- */

  price = '£29.00';
  await send({ type: 'CHECK_ALL' });
  watches = await panel.evaluate(() =>
    chrome.storage.local.get('bellrope.watches').then((s) => s['bellrope.watches'])
  );

  ok('the change is caught', watches[0].history.length === 1);
  ok('the new text is stored', watches[0].text === '£29.00');
  ok(
    `the summary says what happened: "${watches[0].history[0]?.summary}"`,
    watches[0].history[0]?.summary === '£39 is now £29, down £10.'
  );

  const notifications = await worker.evaluate(() =>
    chrome.notifications.getAll().then(Object.keys)
  );
  ok('a notification was raised for it', notifications.includes(watches[0].id));

  /* The page goes away. ---------------------------------------------------- */

  await new Promise((r) => server.close(r));
  await send({ type: 'CHECK_ALL' });
  watches = await panel.evaluate(() =>
    chrome.storage.local.get('bellrope.watches').then((s) => s['bellrope.watches'])
  );
  ok('a failed check is counted', watches[0].failures === 1);
  ok('with a reason', typeof watches[0].lastError === 'string' && watches[0].lastError.length > 0);
  // Losing this would make the next success report a change that never happened.
  ok('and the last known text is kept', watches[0].text === '£29.00');

  /* The panel renders all of it. ------------------------------------------- */

  await panel.reload();
  await panel.waitForSelector('.card');
  const rendered = await panel.evaluate(() => ({
    cards: document.querySelectorAll('.card').length,
    failing: document.querySelectorAll('.card.failing').length,
    text: document.querySelector('.card-sub')?.textContent ?? '',
  }));
  ok('the panel lists the watch', rendered.cards === 1);
  ok('showing it as failing rather than as news', rendered.failing === 1);
  ok('with the reason on the card', rendered.text.length > 0);
  ok('and no script errors anywhere', panelErrors.length === 0);
  if (panelErrors.length) console.log(panelErrors.join('\n'));

  /* The alarm exists, which is what makes any of it happen unattended. ----- */

  const alarm = await worker.evaluate(() =>
    chrome.alarms.get('bellrope.tick').then((a) => a?.periodInMinutes)
  );
  ok('a repeating alarm drives the checks', alarm === 5);
} finally {
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
  server.close();
}

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
