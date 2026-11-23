import { pairPageRequests } from './har.ts';
import { redactUrl, redactUrlsInText } from './redact.ts';
import type { CapturePolicy, CaptureSummary, ConsoleEntry, ErrorEntry, NetworkEntry, PageRequestEntry } from './types.ts';

const MAX_FAILED = 20;

export function summarize(
  logs: (ConsoleEntry | ErrorEntry)[],
  network: NetworkEntry[],
  pageRequests: PageRequestEntry[],
  policy: CapturePolicy,
): CaptureSummary {
  const failed: CaptureSummary['failedRequests'] = [];
  for (const entry of network) {
    if ((entry.statusCode ?? 0) >= 400 || entry.error) {
      failed.push({ method: entry.method, url: redactUrl(entry.url, policy), status: entry.statusCode, error: entry.error && redactUrlsInText(entry.error, policy) });
    }
  }
  const seen = new Set(network.map((entry) => `${entry.method} ${entry.url}`));
  for (const entry of pageRequests) {
    if (seen.has(`${entry.method} ${entry.url}`)) continue;
    if ((entry.status ?? 0) >= 400 || entry.error) {
      failed.push({ method: entry.method, url: redactUrl(entry.url, policy), status: entry.status, error: entry.error && redactUrlsInText(entry.error, policy) });
    }
  }
  return {
    consoleErrors: logs.filter((entry) => entry.kind === 'console' && entry.level === 'error').length,
    consoleWarnings: logs.filter((entry) => entry.kind === 'console' && entry.level === 'warn').length,
    uncaughtErrors: logs.filter((entry) => entry.kind === 'error').length,
    failedRequests: failed.slice(-MAX_FAILED),
    // Požadavky jen ze záznamu stránky (např. obsloužené service workerem) se počítají také.
    requestCount: network.length + pageRequests.length - pairPageRequests(network, pageRequests).size,
  };
}
