import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { checkFeasible, extract, visibleText } from '../src/extract.js';

const parse = (html: string) => new JSDOM(html).window.document;

test('script and style contents are not part of the text', () => {
  // textContent happily returns an inline JSON blob, and a watch on a product
  // name would then fire every time the analytics payload changed.
  const doc = parse(
    '<div id="p">£39<script>var a={"ts":1}</script><style>.x{color:red}</style></div>'
  );
  assert.equal(visibleText(doc.querySelector('#p')!), '£39');
});

test('whitespace is collapsed on the way out', () => {
  const doc = parse('<div id="p">  In\n   stock  </div>');
  assert.equal(visibleText(doc.querySelector('#p')!), 'In stock');
});

test('extraction reports what it found', () => {
  const doc = parse('<body><span id="price">£39</span><span id="blank"> </span></body>');
  assert.deepEqual(extract(doc, '#price'), { found: true, text: '£39' });
  assert.deepEqual(extract(doc, '#blank'), { found: false, reason: 'empty' });
  assert.deepEqual(extract(doc, '#gone'), { found: false, reason: 'no-match' });
});

test('an invalid selector fails rather than throwing', () => {
  // Selectors are built from arbitrary pages, so one will eventually be junk.
  assert.deepEqual(extract(parse('<body></body>'), '>>>'), { found: false, reason: 'no-match' });
});

test('a watch is feasible when the element is in what the server sent', () => {
  const served = parse('<body><main><span id="price">£39</span></main></body>');
  assert.deepEqual(checkFeasible(served, '#price', '£39'), { canWatch: true });
});

test('the text having already moved on is still feasible', () => {
  // That difference is exactly what this exists to notice.
  const served = parse('<body><span id="price">£29</span></body>');
  assert.equal(checkFeasible(served, '#price', '£39').canWatch, true);
});

test('a page built in the browser is refused, and told why', () => {
  // Otherwise the user believes it is working and stops checking themselves.
  const shell = parse('<body><div id="root"></div></body>');
  const verdict = checkFeasible(shell, '#price', '£39');
  assert.equal(verdict.canWatch, false);
  assert.match(verdict.reason, /builds itself in your browser/);
});

test('a bad selector on a good page is called out as a bad selector', () => {
  const served = parse(`<body><main>${'filler text '.repeat(30)}<span>£39</span></main></body>`);
  const verdict = checkFeasible(served, '#nope', '£39');
  assert.equal(verdict.canWatch, false);
  assert.match(verdict.reason, /selecting the text itself/);
});

test('content missing from a full page is reported as missing', () => {
  const served = parse(`<body><main>${'unrelated words '.repeat(30)}</main></body>`);
  const verdict = checkFeasible(served, '#price', '£39');
  assert.equal(verdict.canWatch, false);
  assert.match(verdict.reason, /not in what the server sends/);
});
