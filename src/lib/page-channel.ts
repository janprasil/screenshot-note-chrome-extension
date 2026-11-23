// Handshake mezi MAIN world skriptem a content scriptem přes MessageChannel.
// Při document_start ještě neběží žádný skript stránky, takže port stránka nezachytí.

export const CHANNEL_HELLO = 'screenshot-note:hello';
export const CHANNEL_READY = 'screenshot-note:ready';
export const CHANNEL_ACK = 'screenshot-note:ack';

export interface ChannelConfig {
  type: 'config';
  enabled: boolean;
  recordBodies: boolean;
}

/** Zpráva z okna je handshake jen ze stejného okna a se správným typem. */
export function isChannelMessage(event: MessageEvent, type: string): boolean {
  return event.source === window && typeof event.data === 'object' && event.data !== null && event.data.type === type;
}
