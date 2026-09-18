export default { title: 'Strip' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './windease.css';
import './strip.css';

const STRATEGIES = {
  strip: stripStrategy as never,
};

function makeStripStore(axis: 'x' | 'y', sizes: number[]): Store {
  const s = new Store();
  const zoneId = asNodeId(`strip-${axis}`);
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis, gap: 6, padding: 6 } },
      id: zoneId,
    }),
  );
  sizes.forEach((size, i) => {
    const id = asNodeId(`tool-${axis}-${i + 1}`);
    const preferredSize = axis === 'x' ? { w: size, h: 0 } : { w: 0, h: size };
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: zoneId,
        hints: { preferredSize },
        meta: {
          title: axis === 'x' ? `x (w=${size})` : `y (h=${size})`,
        },
      }),
    );
    s.showNode(id);
  });
  return s;
}

const chrome: ChromeMap = {
  panel: ({ node }) => (
    <div className="windease-panel">
      <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
    </div>
  ),
};

export const HorizontalStrip: Story = () => {
  const store = useMemo(() => makeStripStore('x', [80, 120, 160, 100]), []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 600, height: 100 }}>
          <Container
            parentId={asNodeId('strip-x')}
            chrome={chrome}
            viewport={{ w: 600, h: 100 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

export const VerticalStrip: Story = () => {
  const store = useMemo(() => makeStripStore('y', [60, 90, 60, 120]), []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div style={{ width: 220, height: 420 }}>
          <Container
            parentId={asNodeId('strip-y')}
            chrome={chrome}
            viewport={{ w: 220, h: 420 }}
            className="windease-zone"
          />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const SHARES_ZONE = asNodeId('strip-shares');
const SHARES = [
  ['nav', 0.2],
  ['editor', 0.5],
  ['inspector', 0.3],
] as const;

function makeSharesStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', gap: 6, padding: 6 } },
      id: SHARES_ZONE,
    }),
  );
  for (const [name, share] of SHARES) {
    const id = asNodeId(name);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: SHARES_ZONE,
        hints: { minSize: { w: 40, h: 0 } },
        placement: { share },
        meta: { title: name },
      }),
    );
    s.showNode(id);
  }
  return s;
}

const sharesChrome: ChromeMap = {
  panel: ({ node }) => {
    const share = node.membership?.placement?.share;
    return (
      <div className="windease-panel">
        <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        <span className="strip-readout" data-share={String(share ?? '')}>
          share {typeof share === 'number' ? share.toFixed(3) : 'none'}
        </span>
      </div>
    );
  },
};

/**
 * Panes sized by `placement.share`: drag a seam, then change the width. The
 * drag writes shares back, so the row keeps its proportions at any width.
 */
export const Shares: Story = () => {
  const store = useMemo(makeSharesStore, []);
  const [width, setWidth] = useState(720);
  const [mode, setMode] = useState<'redistribute' | 'neighbor'>('redistribute');
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="strip-controls">
          <label>
            width{' '}
            <input
              type="range"
              min={240}
              max={1200}
              value={width}
              data-testid="share-width"
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </label>
          <label>
            resizeMode{' '}
            <select
              value={mode}
              data-testid="share-mode"
              onChange={(e) => {
                const next = e.target.value as typeof mode;
                setMode(next);
                store.updateContainerConfig(SHARES_ZONE, { resizeMode: next });
              }}
            >
              <option value="redistribute">redistribute</option>
              <option value="neighbor">neighbor</option>
            </select>
          </label>
          <span className="strip-readout">{width}px</span>
        </div>
        <div className="strip-stage">
          <Container
            parentId={SHARES_ZONE}
            chrome={sharesChrome}
            viewport={{ w: width, h: 120 }}
            className="windease-zone"
            affordances
          />
        </div>
        <p className="strip-hint">
          Each pane stores a fraction of the row rather than pixels. Drag a seam and the panes it
          resizes store new shares; move the width slider and every pane keeps its proportion.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};
