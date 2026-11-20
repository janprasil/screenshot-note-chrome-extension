import { buildHar } from './har.ts';
import { summarize } from './summary.ts';
import { redactUrl } from './redact.ts';
import type {
  CaptureBundle,
  CapturePolicy,
  ConsoleEntry,
  ElementInfo,
  ErrorEntry,
  NetworkEntry,
  PageEntry,
  PageInfo,
  PageRequestEntry,
} from './types.ts';

interface BundleInput {
  page: PageInfo;
  entries: PageEntry[];
  elements?: ElementInfo[];
  network: NetworkEntry[];
  policy: CapturePolicy;
  extensionVersion: string;
  now?: number;
}

/** Assembles the context bundle; all redaction happens here, right before it leaves the browser. */
export function buildBundle(input: BundleInput): CaptureBundle {
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
    summary: summarize(policy.includeConsole ? logs : [], network, policy.includeNetwork ? pageRequests : [], policy),
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
  if (copy.kind === 'error' && copy.source) copy.source = redactUrl(copy.source, policy);
  return copy;
}
