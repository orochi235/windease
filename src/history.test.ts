import { describe, expect, it } from 'vitest';
import { HistoryController } from './history.js';

describe('HistoryController', () => {
  it('push then undo returns the prior snapshot; canRedo becomes true', () => {
    const h = new HistoryController<number>();
    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(2);
    expect(h.canRedo()).toBe(true);
    expect(h.undo()).toBe(1);
    expect(h.canUndo()).toBe(false);
    expect(h.undo()).toBeUndefined();
  });

  it('redo replays forward until exhausted', () => {
    const h = new HistoryController<number>();
    h.push(1);
    h.push(2);
    h.push(3);
    h.undo();
    h.undo();
    expect(h.redo()).toBe(2);
    expect(h.redo()).toBe(3);
    expect(h.redo()).toBeUndefined();
  });

  it('push after undo truncates the redo tail', () => {
    const h = new HistoryController<number>();
    h.push(1);
    h.push(2);
    h.push(3);
    h.undo();
    h.push(99);
    expect(h.canRedo()).toBe(false);
    expect(h.current()).toBe(99);
    expect(h.undo()).toBe(2);
  });

  it('capacity caps the stack and evicts oldest', () => {
    const h = new HistoryController<number>({ capacity: 3 });
    h.push(1);
    h.push(2);
    h.push(3);
    h.push(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.canUndo()).toBe(false);
  });

  it('transactions coalesce multiple events into one push', () => {
    const h = new HistoryController<number>();
    h.push(0);
    h.beginTransaction();
    h.endTransaction(5);
    expect(h.current()).toBe(5);
    expect(h.undo()).toBe(0);
    expect(h.canRedo()).toBe(true);
  });

  it('nested transactions only push at the outermost endTransaction', () => {
    const h = new HistoryController<number>();
    h.push(0);
    h.beginTransaction();
    h.beginTransaction();
    h.endTransaction(1);
    expect(h.current()).toBe(0);
    h.endTransaction(2);
    expect(h.current()).toBe(2);
    expect(h.undo()).toBe(0);
  });

  it('clear empties the stack', () => {
    const h = new HistoryController<number>();
    h.push(1);
    h.push(2);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.current()).toBeUndefined();
  });
});
