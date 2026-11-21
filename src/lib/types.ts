// Shared data shapes for the extension and the native bridge protocol.

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';

export interface ConsoleEntry {
  kind: 'console';
  time: number;
  level: ConsoleLevel;
  args: string[];
  stack?: string;
  url: string;
}

export interface ErrorEntry {
  kind: 'error';
  time: number;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  unhandledRejection: boolean;
  url: string;
}

export interface PageRequestEntry {
  kind: 'request';
  time: number;
  api: 'fetch' | 'xhr';
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  requestBody?: string;
  responseBody?: string;
  responseType?: string;
  error?: string;
  truncated?: boolean;
}

export type PageEntry = ConsoleEntry | ErrorEntry | PageRequestEntry;

export interface Header {
  name: string;
  value: string;
}

export interface NetworkEntry {
  requestId: string;
  tabId: number;
  url: string;
  method: string;
  type: string;
  initiator?: string;
  startTime: number;
  endTime?: number;
  statusCode?: number;
  statusLine?: string;
  requestHeaders?: Header[];
  responseHeaders?: Header[];
  requestBody?: string;
  fromCache?: boolean;
  ip?: string;
  error?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementInfo {
  selector: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  rect: Rect;
  depth: number;
}

/** Viewport geometry needed to map CSS pixels onto the screenshot. */
export interface PageGeometry {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
  visualViewport?: { offsetLeft: number; offsetTop: number; scale: number; width: number; height: number };
}

export interface PageInfo {
  url: string;
  title: string;
  userAgent: string;
  language: string;
  geometry: PageGeometry;
}

/** What the Mac app asks for at capture time. Set per folder configuration. */
export interface CapturePolicy {
  includeConsole: boolean;
  includeNetwork: boolean;
  includeBodies: boolean;
  includeElements: boolean;
  includeElementText: boolean;
  redactCookies: boolean;
  redactAuthHeaders: boolean;
  redactHeaders: string[];
  redactQueryParams: string[];
  redactBodyKeys: string[];
  maxBodyBytes: number;
  windowMs: number;
}

export interface CaptureSummary {
  consoleErrors: number;
  consoleWarnings: number;
  uncaughtErrors: number;
  failedRequests: { method: string; url: string; status?: number; error?: string }[];
  requestCount: number;
}

export interface CaptureBundle {
  format: 'screenshot-note-context';
  version: 1;
  capturedAt: string;
  extensionVersion: string;
  page: PageInfo;
  policy: CapturePolicy;
  summary: CaptureSummary;
  console: (ConsoleEntry | ErrorEntry)[];
  har?: unknown;
  elements?: ElementInfo[];
  /** Jen u bundle zmenšeného kvůli velikosti: zda se zahodila těla a kolik záznamů. */
  trimmed?: { bodies: boolean; network: number; console: number; elements: number };
}

export interface RecorderSettings {
  enabled: boolean;
  recordBodies: boolean;
  bufferMs: number;
}
