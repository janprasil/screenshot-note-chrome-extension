const MAX_ARG_LENGTH = 4_000;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;
// Rozpočet jednoho argumentu, aby velký objekt nezdržel stránku.
const MAX_NODES = 2_000;
// Hodnoty pod citlivým klíčem se skryjí už ve stránce, včetně objektů a polí.
const SENSITIVE_KEY_PARTS = ['pass', 'pwd', 'secret', 'token', 'otp', 'cvv', 'card', 'auth', 'key', 'session', 'cookie', 'jwt', 'credential'];
const REDACTED = '"[redacted]"';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

interface Budget {
  nodes: number;
  chars: number;
}

/** Turns any console argument into bounded text without throwing. */
export function serializeArg(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value.slice(0, MAX_ARG_LENGTH + 1) : describe(value, 0, new WeakSet(), { nodes: MAX_NODES, chars: MAX_ARG_LENGTH });
    const length = typeof value === 'string' ? value.length : text.length;
    return text.length > MAX_ARG_LENGTH || length > MAX_ARG_LENGTH ? `${text.slice(0, MAX_ARG_LENGTH)}… [${length} chars]` : text;
  } catch {
    return '[unserializable]';
  }
}

function describe(value: unknown, depth: number, seen: WeakSet<object>, budget: Budget): string {
  if (--budget.nodes < 0 || budget.chars <= 0) return '…';
  const text = describeValue(value, depth, seen, budget);
  // Objekty se nepočítají, jejich obsah už odečetly vnořené hodnoty.
  if (!value || typeof value !== 'object' || value instanceof Error) budget.chars -= text.length;
  return text;
}

function describeValue(value: unknown, depth: number, seen: WeakSet<object>, budget: Budget): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    // Vnořený JSON v řetězci se rozbalí, aby se v něm skryly citlivé klíče.
    const nested = depth > 0 && value.length <= MAX_ARG_LENGTH && /^\s*[[{]/.test(value) ? parseJson(value) : undefined;
    if (nested !== undefined) return describeValue(nested, depth, seen, budget);
    return JSON.stringify(value.length > MAX_ARG_LENGTH ? `${value.slice(0, MAX_ARG_LENGTH)}…` : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`.slice(0, MAX_ARG_LENGTH + 1);
  if (typeof Element !== 'undefined' && value instanceof Element) return describeElement(value);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_KEYS).map((item) => describe(item, depth + 1, seen, budget));
    if (value.length > MAX_KEYS) items.push(`… ${value.length - MAX_KEYS} more`);
    return `[${items.join(', ')}]`;
  }
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (value instanceof Date) return value.toISOString();

  const keys = Object.keys(value);
  const pairs = keys.slice(0, MAX_KEYS).map((key) => {
    budget.chars -= key.length;
    if (isSensitiveKey(key)) return `${JSON.stringify(key)}: ${REDACTED}`;
    return `${JSON.stringify(key)}: ${describe((value as Record<string, unknown>)[key], depth + 1, seen, budget)}`;
  });
  if (keys.length > MAX_KEYS) pairs.push(`… ${keys.length - MAX_KEYS} more`);
  const name = value.constructor && value.constructor !== Object ? `${value.constructor.name} ` : '';
  return `${name}{${pairs.join(', ')}}`;
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/).join('.')}` : '';
  return `<${element.tagName.toLowerCase()}${id}${classes}>`;
}
