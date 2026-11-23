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

/** Sensitive header or query parameter name, on top of the exact lists. */
export const SENSITIVE_NAME_PATTERN = /token|secret|key|auth|session|csrf|signature|credential|password|pass|pwd|otp|jwt|assertion|oidc|principal|appcheck|dpop/i;

// Headers the pattern matches although their value is not sensitive.
export const BENIGN_HEADERS = ['keep-alive', 'access-control-allow-credentials', 'www-authenticate', 'proxy-authenticate'];

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
    'key', 'api_key', 'apikey', 'password', 'secret', 'signature', 'sig', 'session', 'jwt', 'sid', 'phpsessid', 'ticket',
  ],
  redactBodyKeys: ['password', 'passwd', 'secret', 'token', 'access_token', 'refresh_token', 'authorization', 'api_key', 'apikey'],
  maxBodyBytes: 64 * 1024,
  windowMs: 2 * 60_000,
};

const MAX_LIST = 200;

/**
 * Policy from the host may only add redaction, never remove it.
 * Fields with a wrong type are ignored; bodies leave only while body recording is on.
 */
export function normalizePolicy(input: unknown, settings: RecorderSettings): CapturePolicy {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const flag = (name: keyof CapturePolicy) => (typeof raw[name] === 'boolean' ? (raw[name] as boolean) : (DEFAULT_POLICY[name] as boolean));
  return {
    includeConsole: flag('includeConsole'),
    includeNetwork: flag('includeNetwork'),
    includeBodies: settings.recordBodies === true && raw.includeBodies === true,
    includeElements: flag('includeElements'),
    includeElementText: flag('includeElementText'),
    redactCookies: true,
    redactAuthHeaders: true,
    redactHeaders: mergeNames(DEFAULT_POLICY.redactHeaders, raw.redactHeaders),
    redactQueryParams: mergeNames(DEFAULT_POLICY.redactQueryParams, raw.redactQueryParams),
    redactBodyKeys: mergeNames(DEFAULT_POLICY.redactBodyKeys, raw.redactBodyKeys),
    maxBodyBytes: clamp(raw.maxBodyBytes, DEFAULT_POLICY.maxBodyBytes, 0, 1024 * 1024),
    windowMs: clamp(raw.windowMs, DEFAULT_POLICY.windowMs, 1_000, 10 * 60_000),
  };
}

function mergeNames(defaults: string[], extra: unknown): string[] {
  const names = [...defaults];
  if (!Array.isArray(extra)) return names;
  for (const name of extra.slice(0, MAX_LIST)) {
    if (typeof name === 'string' && name.length > 0 && name.length <= 200 && !names.includes(name)) names.push(name);
  }
  return names;
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
