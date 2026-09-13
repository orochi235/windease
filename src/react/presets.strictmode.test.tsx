import { cleanup, render } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, Store, stripStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

function renderStrict(store: Store, children: ReactNode) {
  return render(
    <StrictMode>
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          {children}
        </StrategyRegistryProvider>
      </Provider>
    </StrictMode>,
  );
}

describe('presets under StrictMode', () => {
  it('restores a zone and its panels, each once and in order, after the replay', () => {
    const store = new Store();
    const zone = asNodeId('z');
    expect(() =>
      renderStrict(
        store,
        <Zone id={zone} strategyId="strip" config={{ axis: 'x' }} viewport={{ w: 600, h: 400 }}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('b')} />
          <Panel id={asNodeId('c')} />
        </Zone>,
      ),
    ).not.toThrow();
    expect(store.getNode(zone)).toBeTruthy();
    for (const id of ['a', 'b', 'c']) {
      expect(store.getNode(asNodeId(id))?.membership?.parentId).toBe(zone);
    }
    expect(store.getContainerView(zone)?.childOrder).toEqual(['a', 'b', 'c']);
  });

  it('restores a nested container before the panel inside it', () => {
    const store = new Store();
    renderStrict(
      store,
      <Zone id={asNodeId('outer')} strategyId="strip" config={{ axis: 'x' }}>
        <Zone id={asNodeId('mid')} strategyId="strip" config={{ axis: 'y' }} kind="group">
          <Panel id={asNodeId('inner')} />
        </Zone>
        <Panel id={asNodeId('side')} />
      </Zone>,
    );
    expect(store.getContainerView(asNodeId('outer'))?.childOrder).toEqual(['mid', 'side']);
    expect(store.getContainerView(asNodeId('mid'))?.childOrder).toEqual(['inner']);
  });
});
