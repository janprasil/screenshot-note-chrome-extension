import { selectorFor, type SelectorNode } from './selector.ts';
import type { ElementInfo, PageGeometry } from './types.ts';

const MAX_ELEMENTS = 1_500;
const MIN_SIZE = 4;
const TEXT_LIMIT = 120;
const INTERESTING = new Set([
  'a', 'button', 'input', 'ul', 'ol', 'select', 'textarea', 'label', 'summary', 'img', 'svg', 'video', 'canvas',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'tr', 'table', 'form', 'nav', 'header',
  'footer', 'main', 'aside', 'section', 'article', 'dialog', 'span', 'div',
]);

/** Visible elements in the viewport, so the Mac editor can hit-test a click on the screenshot. */
export function collectElements(includeText: boolean): ElementInfo[] {
  const result: ElementInfo[] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isUnique = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
  const depthOf = new Map<Element, number>();
  for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
    const depth = (node.parentElement ? depthOf.get(node.parentElement) ?? 0 : 0) + 1;
    depthOf.set(node, depth);
    if (result.length >= MAX_ELEMENTS) break;

    const tag = node.tagName.toLowerCase();
    if (!INTERESTING.has(tag) && !node.hasAttribute('role')) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) continue;
    if ((tag === 'div' || tag === 'span') && !isMeaningfulContainer(node)) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

    result.push({
      selector: selectorFor(node as unknown as SelectorNode, isUnique),
      tag,
      role: node.getAttribute('role') ?? undefined,
      name: accessibleName(node),
      text: includeText ? directText(node) : undefined,
      rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
      depth,
    });
  }
  return result;
}

/** Plain wrapper divs add noise, keep only ones with own text, handlers or semantics. */
function isMeaningfulContainer(node: Element): boolean {
  if (node.hasAttribute('onclick') || node.hasAttribute('tabindex') || node.hasAttribute('aria-label')) return true;
  if ([...node.attributes].some((attribute) => attribute.name.startsWith('data-test') || attribute.name === 'data-qa' || attribute.name === 'data-cy')) return true;
  return Boolean(directText(node));
}

function accessibleName(node: Element): string | undefined {
  const value =
    node.getAttribute('aria-label') ??
    node.getAttribute('title') ??
    node.getAttribute('alt') ??
    node.getAttribute('placeholder') ??
    (node instanceof HTMLInputElement && node.type !== 'password' && (node.type === 'submit' || node.type === 'button') ? node.value : null);
  return value ? value.slice(0, TEXT_LIMIT) : undefined;
}

function directText(node: Element): string | undefined {
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return undefined;
  let text = '';
  for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
  text = text.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, TEXT_LIMIT) : undefined;
}

export function pageGeometry(): PageGeometry {
  const viewport = window.visualViewport;
  return {
    screenX: window.screenX,
    screenY: window.screenY,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    visualViewport: viewport
      ? { offsetLeft: viewport.offsetLeft, offsetTop: viewport.offsetTop, scale: viewport.scale, width: viewport.width, height: viewport.height }
      : undefined,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
