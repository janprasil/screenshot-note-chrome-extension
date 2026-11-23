/** Bounded buffer that drops entries by count, by age and optionally by total size. */
export class RingBuffer<T extends { time: number }> {
  private items: T[] = [];
  private sizes: number[] = [];
  private total = 0;
  private maxItems: number;
  private maxAgeMs: number;
  private maxSize: number;
  private sizeOf: (item: T) => number;

  constructor(maxItems: number, maxAgeMs: number, maxSize = Infinity, sizeOf: (item: T) => number = () => 0) {
    this.maxItems = maxItems;
    this.maxAgeMs = maxAgeMs;
    this.maxSize = maxSize;
    this.sizeOf = sizeOf;
  }

  push(item: T): void {
    const size = this.sizeOf(item);
    // Záznam větší než celý limit se nepřijme.
    if (size > this.maxSize) return;
    this.items.push(item);
    this.sizes.push(size);
    this.total += size;
    this.trim();
    // Záznamy starší než okno vůči nejnovějšímu se zahodí hned, ne až při exportu.
    if (this.items.length > 0 && this.items[0].time < item.time - this.maxAgeMs) this.prune(item.time);
  }

  /** Přepočítá velikost záznamu, který se po vložení změnil, a případně uvolní nejstarší. */
  resize(item: T): void {
    const index = this.items.lastIndexOf(item);
    if (index === -1) return;
    const size = this.sizeOf(item);
    this.total += size - this.sizes[index];
    this.sizes[index] = size;
    if (size > this.maxSize) {
      this.items.splice(index, 1);
      this.total -= this.sizes.splice(index, 1)[0];
    }
    this.trim();
  }

  prune(now = Date.now()): void {
    const cutoff = now - this.maxAgeMs;
    const index = this.items.findIndex((item) => item.time >= cutoff);
    this.drop(index === -1 ? this.items.length : index);
  }

  since(time: number): T[] {
    return this.items.filter((item) => item.time >= time);
  }

  toArray(): T[] {
    return this.items.slice();
  }

  replace(items: T[]): void {
    const sized = items.slice(-this.maxItems).map((item) => ({ item, size: this.sizeOf(item) })).filter(({ size }) => size <= this.maxSize);
    this.items = sized.map(({ item }) => item);
    this.sizes = sized.map(({ size }) => size);
    this.total = this.sizes.reduce((sum, size) => sum + size, 0);
    this.trim();
  }

  setMaxAge(ms: number): void {
    this.maxAgeMs = ms;
  }

  clear(): void {
    this.items = [];
    this.sizes = [];
    this.total = 0;
  }

  get size(): number {
    return this.items.length;
  }

  private trim(): void {
    let count = Math.max(0, this.items.length - this.maxItems);
    let total = this.total;
    for (let index = 0; index < count; index++) total -= this.sizes[index];
    while (total > this.maxSize && count < this.items.length) total -= this.sizes[count++];
    this.drop(count);
  }

  private drop(count: number): void {
    if (count <= 0) return;
    this.items.splice(0, count);
    for (const size of this.sizes.splice(0, count)) this.total -= size;
  }
}
