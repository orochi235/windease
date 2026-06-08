export default { title: 'Recursive zones / Split (resize)' };

import {
  asNodeId,
  createPanel,
  createZone,
  splitStrategy,
  type SplitNode,
  Store,
} from '../../index.js';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  type ChromeMap,
  Container,
  StrategyRegistryProvider,
  Provider,
} from '../index.js';
import './windease.css';

const STRATEGIES = {
  split: splitStrategy as never,
};

// Three nested splits — exercises every gutter direction.
const TREE: SplitNode = {
  kind: 'split',
  direction: 'horizontal',
  ratio: 0.55,
  a: { kind: 'leaf', id: 'a' },
  b: {
    kind: 'split',
    direction: 'vertical',
    ratio: 0.5,
    a: { kind: 'leaf', id: 'b' },
    b: {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'c' },
      b: { kind: 'leaf', id: 'd' },
    },
  },
};

export const RecursiveSplit: Story = () => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createZone({
        id: asNodeId('rs'),
        strategyId: 'split',
        config: { gutterSize: 6 },
      }),
    );
    for (const id of ['a', 'b', 'c', 'd'] as const) {
      const nid = asNodeId(id);
      s.registerNode(createPanel({ id: nid, parentId: asNodeId('rs'), meta: { title: id } }));
      s.showNode(nid);
    }
    s.setContainerState(asNodeId('rs'), TREE);
    return s;
  }, []);

  const chrome: ChromeMap = useMemo(
    () => ({
      zone: ({ children }) => <>{children}</>,
      panel: ({ node }) => (
        <div className="windease-panel">
          <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <Container
          parentId={asNodeId('rs')}
          chrome={chrome}
          viewport={{ w: 720, h: 440 }}
          className="windease-zone"
          affordances
        />
        <p style={{ marginTop: 12, font: '12px/1.4 system-ui, sans-serif', color: '#64748b' }}>
          Three nested splits. Each gutter resizes independently. State persists on{' '}
          <code>node.container.state</code>.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};
