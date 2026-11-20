/** Bounded buffer that drops entries by count and by age. */
export class RingBuffer<T extends { time: number }> {
  private items: T[] = [];

  constructor(private maxItems: number, private maxAgeMs: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.maxItems) this.items.splice(0, this.items.length - this.maxItems);
  }

  prune(now = Date.now()): void {
    const cutoff = now - this.maxAgeMs;
    const index = this.items.findIndex((item) => item.time >= cutoff);
    if (index === -1) this.items = [];
    else if (index > 0) this.items.splice(0, index);
  }

  since(time: number): T[] {
    return this.items.filter((item) => item.time >= time);
  }

  toArray(): T[] {
    return this.items.slice();
  }

  replace(items: T[]): void {
    this.items = items.slice(-this.maxItems);
  }

  setMaxAge(ms: number): void {
    this.maxAgeMs = ms;
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}
