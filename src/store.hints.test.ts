import { describe, expect, it, vi } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

const A = asNodeId('a');

function build(): Store {
  const s = new Store();
  s.registerNode(createNode({ kind: 'panel', id: A, hints: { minSize: { w: 10, h: 10 } } }));
  return s;
}

describe('setHints', () => {
  it('patches rather than replaces, so one key does not drop the rest', () => {
    const s = build();
    s.setHints(A, { sizing: { h: 'content' } });
    expect(s.getNode(A)?.hints).toEqual({
      minSize: { w: 10, h: 10 },
      sizing: { h: 'content' },
    });
  });

  it('deletes a key set to undefined', () => {
    const s = build();
    s.setHints(A, { minSize: undefined });
    expect(s.getNode(A)?.hints).toEqual({});
  });

  it('emits only when something changed', () => {
    const s = build();
    const seen = vi.fn();
    s.events.on('node.hintsChanged', seen);
    s.setHints(A, { minSize: { w: 10, h: 10 } });
    expect(seen).not.toHaveBeenCalled();
    s.setHints(A, { minSize: { w: 20, h: 10 } });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('compares by value, so an equal object is not a change', () => {
    // A binding rebuilds `hints` from props on every render; identity would
    // report a change on each one and invalidate the layout forever.
    const s = build();
    const seen = vi.fn();
    s.events.on('node.hintsChanged', seen);
    s.setHints(A, { minSize: { ...{ w: 10, h: 10 } } });
    expect(seen).not.toHaveBeenCalled();
  });

  it('replaces the node record so a snapshot reader sees the change', () => {
    const s = build();
    const before = s.getNode(A);
    s.setHints(A, { sizing: { w: 'content' } });
    expect(s.getNode(A)).not.toBe(before);
  });

  it('survives a snapshot round trip', async () => {
    const { serialize, deserialize } = await import('./snapshot.js');
    const s = build();
    s.setHints(A, { sizing: { h: 'content' } });
    const back = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(back.getNode(A)?.hints).toEqual({
      minSize: { w: 10, h: 10 },
      sizing: { h: 'content' },
    });
  });
});
