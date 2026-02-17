/**
 * RingBuffer<T>
 *
 * Fixed-capacity circular buffer.  New items overwrite the oldest when full.
 * getAll() always returns items in chronological order (oldest → newest).
 */
export class RingBuffer<T> {
  private readonly buf: T[];
  private head    = 0; // index of next write position
  private _size   = 0;

  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  /** Add an item.  O(1). */
  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  /** Number of items currently held */
  get size(): number { return this._size; }

  /** True when the buffer contains at least one item */
  get isEmpty(): boolean { return this._size === 0; }

  /**
   * All items in chronological order.
   * When the buffer is full this rotates the internal array so the oldest
   * item is first.
   */
  getAll(): T[] {
    if (this._size < this.capacity) {
      return this.buf.slice(0, this._size);
    }
    // head points to the oldest slot when full
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  /** Last n items in chronological order */
  getLast(n: number): T[] {
    const all = this.getAll();
    return n >= all.length ? all : all.slice(all.length - n);
  }

  clear(): void {
    this.head  = 0;
    this._size = 0;
  }
}
