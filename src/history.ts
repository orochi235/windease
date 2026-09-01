import { trace } from './trace.js';

/** Options for {@link HistoryController}. */
export interface HistoryControllerOptions {
  capacity?: number;
}

const DEFAULT_CAPACITY = 100;

/**
 * Undo/redo over whole snapshots, generic in what a snapshot is — pair it with
 * `serialize`/`deserialize` to get history over a `Store`.
 *
 * Keeps a cursor into a bounded stack: pushing after an undo discards the
 * redo tail, and the oldest entry is evicted past `capacity`. Pushes between
 * `beginTransaction` and `endTransaction` collapse into one entry, so a
 * multi-step operation undoes as a unit.
 */
export class HistoryController<TSnapshot> {
  private stack: TSnapshot[] = [];
  private cursor = -1;
  private readonly capacity: number;
  private txnDepth = 0;

  constructor(opts: HistoryControllerOptions = {}) {
    this.capacity = Math.max(1, opts.capacity ?? DEFAULT_CAPACITY);
  }

  push(snapshot: TSnapshot): void {
    if (this.txnDepth > 0) {
      trace('history', `push deferred (txnDepth=${this.txnDepth})`);
      return;
    }
    this.commit(snapshot);
  }

  undo(): TSnapshot | undefined {
    if (this.cursor <= 0) {
      trace('history', 'undo: nothing to undo');
      return undefined;
    }
    this.cursor -= 1;
    trace('history', `undo → cursor ${this.cursor}/${this.stack.length - 1}`);
    return this.stack[this.cursor];
  }

  redo(): TSnapshot | undefined {
    if (this.cursor >= this.stack.length - 1) {
      trace('history', 'redo: nothing to redo');
      return undefined;
    }
    this.cursor += 1;
    trace('history', `redo → cursor ${this.cursor}/${this.stack.length - 1}`);
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
    trace('history', `beginTransaction (depth now ${this.txnDepth})`);
  }

  endTransaction(snapshot: TSnapshot): void {
    if (this.txnDepth === 0) {
      trace('history', 'endTransaction: no active transaction');
      return;
    }
    this.txnDepth -= 1;
    trace('history', `endTransaction (depth now ${this.txnDepth})`);
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
    const truncated = this.cursor < this.stack.length - 1;
    if (truncated) {
      this.stack.length = this.cursor + 1;
    }
    this.stack.push(snapshot);
    this.cursor = this.stack.length - 1;
    let evicted = 0;
    while (this.stack.length > this.capacity) {
      this.stack.shift();
      this.cursor -= 1;
      evicted += 1;
    }
    trace(
      'history',
      `commit → cursor ${this.cursor}/${this.stack.length - 1}${truncated ? ' (truncated redo tail)' : ''}${evicted > 0 ? ` (evicted ${evicted})` : ''}`,
    );
  }
}
