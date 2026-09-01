export default { title: 'Scrolling' };

import type { Story } from '@ladle/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { asNodeId, createNode, gridStrategy, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  defaultDragOverlay,
  type EdgeScrollOptions,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
import '../styles.css';
import './capabilities.css';

const STRATEGIES = { strip: stripStrategy as never, grid: gridStrategy as never };
const DOCK = asNodeId('dock');
const GRID = asNodeId('grid');

/** Eight panes with a 90px floor in a 360px box: the dock has to overflow. */
function makeDock(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: DOCK,
      container: {
        strategyId: 'strip',
        config: { axis: 'y', fill: true, gap: 8, padding: 8, overflowMode: 'scroll' },
      },
    }),
  );
  s.showNode(DOCK);
  for (let i = 1; i <= 8; i++) {
    const nid = asNodeId(`pane-${i}`);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: nid,
        parentId: DOCK,
        hints: { minSize: { w: 0, h: 90 } },
        meta: { title: `Pane ${i}` },
      }),
    );
    s.showNode(nid);
  }
  return s;
}

function paneChrome(draggable: boolean): ChromeMap {
  return {
    panel: ({ node }) => {
      const body = (
        <>
          <header className="cap-pane__title">
            {String(node.meta?.title ?? node.id)}
            {draggable ? (
              <span className="cap-grip" aria-hidden="true">
                ⋮⋮
              </span>
            ) : null}
          </header>
          <div className="cap-pane__body">{String(node.id)}</div>
        </>
      );
      return draggable ? (
        <DragHandle nodeId={node.id} className="cap-pane">
          {body}
        </DragHandle>
      ) : (
        <div className="cap-pane">{body}</div>
      );
    },
  };
}

/**
 * The seam: without `scrollRef` the reported position of a pane is where the
 * strategy put it, not where it is, and arrowing through a scrolled dock walks
 * positions the panes have left.
 */
