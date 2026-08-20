import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, Store } from './index.js';

describe('Store.transact', () => {
  it('emits one begin/end pair around the callback', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => seen.push('begin'));
    store.events.on('transaction.end', () => seen.push('end'));

    store.transact(() => {
      store.registerNode(
        createNode({
          kind: 'zone',
          container: { strategyId: 'strip', config: {} },
          id: asNodeId('z'),
        }),
      );
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: asNodeId('a'),
          parentId: asNodeId('z'),
        }),
      );
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
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: asNodeId('z'),
      }),
    );

    expect(() =>
      store.transact(() => {
        store.registerNode(
          createNode({
            kind: 'panel',
            focus: true,
            id: asNodeId('a'),
            parentId: asNodeId('z'),
          }),
        );
        throw new Error('boom');
      }),
    ).toThrow();

    expect(store.getNode(asNodeId('a'))).toBeDefined();
  });

  it('re-entrancy: nested throw still closes with one begin/end pair', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => seen.push('begin'));
    store.events.on('transaction.end', () => seen.push('end'));

    expect(() =>
      store.transact(() => {
        store.transact(() => {
          throw new Error('inner');
        });
      }),
    ).toThrow('inner');

    expect(seen).toEqual(['begin', 'end']);
  });

  it('re-entrancy: calling transact from begin listener still emits one pair', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => {
      seen.push('begin');
      store.transact(() => {});
    });
    store.events.on('transaction.end', () => seen.push('end'));

    store.transact(() => {});

    expect(seen).toEqual(['begin', 'end']);
  });

  it('N mutations inside transact produce one subscriber notification', async () => {
    const store = new Store();
    let notificationCount = 0;
    store.subscribe(() => {
      notificationCount += 1;
    });

    store.transact(() => {
      store.registerNode(
        createNode({
          kind: 'zone',
          container: { strategyId: 'strip', config: {} },
          id: asNodeId('z1'),
        }),
      );
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: asNodeId('a1'),
          parentId: asNodeId('z1'),
        }),
      );
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id: asNodeId('b1'),
          parentId: asNodeId('z1'),
        }),
      );
    });

    await Promise.resolve();

    expect(notificationCount).toBe(1);
  });
});
