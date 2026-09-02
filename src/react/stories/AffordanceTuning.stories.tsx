export default { title: 'Affordance tuning' };

import type { Story } from '@ladle/react';
import { type CSSProperties, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  type OverlayContext,
  Provider,
  StrategyRegistryProvider,
  useStore,
} from '../index.js';
import '../styles.css';
import './capabilities.css';

const STRATEGIES = { strip: stripStrategy as never };

const ZONE = asNodeId('tuning');
const VIEWPORT = { w: 640, h: 180 };

const PANES: Array<[NodeId, string]> = [
  [asNodeId('left'), 'Left'],
  [asNodeId('middle'), 'Middle'],
  [asNodeId('right'), 'Right'],
];

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: ZONE,
      container: { strategyId: 'strip', config: { axis: 'x', gap: 6, padding: 6, fill: true } },
    }),
  );
  s.showNode(ZONE);
  for (const [id, title] of PANES) {
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: ZONE,
        hints: { minSize: { w: 60, h: 0 } },
        meta: { title },
      }),
    );
    s.showNode(id);
  }
  return s;
}

const chrome: ChromeMap = {
  panel: ({ node }) => (
    <div className="cap-pane">
      <header className="cap-pane__title">{String(node.meta?.title ?? node.id)}</header>
    </div>
  ),
};

function widthOf(store: Store, id: NodeId): string {
  const size = store.getNode(id)?.membership?.placement?.size as { w?: number } | undefined;
  return size?.w === undefined ? '—' : String(Math.round(size.w));
}

/** Committed widths, so an arrow-key step is a number rather than an eyeball. */
function Widths() {
  const store = useStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(
    () => PANES.map(([id]) => `${id}=${widthOf(store, id)}`).join(' '),
    [store],
  );
  const text = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <p className="cap-readout">
      placement.size.w: <span data-testid="widths">{text}</span>
    </p>
  );
}

/**
 * The three knobs on the built-in seam handle. Each one is invisible until you
 * reach for it with the input device it serves — the pad with a pointer, the
 * step with an arrow key, the tab stops with `Tab` — so all three are live
 * here at once.
 */
export const Tuning: Story = () => {
  const store = useMemo(makeStore, []);
  const [hitPad, setHitPad] = useState(4);
  const [keyStep, setKeyStep] = useState(8);
  const [tabStops, setTabStops] = useState(true);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="cap-bar">
          <label>
            affordanceHitPad{' '}
            <input
              type="number"
              min={0}
              max={24}
              value={hitPad}
              data-testid="hit-pad"
              onChange={(e) => setHitPad(Number(e.target.value))}
            />
          </label>
          <label>
            affordanceKeyStep{' '}
            <input
              type="number"
              min={1}
              max={64}
              value={keyStep}
              data-testid="key-step"
              onChange={(e) => setKeyStep(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={tabStops}
              data-testid="tab-stops"
              onChange={(e) => setTabStops(e.target.checked)}
            />{' '}
            affordanceTabStops
          </label>
          <button type="button" data-testid="before-seams">
            tab from here
          </button>
        </div>
        <div className="cap-stage cap-stage--strip">
          <Container
            parentId={ZONE}
            chrome={chrome}
            viewport={VIEWPORT}
            className="windease-zone"
            affordances
            affordanceHitPad={hitPad}
            affordanceKeyStep={keyStep}
            affordanceTabStops={tabStops}
          />
        </div>
        <Widths />
        <p className="cap-hint">
          The pad is the grab slack around the 4px gutter: raise it and the seam catches the pointer
          further out, while the drawn line stays where it was. Focus a seam and <kbd>&rarr;</kbd>{' '}
          moves it by the step; <kbd>Home</kbd> / <kbd>End</kbd> jump to its reported bounds
          regardless. With tab stops off, <kbd>Tab</kbd> from the button above skips the seams
          entirely — the ARIA stays, so a screen reader still finds them.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};

/**
 * `overlay` draws over the children with the layout that just ran. This one
 * labels each placement and names the seam being dragged, which is the readout
 * you want while tuning a strategy.
 */
export const LayoutOverlay: Story = () => {
  const store = useMemo(makeStore, []);
  const overlay = useCallback(
    ({ placements, affordances, draggingAffordanceId, viewport }: OverlayContext) => (
      <>
        {[...placements].map(([id, rect]) => {
          const style: CSSProperties = { left: rect.x + 4, top: rect.y + rect.h - 20 };
          return (
            <span
              key={id}
              className="cap-overlay-tag"
              style={style}
              data-testid={`tag-${id}`}
            >{`${Math.round(rect.w)}×${Math.round(rect.h)}`}</span>
          );
        })}
        <span className="cap-overlay-status" data-testid="overlay-status">
          {viewport ? `${viewport.w}×${viewport.h}` : 'unmeasured'} · {affordances.length} seams ·{' '}
          {draggingAffordanceId ?? 'idle'}
        </span>
      </>
    ),
    [],
  );
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="cap-stage cap-stage--strip">
          <Container
            parentId={ZONE}
            chrome={chrome}
            viewport={VIEWPORT}
            className="windease-zone"
            affordances
            overlay={overlay}
          />
        </div>
        <p className="cap-hint">
          Drag a seam: the sizes update per frame and the status line names the affordance holding
          the pointer. The overlay renders after the children and the affordance layer, so it never
          intercepts the gesture it is reporting on.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};
