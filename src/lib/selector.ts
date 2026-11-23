/** Minimal element shape so selector logic is testable without a DOM. */
export interface SelectorNode {
  tagName: string;
  id: string;
  parentElement: SelectorNode | null;
  getAttribute(name: string): string | null;
  readonly children: ArrayLike<SelectorNode>;
}

const TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-cy'];
const MAX_DEPTH = 6;

/** Builds a short, stable CSS selector. isUnique checks a candidate against the document. */
export function selectorFor(element: SelectorNode, isUnique: (selector: string) => boolean = () => true): string {
  const parts: string[] = [];
  let current: SelectorNode | null = element;

  while (current && parts.length < MAX_DEPTH) {
    const anchor = anchorSelector(current);
    if (anchor) {
      const candidate = [anchor, ...parts].join(' > ');
      if (isUnique(candidate)) return candidate;
    }
    parts.unshift(positional(current));
    const candidate = parts.join(' > ');
    if (current.parentElement === null || isUnique(candidate)) return candidate;
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function anchorSelector(node: SelectorNode): string | undefined {
  for (const attribute of TEST_ATTRIBUTES) {
    const value = node.getAttribute(attribute);
    // Dlouhé hodnoty by nafoukly odpověď, takový atribut kotvou není.
    if (value && value.length <= 100) return `[${attribute}="${escapeAttribute(value)}"]`;
  }
  if (node.id && isStableId(node.id)) return `#${escapeIdentifier(node.id)}`;
  return undefined;
}

function positional(node: SelectorNode): string {
  const tag = node.tagName.toLowerCase();
  const parent = node.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
  if (siblings.length === 1) return tag;
  return `${tag}:nth-of-type(${siblings.indexOf(node) + 1})`;
}

/** Skips generated ids such as "radix-:r3:" or long hashes. */
export function isStableId(id: string): boolean {
  if (id.length > 40) return false;
  if (/[:]/.test(id)) return false;
  if (/\d{4,}/.test(id)) return false;
  if (/^[a-f0-9]{8,}$/i.test(id)) return false;
  return /^[A-Za-z][\w-]*$/.test(id);
}

export function escapeIdentifier(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1');
}

function escapeAttribute(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
