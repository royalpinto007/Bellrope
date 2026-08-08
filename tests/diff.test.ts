import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clip,
  describeChange,
  hasChanged,
  normalise,
  numbersIn,
  singleNumberChange,
  wordDiff,
} from '../src/diff.js';

test('whitespace is not a change', () => {
  assert.equal(hasChanged('In  stock', 'In stock'), false);
  assert.equal(hasChanged('In stock\n', ' In stock '), false);
  assert.equal(hasChanged('In stock', 'Out of stock'), true);
  assert.equal(normalise('  a   b \n c '), 'a b c');
});

test('numbers are read the way they are written, either side of the Channel', () => {
  assert.equal(numbersIn('1,299.50')[0]?.value, 1299.5);
  assert.equal(numbersIn('1.299,50')[0]?.value, 1299.5);
  assert.equal(numbersIn('1299')[0]?.value, 1299);
  // Three digits after the separator is a thousands group, not a decimal.
  assert.equal(numbersIn('1,299')[0]?.value, 1299);
});

test('the symbol against a number is kept', () => {
  const [found] = numbersIn('£39.00');
  assert.equal(found?.value, 39);
  assert.equal(found?.prefix, '£');
});

test('one number moving is reported as a delta', () => {
  const change = singleNumberChange('£39.00', '£29.00');
  assert.ok(change);
  assert.equal(change.before, 39);
  assert.equal(change.after, 29);
  assert.equal(change.prefix, '£');
});

test('two numbers moving at once is not summarised as one', () => {
  // A one-line summary cannot honestly describe this, so it falls through.
  assert.equal(singleNumberChange('3 left at £39', '1 left at £29'), null);
});

test('a number appearing where there was none is not a delta', () => {
  assert.equal(singleNumberChange('In stock', 'In stock, 4 left'), null);
  assert.equal(singleNumberChange('', '£29'), null);
});

test('an unchanged number is not a change', () => {
  assert.equal(singleNumberChange('£39.00', '£39.00'), null);
});

test('word diff keeps multiplicity', () => {
  const { added, removed } = wordDiff('a b', 'a b b b');
  assert.deepEqual(added, ['b', 'b']);
  assert.deepEqual(removed, []);
});

test('word diff names what came and went', () => {
  const { added, removed } = wordDiff('Out of stock', 'In stock');
  assert.deepEqual(added.sort(), ['In']);
  assert.deepEqual(removed.sort(), ['Out', 'of']);
});

test('a price change reads like a person wrote it', () => {
  const summary = describeChange('£39.00', '£29.00');
  assert.equal(summary, '£39 is now £29, down £10.');
});

test('a rise says up', () => {
  assert.match(describeChange('$100', '$120'), /up \$20/);
});

test('text appearing and disappearing is said plainly', () => {
  assert.match(describeChange('', 'Back in stock'), /^Now says "Back in stock"/);
  assert.match(describeChange('Sold out', ''), /is gone/);
});

test('a pure addition is reported as an addition', () => {
  assert.match(describeChange('Version 4.1', 'Version 4.1 released today'), /^Added:/);
});

test('a pure removal is reported as a removal', () => {
  assert.match(describeChange('Beta, unstable', 'Beta'), /^Removed:/);
});

test('anything else falls back to before and after', () => {
  const summary = describeChange('Out of stock', 'In stock now');
  assert.match(summary, /"Out of stock" is now "In stock now"\./);
});

test('no change says so rather than inventing one', () => {
  assert.equal(describeChange('same', 'same '), 'No change.');
});

test('long text is clipped for a notification', () => {
  const long = 'word '.repeat(40);
  assert.ok(clip(long).length <= 60);
  assert.match(clip(long), /…$/);
  assert.equal(clip('short'), 'short');
});
