// Minimální falešné chrome API pro testy service workeru a content scriptu.
type Listener = { fn: (...args: any[]) => any; filter?: unknown; spec?: string[] };

export class FakeEvent {
  listeners: Listener[] = [];
  addListener(fn: (...args: any[]) => any, filter?: unknown, spec?: string[]): void {
    this.listeners.push({ fn, filter, spec });
  }
  removeListener(fn: (...args: any[]) => any): void {
    this.listeners = this.listeners.filter((listener) => listener.fn !== fn);
  }
  hasListener(fn: (...args: any[]) => any): boolean {
    return this.listeners.some((listener) => listener.fn === fn);
  }
  fire(...args: any[]): unknown[] {
    return this.listeners.map((listener) => listener.fn(...args));
  }
}

class FakeArea {
  data: Record<string, unknown> = {};
  private onChanged?: FakeEvent;
  private name?: string;
  constructor(onChanged?: FakeEvent, name?: string) {
    this.onChanged = onChanged;
    this.name = name;
  }
  async get(key: string | null): Promise<Record<string, unknown>> {
    if (key === null) return structuredClone(this.data);
    return key in this.data ? { [key]: structuredClone(this.data[key]) } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      const oldValue = this.data[key];
      this.data[key] = structuredClone(value);
      this.onChanged?.fire({ [key]: { oldValue, newValue: structuredClone(value) } }, this.name);
    }
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.data[key];
  }
  async clear(): Promise<void> {
    this.data = {};
  }
}

export interface FakeTab {
  id: number;
  windowId: number;
  active: boolean;
  url: string;
  title: string;
}

export interface FakeWindow {
  id: number;
  focused: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  tabs: FakeTab[];
}

export interface FakeChromeOptions {
  settings?: Record<string, unknown>;
  session?: Record<string, unknown>;
  windows?: FakeWindow[];
  // Odpověď content scriptu na collect, podle ID záložky.
  collect?: (tabId: number) => unknown;
  // Odpověď content scriptu na recorder-status, podle ID záložky.
  recorderStatus?: (tabId: number) => unknown;
}

export function installFakeChrome(options: FakeChromeOptions = {}) {
  const onChanged = new FakeEvent();
  const local = new FakeArea(onChanged, 'local');
  const session = new FakeArea();
  if (options.settings) local.data.settings = options.settings;
  if (options.session) session.data = structuredClone(options.session);
  const windows = options.windows ?? [
    { id: 1, focused: true, left: 0, top: 0, width: 1200, height: 800, tabs: [{ id: 1, windowId: 1, active: true, url: 'https://app.example.com/', title: 'App' }] },
  ];
  const sent: any[] = [];
  const port = {
    onMessage: new FakeEvent(),
    onDisconnect: new FakeEvent(),
    postMessage: (message: unknown) => sent.push(structuredClone(message)),
    disconnect: () => {},
  };
  const allTabs = () => windows.flatMap((window) => window.tabs);
  const chrome = {
    runtime: {
      id: 'ext',
      lastError: undefined,
      getManifest: () => ({ version: '0.1.0' }),
      getURL: (path: string) => `chrome-extension://ext/${path}`,
      connectNative: () => port,
      onStartup: new FakeEvent(),
      onInstalled: new FakeEvent(),
      onMessage: new FakeEvent(),
    },
    storage: { local, session, onChanged },
    tabs: {
      get: async (id: number) => {
        const tab = allTabs().find((candidate) => candidate.id === id);
        if (!tab) throw new Error('No tab');
        return structuredClone(tab);
      },
      sendMessage: async (tabId: number, message: any) => (message?.type === 'recorder-status' ? options.recorderStatus?.(tabId) : options.collect?.(tabId)),
      query: async () => structuredClone(allTabs()),
      onRemoved: new FakeEvent(),
    },
    scripting: {
      registered: [] as any[],
      injected: [] as any[],
      async getRegisteredContentScripts({ ids }: { ids: string[] }) {
        return this.registered.filter((script: any) => ids.includes(script.id));
      },
      async registerContentScripts(scripts: any[]) {
        this.registered.push(...scripts);
      },
      async unregisterContentScripts({ ids }: { ids: string[] }) {
        this.registered = this.registered.filter((script: any) => !ids.includes(script.id));
      },
      async executeScript(injection: any) {
        this.injected.push(injection);
        return [];
      },
    },
    windows: { getAll: async () => structuredClone(windows) },
    webRequest: {
      onBeforeRequest: new FakeEvent(),
      onBeforeSendHeaders: new FakeEvent(),
      onHeadersReceived: new FakeEvent(),
      onCompleted: new FakeEvent(),
      onErrorOccurred: new FakeEvent(),
    },
  };
  (globalThis as any).chrome = chrome;
  return { chrome, port, sent, local, session, windows };
}

