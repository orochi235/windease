import { describe, expect, it } from 'vitest';
import { requestClose } from './close.js';
import { createNode } from './constructors.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

const A = asNodeId('a');

function store(): { s: Store; heard: unknown[] } {
  const s = new Store();
  s.registerNode(createNode({ kind: 'window', id: A }));
  const heard: unknown[] = [];
  s.events.on('node.closeRequested', (e) => heard.push(e));
  return { s, heard };
}

describe('requestClose', () => {
  it('emits the request for a visible node and leaves it as it was', () => {
    const { s, heard } = store();
    s.showNode(A);
    expect(requestClose(s, A)).toBe(true);
    expect(heard).toEqual([{ id: 'a', parentId: null }]);
    expect(s.getNode(A)?.lifecycle.state).toBe('visible');
  });

  it('refuses a node that is not showing, or not there', () => {
    const { s, heard } = store();
    expect(requestClose(s, A)).toBe(false);
    expect(requestClose(s, asNodeId('nope'))).toBe(false);
    expect(heard).toEqual([]);
  });

  it('refuses under lock.destroy or lock.hide, and not once locks are suspended', () => {
    const { s, heard } = store();
    s.showNode(A);
    s.setLock(A, { hide: true });
    expect(requestClose(s, A)).toBe(false);
    s.setLock(A, { hide: false, destroy: true });
    expect(requestClose(s, A)).toBe(false);
    expect(s.withLocksSuspended(() => requestClose(s, A))).toBe(true);
    expect(heard).toHaveLength(1);
  });
});
