import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { confidenceOf, isSemanticClass, looksGenerated, stableSelector } from '../src/selector.js';

function pick(html: string, target: string): { selector: string; doc: Document } {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const doc = dom.window.document;
  const el = doc.querySelector(target);
  assert.ok(el, `fixture has no ${target}`);
  return { selector: stableSelector(el), doc };
}

/** A selector is only worth anything if it finds the element again. */
function resolves(html: string, target: string): boolean {
  const { selector, doc } = pick(html, target);
  return doc.querySelector(selector) === doc.querySelector(target);
}

test('framework identifiers are recognised as worthless', () => {
  assert.equal(looksGenerated(':r3:'), true); // React useId
  assert.equal(looksGenerated('css-1q2w3e'), true); // Emotion
  assert.equal(looksGenerated('Button_root__x8f2k'), true); // CSS modules
  assert.equal(looksGenerated('ember1043'), true);
  assert.equal(looksGenerated('radix-abc'), true);
  assert.equal(looksGenerated('a3f9c2b81d'), true); // a bare hash
  assert.equal(looksGenerated('item-1024'), true); // a long counter
  assert.equal(looksGenerated(''), true);
});

test('identifiers a person wrote are kept', () => {
  assert.equal(looksGenerated('price'), false);
  assert.equal(looksGenerated('product-price'), false);
  assert.equal(looksGenerated('main-content'), false);
  // A short number is a real part of many hand-written names.
  assert.equal(looksGenerated('h2-heading'), false);
});

test('utility classes are not used as anchors', () => {
  // They describe how a thing looks, and a redesign rewrites every one.
  assert.equal(isSemanticClass('text-sm'), false);
  assert.equal(isSemanticClass('px-4'), false);
  assert.equal(isSemanticClass('md:flex'), false);
  assert.equal(isSemanticClass('hover:bg-red'), false);
  assert.equal(isSemanticClass('css-1x2y3z'), false);
  assert.equal(isSemanticClass('price'), true);
  assert.equal(isSemanticClass('product-title'), true);
});

test('a hand-written id wins outright', () => {
  const { selector } = pick('<div><span id="price">£39</span></div>', '#price');
  assert.equal(selector, '#price');
  assert.equal(confidenceOf(selector), 'high');
});

test('a generated id is ignored in favour of the path', () => {
  const { selector } = pick('<main class="content"><span id=":r7:">£39</span></main>', 'span');
  assert.doesNotMatch(selector, /:r7:/);
  assert.ok(resolves('<main class="content"><span id=":r7:">£39</span></main>', 'span'));
});

test('a test attribute is the next best anchor', () => {
  const { selector } = pick('<div><span data-testid="price">£39</span></div>', 'span');
  assert.equal(selector, '[data-testid="price"]');
  assert.equal(confidenceOf(selector), 'high');
});

test('the path stops at the nearest anchored ancestor', () => {
  // Keeps it short, and stops a change in the header breaking a footer watch.
  const html =
    '<div id="wrap"><div class="a"><div class="b"><span class="price">£39</span></div></div></div>';
  const { selector } = pick(html, '.price');
  assert.match(selector, /^#wrap > /);
  assert.ok(resolves(html, '.price'));
});

test('utility soup does not end up in the selector', () => {
  const html = '<main class="content"><p class="text-sm px-4 leading-6 stock">In stock</p></main>';
  const { selector } = pick(html, '.stock');
  assert.doesNotMatch(selector, /text-sm|px-4|leading-6/);
  assert.match(selector, /\.stock/);
  assert.ok(resolves(html, '.stock'));
});

test('position is only added when it is needed to disambiguate', () => {
  const single = pick('<ul class="list"><li class="row">one</li></ul>', '.row');
  assert.doesNotMatch(single.selector, /nth-of-type/);

  const many = '<ul class="list"><li class="row">one</li><li class="row">two</li></ul>';
  const { selector } = pick(many, 'li:nth-child(2)');
  assert.match(selector, /nth-of-type\(2\)/);
  assert.equal(confidenceOf(selector), 'low');
});

test('the selector resolves in the page it came from, in every shape', () => {
  const cases: [string, string][] = [
    ['<div id="a"><p>text</p></div>', 'p'],
    ['<section class="prose"><h2 class="title">Hi</h2></section>', '.title'],
    ['<div><span data-test="v">4.1.0</span></div>', 'span'],
    ['<table><tr><td>a</td><td class="cell">b</td></tr></table>', '.cell'],
    [
      '<main><div><div><div><div><span class="deep">x</span></div></div></div></div></main>',
      '.deep',
    ],
  ];
  for (const [html, target] of cases) {
    assert.ok(resolves(html, target), `did not resolve: ${target} in ${html}`);
  }
});

test('confidence is honest about what it is built on', () => {
  assert.equal(confidenceOf('#price'), 'high');
  assert.equal(confidenceOf('[data-testid="x"]'), 'high');
  assert.equal(confidenceOf('main.content > p.stock'), 'medium');
  assert.equal(confidenceOf('main > li:nth-of-type(4)'), 'low');
});