let instance = 0;

/** Načte background.ts jako novou instanci modulu nad čerstvým falešným chrome. */
export async function loadBackground(options: FakeChromeOptions = {}) {
  const fake = installFakeChrome(options);
  await import(`../src/background.ts?instance=${++instance}`);
  const request = async (message: Record<string, unknown>) => {
    const id = String(message.id);
    fake.port.onMessage.fire(message);
    for (let attempt = 0; attempt < 500; attempt++) {
      const reply = fake.sent.find((item) => item.id === id);
      if (reply) return reply;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`No reply to ${id}`);
  };
  return { ...fake, request };
}

let contentInstance = 0;

/** MessagePort v paměti; skutečný port v Node drží event loop a testy by nedoběhly. */
class FakePort {
  other?: FakePort;
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(data: unknown): void {
    const target = this.other;
    const copy = structuredClone(data);
    setTimeout(() => {
      if (!this.closed && target && !target.closed) target.onmessage?.({ data: copy });
    }, 0);
  }
  close(): void {
    this.closed = true;
  }
}

class FakeMessageChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

/** Načte content.ts s minimálním document a window. */
export async function loadContent(settings: Record<string, unknown> = { enabled: true, recordBodies: false, bufferMs: 300_000 }) {
  const fake = installFakeChrome({ settings });
  const document = new EventTarget() as EventTarget & { title: string };
  document.title = 'Page';
  const window = Object.assign(new EventTarget(), { screenX: 0, screenY: 0, outerWidth: 1200, outerHeight: 800, innerWidth: 1200, innerHeight: 700, devicePixelRatio: 2, scrollX: 0, scrollY: 0 }) as any;
  window.top = window;
  window.postMessage = (data: unknown, _origin: string, transfer: MessagePort[] = []) => {
    window.dispatchEvent(Object.assign(new Event('message'), { data, source: window, ports: transfer }));
  };
  Object.assign(globalThis, { document, window, location: { href: 'https://app.example.com/' }, MessageChannel: FakeMessageChannel });
  // Simulovaný MAIN skript: převezme port z handshaku a potvrdí ho.
  let mainPort: FakePort | undefined;
  const config: any[] = [];
  window.addEventListener('message', (event: any) => {
    if (mainPort || event.data?.type !== 'screenshot-note:hello' || !event.ports[0]) return;
    mainPort = event.ports[0] as FakePort;
    mainPort.onmessage = (message) => config.push(message.data);
    mainPort.postMessage({ type: 'screenshot-note:ack' });
  });
  await import(`../src/content.ts?instance=${++contentInstance}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const emit = (entry: unknown) => mainPort!.postMessage(JSON.stringify(entry));
  // Zprávy přes port jsou asynchronní, collect počká na jejich doručení.
  const collect = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Promise<any>((resolve) => {
      fake.chrome.runtime.onMessage.fire({ type: 'collect', since: 0, includeElements: false, includeElementText: false }, {}, resolve);
    });
  };
  const status = () => new Promise<any>((resolve) => fake.chrome.runtime.onMessage.fire({ type: 'recorder-status' }, {}, resolve));
  return { ...fake, emit, collect, status, config, window, document };
}
