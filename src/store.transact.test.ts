import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createPanel, createZone, Store } from './index.js';

describe('Store.transact', () => {
  it('emits one begin/end pair around the callback', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => seen.push('begin'));
    store.events.on('transaction.end', () => seen.push('end'));

    store.transact(() => {
      store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));
      store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    });

    expect(seen).toEqual(['begin', 'end']);
  });

  it('emits only for the outermost frame when nested', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => seen.push('begin'));
    store.events.on('transaction.end', () => seen.push('end'));

    store.transact(() => {
      store.transact(() => {
        store.transact(() => {});
      });
    });

    expect(seen).toEqual(['begin', 'end']);
  });

  it('carries the label on both events', () => {
    const store = new Store();
    const begin = vi.fn();
    const end = vi.fn();
    store.events.on('transaction.begin', begin);
    store.events.on('transaction.end', end);

    store.transact(() => {}, 'split');

    expect(begin).toHaveBeenCalledWith({ label: 'split' });
    expect(end).toHaveBeenCalledWith({ label: 'split' });
  });

  it('closes the pair and rethrows when the callback throws', () => {
    const store = new Store();
    const end = vi.fn();
    store.events.on('transaction.end', end);

    expect(() =>
      store.transact(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('does not stick the depth counter after a throw', () => {
    const store = new Store();
    const begin = vi.fn();
    store.events.on('transaction.begin', begin);

    expect(() =>
      store.transact(() => {
        throw new Error('boom');
      }),
    ).toThrow();
    store.transact(() => {});

    expect(begin).toHaveBeenCalledTimes(2);
  });

  it('does not roll back mutations made before a throw', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));

    expect(() =>
      store.transact(() => {
        store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
        throw new Error('boom');
      }),
    ).toThrow();

    expect(store.getNode(asNodeId('a'))).toBeDefined();
  });
});
