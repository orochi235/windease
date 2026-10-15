import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const MAIN = asNodeId('main');
const WT = asNodeId('wt');
const TERM = asNodeId('term');

/** `main` always mounted; `wt` mounted while `showWorktree`, declaring
 *  `own` in its JSX. `term` is registered imperatively into `wt`, the way a
 *  panel dragged in from elsewhere arrives. */
function tree(store: Store, showWorktree: boolean, rehome?: NodeId) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <Zone id={MAIN} strategyId="strip" viewport={{ w: 300, h: 100 }} />
        {showWorktree ? (
          <Zone
            id={WT}
            strategyId="strip"
            viewport={{ w: 300, h: 100 }}
            {...(rehome ? { rehome } : {})}
          >
            <Panel id={asNodeId('own')} />
          </Zone>
        ) : null}
      </StrategyRegistryProvider>
    </Provider>
  );
}

function mountWithDraggedIn(rehome?: NodeId) {
  const store = new Store();
  const utils = render(tree(store, true, rehome));
  store.registerNode(createNode({ kind: 'panel', id: TERM, parentId: WT }));
  store.showNode(TERM);
  return { store, ...utils };
}

describe('<Zone rehome>', () => {
  it('moves a dragged-in child to the target when the zone unmounts', () => {
    const { store, rerender } = mountWithDraggedIn(MAIN);
    rerender(tree(store, false, MAIN));
    expect(store.getNode(WT)).toBeUndefined();
    expect(store.getParent(TERM)?.id).toBe(MAIN);
  });

  it("still destroys the children its own JSX declared, which can't outlive it", () => {
    const { store, rerender } = mountWithDraggedIn(MAIN);
    rerender(tree(store, false, MAIN));
    expect(store.getNode(asNodeId('own'))).toBeUndefined();
  });

  it('destroys every child without the prop, as before', () => {
    const { store, rerender } = mountWithDraggedIn();
    rerender(tree(store, false));
    expect(store.getNode(TERM)).toBeUndefined();
  });

  it('falls back to the cascade, without throwing, when the target is gone too', () => {
    const { store, unmount } = mountWithDraggedIn(MAIN);
    expect(() => unmount()).not.toThrow();
    expect(store.getNode(TERM)).toBeUndefined();
  });
});
