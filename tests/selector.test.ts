import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStableId, selectorFor, type SelectorNode } from '../src/lib/selector.ts';

function node(tagName: string, attributes: Record<string, string> = {}, children: SelectorNode[] = []): SelectorNode {
  const element: SelectorNode = {
    tagName: tagName.toUpperCase(),
    id: attributes.id ?? '',
    parentElement: null,
    getAttribute: (name) => attributes[name] ?? null,
    children,
  };
  for (const child of children) (child as { parentElement: SelectorNode | null }).parentElement = element;
  return element;
}

test('prefers test attributes and stable ids', () => {
  const button = node('button', { 'data-testid': 'save' });
  node('div', {}, [button]);
  assert.equal(selectorFor(button), '[data-testid="save"]');

  const field = node('input', { id: 'email' });
  node('form', {}, [field]);
  assert.equal(selectorFor(field), '#email');
});

test('falls back to nth-of-type path until unique', () => {
  const second = node('li');
  const list = node('ul', { id: 'menu' }, [node('li'), second]);
  node('body', {}, [list]);
  const unique = new Set(['#menu > li:nth-of-type(2)']);
  assert.equal(selectorFor(second, (selector) => unique.has(selector)), '#menu > li:nth-of-type(2)');
});

test('generated ids are not used', () => {
  assert.equal(isStableId('radix-:r3:'), false);
  assert.equal(isStableId('a8f3c2d19e'), false);
  assert.equal(isStableId('item-12345'), false);
  assert.equal(isStableId('main-nav'), true);
});
