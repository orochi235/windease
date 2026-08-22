export default { title: 'Grid' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId, createNode, gridStrategy, Store } from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './windease.css';

const STRATEGIES = {
  grid: gridStrategy as never,
};

const ZONE_ID = asNodeId('grid');

interface Args {
  cols: number;
  gap: number;
  padding: number;
  panelCount: number;
}

export const Grid: Story<Args> = ({ cols, gap, padding, panelCount }) => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: { cols, gap, padding } },
        id: ZONE_ID,
      }),
    );
    for (let i = 0; i < panelCount; i++) {
      const id = asNodeId(`panel-${i + 1}`);
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: ZONE_ID,
          meta: { title: `Window ${id}` },
        }),
      );
      s.showNode(id);
    }
    return s;
  }, [cols, gap, padding, panelCount]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className="windease-panel">
          <header className="windease-panel__title">
            {String(node.meta?.title ?? `Window ${node.id}`)}
          </header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 480, height: 360 }}>
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: 480, h: 360 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

Grid.args = {
  cols: 2,
  gap: 8,
  padding: 8,
  panelCount: 4,
};

Grid.argTypes = {
  cols: { control: { type: 'range', min: 1, max: 6, step: 1 } },
  gap: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  padding: { control: { type: 'range', min: 0, max: 32, step: 1 } },
  panelCount: { control: { type: 'range', min: 1, max: 12, step: 1 } },
};

/** Auto-balanced tiling with draggable seams: drag a cell edge, or Tab to a
 *  seam and press an arrow. Extents move a whole cell at a time. */
export const ResizableGrid: Story = () => {
  const store = useMemo(() => {
    const s = new Store();
    const zone = asNodeId('grid-resizable');
    s.registerNode(
      createNode({
        kind: 'zone',
        container: {
          strategyId: 'grid',
          config: { resizable: true, gap: 8, padding: 8 },
        },
        id: zone,
      }),
    );
    for (let i = 0; i < 6; i++) {
      const id = asNodeId(`tile-${i + 1}`);
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: zone,
          meta: { title: `Tile ${i + 1}` },
        }),
      );
      s.showNode(id);
    }
    return s;
  }, []);

  const chrome: ChromeMap = {
    panel: ({ node }) => (
      <div className="windease-panel">
        <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
      </div>
    ),
  };

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 560, height: 400 }}>
          <Container
            parentId={asNodeId('grid-resizable')}
            chrome={chrome}
            viewport={{ w: 560, h: 400 }}
            className="windease-zone"
            affordances
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};
