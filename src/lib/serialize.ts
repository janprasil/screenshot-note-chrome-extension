const MAX_ARG_LENGTH = 4_000;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;

/** Turns any console argument into bounded text without throwing. */
export function serializeArg(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : describe(value, 0, new WeakSet());
    return text.length > MAX_ARG_LENGTH ? `${text.slice(0, MAX_ARG_LENGTH)}… [${text.length} chars]` : text;
  } catch {
    return '[unserializable]';
  }
}

function describe(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  if (typeof Element !== 'undefined' && value instanceof Element) return describeElement(value);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_KEYS).map((item) => describe(item, depth + 1, seen));
    if (value.length > MAX_KEYS) items.push(`… ${value.length - MAX_KEYS} more`);
    return `[${items.join(', ')}]`;
  }
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (value instanceof Date) return value.toISOString();

  const keys = Object.keys(value);
  const pairs = keys.slice(0, MAX_KEYS).map((key) => `${JSON.stringify(key)}: ${describe((value as Record<string, unknown>)[key], depth + 1, seen)}`);
  if (keys.length > MAX_KEYS) pairs.push(`… ${keys.length - MAX_KEYS} more`);
  const name = value.constructor && value.constructor !== Object ? `${value.constructor.name} ` : '';
  return `${name}{${pairs.join(', ')}}`;
}

function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/).join('.')}` : '';
  return `<${element.tagName.toLowerCase()}${id}${classes}>`;
}
