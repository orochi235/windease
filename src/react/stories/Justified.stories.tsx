export default { title: 'Justified' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, justifiedStrategy, Store } from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './justified.css';
import './windease.css';

const STRATEGIES = { justified: justifiedStrategy as never };
const ZONE_ID = asNodeId('photos');
const GAP = 6;

/** Width ÷ height of each photo: landscapes, portraits, squares and a few panoramas. */
const ASPECTS = [
  1.5, 0.67, 1.33, 1, 4.2, 0.75, 1.78, 1.5, 0.8, 1.5, 2.35, 0.67, 1, 1.33, 0.56, 1.5, 6, 1.25, 0.75,
  1.78, 1.5, 0.67, 1, 3.5, 1.33, 0.8, 1.5, 0.67, 1.78, 1, 2.4, 0.75, 1.5, 1.33, 0.56, 5, 1.5, 1,
  0.67, 1.78,
];

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: ZONE_ID,
      container: { strategyId: 'justified', config: { rowHeight: 160, gap: GAP } },
    }),
  );
  ASPECTS.forEach((aspect, i) => {
    const id = asNodeId(`photo-${i + 1}`);
    s.registerNode(
      createNode({
        kind: 'panel',
        id,
        parentId: ZONE_ID,
        hints: { aspect },
        meta: { title: `photo ${i + 1}` },
      }),
    );
    s.showNode(id);
  });
  return s;
}

const chrome: ChromeMap = {
  panel: ({ node }) => {
    const index = Number(node.id.slice('photo-'.length)) - 1;
    const aspect = node.hints?.aspect ?? 1;
    return (
      <div
        className={`justified-photo justified-photo--${index % 6}`}
        data-testid="justified-photo"
        data-aspect={aspect}
      >
        {aspect.toFixed(2)}
      </div>
    );
  },
};

/**
 * Forty photos of mixed shape laid out in justified rows. Every row but the
 * last fills the width; drag the sliders to watch the row breaks move.
 */
export const Photos: Story = () => {
  const store = useMemo(makeStore, []);
  const [width, setWidth] = useState(900);
  const [rowHeight, setRowHeight] = useState(160);
  const [justifyLast, setJustifyLast] = useState(false);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="justified-controls">
          <label>
            Width{' '}
            <input
              type="range"
              min={240}
              max={1400}
              step={10}
              value={width}
              aria-label="Width"
              data-testid="justified-width"
              onChange={(e) => setWidth(Number(e.target.value))}
            />{' '}
            <output>{width}</output>
          </label>
          <label>
            Row height{' '}
            <input
              type="range"
              min={60}
              max={320}
              step={10}
              value={rowHeight}
              aria-label="Row height"
              data-testid="justified-row-height"
              onChange={(e) => {
                const next = Number(e.target.value);
                setRowHeight(next);
                store.updateContainerConfig(ZONE_ID, { rowHeight: next });
              }}
            />{' '}
            <output>{rowHeight}</output>
          </label>
          <label>
            <input
              type="checkbox"
              checked={justifyLast}
              data-testid="justified-last"
              onChange={(e) => {
                setJustifyLast(e.target.checked);
                store.updateContainerConfig(ZONE_ID, { justifyLast: e.target.checked });
              }}
            />{' '}
            Justify last row
          </label>
        </div>
        <Container
          parentId={ZONE_ID}
          chrome={chrome}
          viewport={{ w: width, h: 480 }}
          className="windease-zone windease-zone--unclipped justified-zone"
        />
      </StrategyRegistryProvider>
    </Provider>
  );
};
