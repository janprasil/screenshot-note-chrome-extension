import { buildHar } from './har.ts';
import { summarize } from './summary.ts';
import { redactUrl, redactUrlsInText } from './redact.ts';
import type {
  CaptureBundle,
  CapturePolicy,
  CaptureSummary,
  ConsoleEntry,
  ElementInfo,
  ErrorEntry,
  NetworkEntry,
  PageEntry,
  PageInfo,
  PageRequestEntry,
} from './types.ts';

export interface BundleInput {
  page: PageInfo;
  entries: PageEntry[];
  elements?: ElementInfo[];
  network: NetworkEntry[];
  policy: CapturePolicy;
  extensionVersion: string;
  now?: number;
}

/** Assembles the context bundle; all redaction happens here, right before it leaves the browser. */
export function buildBundle(input: BundleInput, summary?: CaptureSummary): CaptureBundle {
  const { policy } = input;
  const logs = input.entries.filter((entry): entry is ConsoleEntry | ErrorEntry => entry.kind !== 'request');
  const pageRequests = input.entries.filter((entry): entry is PageRequestEntry => entry.kind === 'request');
  const network = policy.includeNetwork ? input.network : [];

  const bundle: CaptureBundle = {
    format: 'screenshot-note-context',
    version: 1,
    capturedAt: new Date(input.now ?? Date.now()).toISOString(),
    extensionVersion: input.extensionVersion,
    page: { ...input.page, url: redactUrl(input.page.url, policy) },
    policy,
    summary: summary ?? summarize(policy.includeConsole ? logs : [], network, policy.includeNetwork ? pageRequests : [], policy),
    console: policy.includeConsole ? logs.map((entry) => redactLogUrls(entry, policy)) : [],
  };
  if (policy.includeNetwork) {
    bundle.har = buildHar({
      network,
      pageRequests,
      pageUrl: input.page.url,
      pageTitle: input.page.title,
      extensionVersion: input.extensionVersion,
      policy,
    });
  }
  if (policy.includeElements && input.elements) {
    bundle.elements = policy.includeElementText ? input.elements : input.elements.map(({ text: _text, ...rest }) => rest);
  }
  return bundle;
}

function redactLogUrls<T extends ConsoleEntry | ErrorEntry>(entry: T, policy: CapturePolicy): T {
  const copy = { ...entry, url: redactUrl(entry.url, policy) };
  if (copy.stack) copy.stack = redactUrlsInText(copy.stack, policy);
  if (copy.kind === 'error') {
    if (copy.source) copy.source = redactUrl(copy.source, policy);
    copy.message = redactUrlsInText(copy.message, policy);
  }
  return copy;
}

/** Pevný strop velikosti bundle v UTF-8 bajtech. */
export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;

const encoder = new TextEncoder();

export function bundleBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/**
 * Postaví bundle, který se vejde do limitu. Nejdřív zahodí těla, pak nejstarší
 * záznamy sítě a konzole podle společné časové hranice, nakonec elementy.
 * Souhrn vždy popisuje celá data. Když se nevejde ani prázdný, vrátí undefined.
 */
export function buildFittingBundle(input: BundleInput, maxBytes = MAX_BUNDLE_BYTES): CaptureBundle | undefined {
  const full = buildBundle(input);
  let size = bundleBytes(full);
  if (size <= maxBytes) return full;
  const { summary } = full;
  const trimmed = { bodies: input.policy.includeBodies, network: 0, console: 0, elements: 0 };
  const base: BundleInput = { ...input, policy: { ...input.policy, includeBodies: false } };
  if (input.policy.includeBodies) {
    const bundle = buildBundle(base, summary);
    size = bundleBytes(bundle);
    if (size <= maxBytes) return { ...bundle, trimmed };
  }

  // Velikost bez záznamů sítě a konzole; když se nevejde, ubírají se elementy.
  const empty: BundleInput = { ...base, network: [], entries: [] };
  let elements = base.elements;
  let fixed = bundleBytes(buildBundle(empty, summary));
  while (fixed > maxBytes && elements && elements.length > 0) {
    elements = elements.slice(0, Math.floor(elements.length / 2));
    fixed = bundleBytes(buildBundle({ ...empty, elements }, summary));
  }
  if (fixed > maxBytes) return undefined;

  // Záznamy od nejnovějšího s odhadem jejich podílu na velikosti bundle.
  // Při stejném čase rozhoduje pořadí v bufferu, pozdější je novější.
  const items: { time: number; order: number; size: number; value: object }[] = [
    ...base.network.map((entry, order) => ({ time: entry.startTime, order, size: bundleBytes(entry), value: entry })),
    ...base.entries.map((entry, order) => ({ time: entry.time, order, size: bundleBytes(entry), value: entry })),
  ].sort((a, b) => b.time - a.time || b.order - a.order);
  const rawTotal = items.reduce((sum, item) => sum + item.size, 0);
  const scale = rawTotal > 0 ? Math.max(1, (size - fixed) / rawTotal) : 1;
  let budget = ((maxBytes - fixed) / scale) * 0.95;
  for (let attempt = 0; attempt < 6; attempt++) {
    let used = 0;
    const kept = new Set<object>();
    for (const item of items) {
      if (used + item.size > budget) break;
      used += item.size;
      kept.add(item.value);
    }
    const network = base.network.filter((entry) => kept.has(entry));
    const entries = base.entries.filter((entry) => kept.has(entry));
    const bundle = buildBundle({ ...base, network, entries, elements }, summary);
    if (bundleBytes(bundle) <= maxBytes) {
      const logs = (list: BundleInput['entries']) => list.filter((entry) => entry.kind !== 'request').length;
      trimmed.network = base.network.length - network.length;
      trimmed.console = logs(base.entries) - logs(entries);
      trimmed.elements = (base.elements?.length ?? 0) - (elements?.length ?? 0);
      return { ...bundle, trimmed };
    }
    budget *= 0.7;
  }
  const bundle = buildBundle({ ...empty, elements }, summary);
  return { ...bundle, trimmed: { ...trimmed, network: base.network.length, console: base.entries.filter((entry) => entry.kind !== 'request').length, elements: (base.elements?.length ?? 0) - (elements?.length ?? 0) } };
}
