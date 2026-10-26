import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, Store } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';

afterEach(cleanup);

function Tree({ store, raise }: { store: Store; raise?: 'click' | 'focus' }) {
  return (
    <Provider store={store}>
      <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1, ...(raise ? { raise } : {}) }}>
        <Panel id={asNodeId('a')} />
        <Panel id={asNodeId('b')} />
        <Panel id={asNodeId('c')} />
      </Zone>
    </Provider>
  );
}

describe('<Zone> with config raise', () => {
  it('keeps a raised child on top through the next render', () => {
    const store = new Store();
    const view = render(<Tree store={store} raise="click" />);
    act(() => store.raise(asNodeId('a')));
    view.rerender(<Tree store={store} raise="click" />);
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['b', 'c', 'a']);
  });

  it('still takes its order from JSX when nothing raises', () => {
    const store = new Store();
    const view = render(<Tree store={store} />);
    act(() => store.setChildOrder(asNodeId('z'), ['c', 'b', 'a'].map(asNodeId)));
    view.rerender(<Tree store={store} />);
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b', 'c']);
  });
});
