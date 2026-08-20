import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, Store } from '../index.js';
import { Provider, Zone } from './index.js';

describe('<Zone> inside <Zone>', () => {
  it('registers the inner zone under the outer one, not as a root', () => {
    const store = new Store();

    render(
      <Provider store={store}>
        <Zone id={asNodeId('outer')} strategyId="stack" config={{}}>
          <Zone id={asNodeId('inner')} strategyId="stack" config={{}} />
        </Zone>
      </Provider>,
    );

    expect(store.rootIds).toEqual(['outer']);
    expect(store.getContainerView(asNodeId('outer'))?.childOrder).toEqual(['inner']);
    expect(store.getNode(asNodeId('inner'))?.membership?.parentId).toBe('outer');
  });

  it('honors a kind override on both the node and the wrapper class', () => {
    const store = new Store();

    const { container } = render(
      <Provider store={store}>
        <Zone id={asNodeId('outer')} strategyId="stack" config={{}}>
          <Zone id={asNodeId('inner')} strategyId="stack" config={{}} kind="group" />
        </Zone>
      </Provider>,
    );

    expect(store.getNode(asNodeId('inner'))?.kind).toBe('group');
    expect(container.querySelector('[data-node="inner"]')?.className).toContain('windease-group');
  });
});

describe('<Zone pinned>', () => {
  it('holds a slot for a parented zone', () => {
    const store = new Store();

    render(
      <Provider store={store}>
        <Zone id={asNodeId('outer')} strategyId="stack" config={{}}>
          <Zone id={asNodeId('a')} strategyId="stack" config={{}} />
          <Zone id={asNodeId('b')} strategyId="stack" config={{}} kind="group" pinned={0} />
        </Zone>
      </Provider>,
    );

    expect(store.getPinnedIndex(asNodeId('b'))).toBe(0);
    expect(store.getContainerView(asNodeId('outer'))?.childOrder).toEqual(['b', 'a']);
  });

  it('is a no-op on a root zone rather than throwing', () => {
    const store = new Store();

    expect(() =>
      render(
        <Provider store={store}>
          <Zone id={asNodeId('root')} strategyId="stack" config={{}} pinned={0} />
        </Provider>,
      ),
    ).not.toThrow();

    expect(store.getPinnedIndex(asNodeId('root'))).toBeNull();
  });
});
