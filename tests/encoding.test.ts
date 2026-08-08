import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  charsetFromHeader,
  charsetFromMeta,
  decodePage,
  normaliseCharset,
} from '../src/encoding.js';

const bytes = (text: string, encoding: 'utf-8' | 'windows-1252') => {
  if (encoding === 'utf-8') return new TextEncoder().encode(text).buffer;
  // windows-1252 is one byte per character for everything in this test.
  const out = new Uint8Array(text.length);
  for (const [i, ch] of [...text].entries()) out[i] = ch.codePointAt(0)!;
  return out.buffer;
};

test('the header is read when it says something', () => {
  assert.equal(charsetFromHeader('text/html; charset=UTF-8'), 'utf-8');
  assert.equal(charsetFromHeader('text/html;charset="windows-1252"'), 'windows-1252');
  assert.equal(charsetFromHeader('text/html'), null);
  assert.equal(charsetFromHeader(null), null);
});

test('both spellings of the meta declaration are understood', () => {
  assert.equal(charsetFromMeta('<head><meta charset="ISO-8859-1"></head>'), 'iso-8859-1');
  assert.equal(charsetFromMeta('<meta charset=utf-8>'), 'utf-8');
  assert.equal(
    charsetFromMeta('<meta http-equiv="Content-Type" content="text/html; charset=shift_jis">'),
    'shift_jis'
  );
  assert.equal(charsetFromMeta('<head><title>No declaration</title></head>'), null);
});

test('a declaration too far into the page does not count', () => {
  const buried = `${' '.repeat(3000)}<meta charset="windows-1252">`;
  assert.equal(charsetFromMeta(buried), null);
});

test('the labels browsers treat as aliases are treated as aliases', () => {
  // Labelled iso-8859-1 is windows-1252 in every browser, and the difference
  // is the range that curly quotes and the euro sign live in.
  assert.equal(normaliseCharset('ISO-8859-1'), 'windows-1252');
  assert.equal(normaliseCharset('latin1'), 'windows-1252');
  assert.equal(normaliseCharset('UTF8'), 'utf-8');
  assert.equal(normaliseCharset(null), 'utf-8');
  assert.equal(normaliseCharset('shift_jis'), 'shift_jis');
});

test('a page with no header is decoded by what its markup says', () => {
  const html = '<html><head><meta charset="windows-1252"></head><body>Café £39</body></html>';
  assert.match(decodePage(bytes(html, 'windows-1252'), null), /Café £39/);
});

test('the header wins over the markup, as the spec says', () => {
  const html = '<head><meta charset="windows-1252"></head><body>Café</body>';
  assert.match(decodePage(bytes(html, 'utf-8'), 'text/html; charset=utf-8'), /Café/);
});

test('a silent header and silent markup means UTF-8', () => {
  const html = '<html><body>Café £39</body></html>';
  assert.match(decodePage(bytes(html, 'utf-8'), 'text/html'), /Café £39/);
});

test('an encoding nobody has heard of falls back rather than throwing', () => {
  // Mangled text still lets the watch run. An exception loses it.
  const html = '<html><body>plain</body></html>';
  assert.match(decodePage(bytes(html, 'utf-8'), 'text/html; charset=x-made-up'), /plain/);
});
