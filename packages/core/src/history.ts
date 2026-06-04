export interface HistoryControllerOptions {
  capacity?: number;
}

const DEFAULT_CAPACITY = 100;

export class HistoryController<TSnapshot> {
  private stack: TSnapshot[] = [];
  private cursor = -1;
  private readonly capacity: number;
  private txnDepth = 0;

  constructor(opts: HistoryControllerOptions = {}) {
    this.capacity = Math.max(1, opts.capacity ?? DEFAULT_CAPACITY);
  }

  push(snapshot: TSnapshot): void {
    if (this.txnDepth > 0) return;
    this.commit(snapshot);
  }

  undo(): TSnapshot | undefined {
    if (this.cursor <= 0) return undefined;
    this.cursor -= 1;
    return this.stack[this.cursor];
  }

  redo(): TSnapshot | undefined {
    if (this.cursor >= this.stack.length - 1) return undefined;
    this.cursor += 1;
    return this.stack[this.cursor];
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.stack.length - 1;
  }

  beginTransaction(): void {
    this.txnDepth += 1;
  }

  endTransaction(snapshot: TSnapshot): void {
    if (this.txnDepth === 0) return;
    this.txnDepth -= 1;
    if (this.txnDepth === 0) {
      this.commit(snapshot);
    }
  }

  current(): TSnapshot | undefined {
    return this.cursor >= 0 ? this.stack[this.cursor] : undefined;
  }

  clear(): void {
    this.stack = [];
    this.cursor = -1;
    this.txnDepth = 0;
  }

  private commit(snapshot: TSnapshot): void {
    if (this.cursor < this.stack.length - 1) {
      this.stack.length = this.cursor + 1;
    }
    this.stack.push(snapshot);
    this.cursor = this.stack.length - 1;
    while (this.stack.length > this.capacity) {
      this.stack.shift();
      this.cursor -= 1;
    }
  }
}
