import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, Store } from '../index.js';
import { Provider, useStore } from './Provider.js';
import { Panel, Zone } from './presets.js';

afterEach(cleanup);

describe('Provider auto-store', () => {
  it('auto-creates a Store when none is provided', () => {
    let captured: Store | null = null;
    function Probe() {
      captured = useStore();
      return null;
    }
    render(
      <Provider>
        <Probe />
      </Provider>,
    );
    expect(captured).not.toBeNull();
    expect(captured).toBeInstanceOf(Store);
  });

  it('uses the provided store when one is passed', () => {
    const store = new Store();
    let captured: Store | null = null;
    function Probe() {
      captured = useStore();
      return null;
    }
    render(
      <Provider store={store}>
        <Probe />
      </Provider>,
    );
    expect(captured).toBe(store);
  });

  it('auto-store works end-to-end with a JSX preset', () => {
    const captured: { store: Store | null } = { store: null };
    function Probe() {
      captured.store = useStore();
      return null;
    }
    render(
      <Provider>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} />
        </Zone>
        <Probe />
      </Provider>,
    );
    expect(captured.store?.getNode(asNodeId('p'))).toBeTruthy();
  });
});
