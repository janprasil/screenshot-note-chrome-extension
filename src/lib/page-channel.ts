// Handshake between the MAIN world script and the content script over MessageChannel.
// At document_start no page script runs yet, so the page cannot grab the port.

export const CHANNEL_HELLO = 'screenshot-note:hello';
export const CHANNEL_READY = 'screenshot-note:ready';
export const CHANNEL_ACK = 'screenshot-note:ack';

export interface ChannelConfig {
  type: 'config';
  enabled: boolean;
  recordBodies: boolean;
}

/** A window message is a handshake only from the same window and with the right type. */
export function isChannelMessage(event: MessageEvent, type: string): boolean {
  return event.source === window && typeof event.data === 'object' && event.data !== null && event.data.type === type;
}