export const ScrollAwareNavigation: Story = () => {
  const store = useMemo(() => makeDock(), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [wired, setWired] = useState(true);
  const [offset, setOffset] = useState(0);
  const chrome = useMemo(() => paneChrome(false), []);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <FocusProvider>
            <div className="cap-bar">
              <label>
                <input
                  type="checkbox"
                  checked={wired}
                  data-testid="scroll-toggle"
                  onChange={(e) => setWired(e.target.checked)}
                />{' '}
                report the offset (<code>scrollRef</code>)
              </label>
              <span>scrollTop: {Math.round(offset)}</span>
            </div>
            <div
              className="cap-scroller"
              ref={scrollRef}
              onScroll={(e) => setOffset(e.currentTarget.scrollTop)}
            >
              <Container
                parentId={DOCK}
                chrome={chrome}
                viewport={{ w: 284, h: 344 }}
                className="windease-zone"
                {...(wired ? { scrollRef } : {})}
              />
            </div>
            <p className="cap-hint">
              The dock is <code>overflowMode: 'scroll'</code>, so its box is sized to{' '}
              <code>viewport + overflow</code> and the wrapper above scrolls it. Scroll to the
              bottom, click a pane, then arrow around. With the offset reported, navigation follows
              what you can see. Untick and do it again: placements are unscrolled, so the resolver
              compares positions the panes vacated and the caret lands somewhere else.
            </p>
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

/** Named `edgeScroll` ramps. Module-level so the identity is stable: the prop
 *  is a drop-target registration dependency, and a fresh object each render
 *  would re-register the target on every one. */
const RAMPS: Record<string, EdgeScrollOptions | undefined> = {
  default: undefined,
  eager: { margin: 200, maxRate: 24 },
  off: { maxRate: 0 },
};
const RAMP_NAMES = ['default', 'eager', 'off'] as const;

/** Same dock, drag enabled: the pointer never has to leave the box. */
export const DragToTheEdgeToScroll: Story = () => {
  const store = useMemo(() => makeDock(), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chrome = useMemo(() => paneChrome(true), []);
  const [ramp, setRamp] = useState<(typeof RAMP_NAMES)[number]>('default');
  const edgeScroll = RAMPS[ramp];

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <DragProvider dragOverlay={defaultDragOverlay}>
            <div className="cap-bar">
              {RAMP_NAMES.map((name) => (
                <label key={name}>
                  <input
                    type="radio"
                    name="edge-scroll-ramp"
                    checked={ramp === name}
                    data-testid={`ramp-${name}`}
                    onChange={() => setRamp(name)}
                  />{' '}
                  <code>{name}</code>
                </label>
              ))}
            </div>
            <div className="cap-scroller" ref={scrollRef}>
              <Container
                parentId={DOCK}
                chrome={chrome}
                viewport={{ w: 284, h: 344 }}
                className="windease-zone"
                scrollRef={scrollRef}
                {...(edgeScroll ? { edgeScroll } : {})}
              />
            </div>
            <p className="cap-hint">
              Pick up a pane by its grip and hold the cursor near the top or bottom edge — the dock
              scrolls, and keeps scrolling while you hold there rather than moving one step per
              pointer event. The same <code>scrollRef</code> drives it; a container without one
              never auto-scrolls.
            </p>
            <p className="cap-hint">
              <code>edgeScroll</code> is the ramp's shape. <code>default</code> passes nothing, so
              the rate climbs from zero 48px out to 16px per sample at the edge and holds there past
              it — overshooting a target does not fight you. <code>eager</code> is{' '}
              <code>{'{ margin: 200, maxRate: 24 }'}</code>: the margin swallows most of the box, so
              a cursor held well short of the edge already scrolls, and faster. <code>off</code> is{' '}
              <code>{'{ maxRate: 0 }'}</code>: hold anywhere inside the box and nothing moves.
            </p>
          </DragProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const MODES = ['squeeze', 'scroll', 'unplace'] as const;

function makeGrid(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: GRID,
      container: { strategyId: 'grid', config: { cols: 2, gap: 8, padding: 8 } },
    }),
  );
  s.showNode(GRID);
  for (let i = 1; i <= 8; i++) {
    const nid = asNodeId(`cell-${i}`);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: nid,
        parentId: GRID,
        hints: { minSize: { w: 0, h: 110 } },
        meta: { title: `Cell ${i}` },
      }),
    );
    s.showNode(nid);
  }
  return s;
}

/** A grid derives its cells from the container, so it only overflows once an
 *  item states a floor — which is what makes the three modes differ here. */
export const GridOverflowModes: Story = () => {
  const store = useMemo(() => makeGrid(), []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<(typeof MODES)[number]>('squeeze');
  const chrome = useMemo(() => paneChrome(false), []);

  useEffect(() => {
    store.updateContainerConfig(GRID, { overflowMode: mode });
  }, [store, mode]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <div className="cap-bar">
            {MODES.map((m) => (
              <label key={m}>
                <input
                  type="radio"
                  name="grid-overflow"
                  checked={mode === m}
                  data-testid={`mode-${m}`}
                  onChange={() => setMode(m)}
                />{' '}
                <code>{m}</code>
              </label>
            ))}
          </div>
          <div className="cap-scroller cap-scroller--wide" ref={scrollRef}>
            <Container
              parentId={GRID}
              chrome={chrome}
              viewport={{ w: 444, h: 284 }}
              className="windease-zone"
              scrollRef={scrollRef}
            />
          </div>
          <p className="cap-hint">
            Eight cells with a 110px floor in a 284px box. <code>squeeze</code> ignores the floors
            and divides the space anyway — four rows of 65px. <code>scroll</code> holds every cell
            at 110px and reports the excess, so the box grows and the wrapper scrolls.{' '}
            <code>unplace</code> keeps the rows that fit and sends the rest to <code>unplaced</code>
            , which is why cells disappear rather than shrink.
          </p>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
