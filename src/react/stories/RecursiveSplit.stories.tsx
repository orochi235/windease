export default { title: 'Recursive zones' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './windease.css';

const STRATEGIES = {
  strip: stripStrategy as never,
};

/**
 * Builds the same 4-pane tiling the old split layout strategy demo did — an
 * outer horizontal split of `a` and a vertical group, whose second slot is
 * itself a horizontal group of `c`/`d` — but as real nested strip
 * containers via `store.split`, one gutter drag at a time.
 */
function buildTree(): Store {
  const s = new Store();
  const rs = asNodeId('rs');
  const a = asNodeId('a');
  const b = asNodeId('b');
  const c = asNodeId('c');
  const d = asNodeId('d');
  const g1 = asNodeId('g1');
  const g2 = asNodeId('g2');

  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', gap: 6 } },
      id: rs,
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: a,
      parentId: rs,
      meta: { title: 'a' },
    }),
  );
  s.showNode(a);

  s.split(rs, { direction: 'x', newIds: [b] });
  s.setMeta(b, { title: 'b' });

  s.split(b, { direction: 'y', groupId: g1, newIds: [c], config: { gap: 6 } });
  s.setMeta(c, { title: 'c' });

  s.split(c, { direction: 'x', groupId: g2, newIds: [d], config: { gap: 6 } });
  s.setMeta(d, { title: 'd' });

  return s;
}

export const SplitResize: Story = () => {
  const store = useMemo(buildTree, []);

  const chrome: ChromeMap = useMemo(
    () => ({
      group: ({ node }) => (
        <Container
          parentId={node.id}
          chrome={chrome}
          affordances
          style={{ flex: 1, minHeight: 0 }}
        />
      ),
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
          Three nested strip groups, built with <code>store.split</code>. Each gutter resizes its
          own group; sizes persist on <code>membership.placement.size</code>.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};
