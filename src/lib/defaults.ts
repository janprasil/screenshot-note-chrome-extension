import type { CapturePolicy, RecorderSettings } from './types.ts';

export const PROTOCOL_VERSION = 1;
export const NATIVE_HOST = 'cz.janprasil.screenshotnote.bridge';

export const DEFAULT_SETTINGS: RecorderSettings = {
  enabled: true,
  recordBodies: false,
  bufferMs: 5 * 60_000,
};

export const COOKIE_HEADERS = ['cookie', 'set-cookie'];

export const AUTH_HEADERS = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
];

export const DEFAULT_POLICY: CapturePolicy = {
  includeConsole: true,
  includeNetwork: true,
  includeBodies: false,
  includeElements: true,
  includeElementText: true,
  redactCookies: true,
  redactAuthHeaders: true,
  redactHeaders: [],
  redactQueryParams: [
    'token', 'access_token', 'refresh_token', 'id_token', 'code', 'state',
    'key', 'api_key', 'apikey', 'password', 'secret', 'signature', 'sig', 'session',
  ],
  redactBodyKeys: ['password', 'passwd', 'secret', 'token', 'access_token', 'refresh_token', 'authorization', 'api_key', 'apikey'],
  maxBodyBytes: 64 * 1024,
  windowMs: 2 * 60_000,
};

/** Fills missing fields so older or partial app requests stay valid. */
export function normalizePolicy(input: Partial<CapturePolicy> | undefined): CapturePolicy {
  const policy = { ...DEFAULT_POLICY, ...(input ?? {}) };
  policy.windowMs = clamp(policy.windowMs, 1_000, 10 * 60_000);
  policy.maxBodyBytes = clamp(policy.maxBodyBytes, 0, 1024 * 1024);
  return policy;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
