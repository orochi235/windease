export default { title: 'Recursive split (resize)' };

import {
  asNodeId,
  createPanel,
  createZone,
  recursiveSplit,
  type SplitNode,
  WindeaseStore,
} from '../../index.js';
import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  type ChromeMap,
  Container,
  StrategyRegistryProvider,
  WindeaseProvider,
} from '../index.js';
import './windease.css';
import { colorClassForId } from './Panel.js';

const STRATEGIES = {
  recursiveSplit: recursiveSplit as never,
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
    const s = new WindeaseStore();
    s.registerNode(
      createZone({
        id: asNodeId('rs'),
        strategyId: 'recursiveSplit',
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
      group: ({ node, children }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>{children}</div>
      ),
      panel: ({ node }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>
          <span className="story-panel__title">{String(node.meta?.title ?? node.id)}</span>
        </div>
      ),
    }),
    [],
  );

  return (
    <WindeaseProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 720, height: 440, background: '#0f172a08', borderRadius: 8 }}>
          <Container
            parentId={asNodeId('rs')}
            chrome={chrome}
            viewport={{ w: 720, h: 440 }}
            className="windease-zone"
            affordances
          />
        </div>
        <p style={{ marginTop: 12, font: '12px/1.4 system-ui, sans-serif', color: '#64748b' }}>
          Three nested splits. Each gutter resizes independently. State survives snapshot/hydrate
          via <code>node.container.state</code>.
        </p>
      </StrategyRegistryProvider>
    </WindeaseProvider>
  );
};
