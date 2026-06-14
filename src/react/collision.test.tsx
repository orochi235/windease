import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store, asNodeId, createPanel, createZone } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';

afterEach(cleanup);

describe('id collisions between JSX and imperative', () => {
  it('throws when JSX mounts an id already imperatively registered', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: { cols: 1 } }));
    store.registerNode(createPanel({ id: asNodeId('collide'), parentId: asNodeId('z') }));

    // React surfaces the throw via console.error; silence for this test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Provider store={store}>
          <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
            <Panel id={asNodeId('collide')} />
          </Zone>
        </Provider>,
      ),
    ).toThrow(/already registered imperatively/);
    spy.mockRestore();
  });

  it('throws when imperative code registers an id already owned by JSX', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('jsx-owned')} />
        </Zone>
      </Provider>,
    );
    expect(() =>
      store.registerNode(createPanel({ id: asNodeId('jsx-owned'), parentId: asNodeId('z') })),
    ).toThrow(/duplicate|already/i);
  });
});
