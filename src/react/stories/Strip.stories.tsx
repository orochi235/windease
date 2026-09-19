export default { title: 'Strip' };

import type { Story } from '@ladle/react';
import { useMemo, useRef, useState } from 'react';
import { asNodeId, createNode, Store, stackStrategy, stripStrategy } from '../../index.js';
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

const JUSTIFY_ZONE = asNodeId('strip-justify');
type Justify = 'start' | 'center' | 'end' | 'between';

function makeJustifyStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'x', gap: 6, padding: 6, fill: true, resizable: false },
      },
      id: JUSTIFY_ZONE,
    }),
  );
  for (const name of ['inbox', 'docs', 'music']) {
    const id = asNodeId(`tab-${name}`);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: JUSTIFY_ZONE,
        hints: { maxSize: { w: 160, h: 0 } },
        meta: { title: name },
      }),
    );
    s.showNode(id);
  }
  return s;
}

/**
 * Three tabs held at a 160px cap leave most of the row empty; `justify` says
 * where that space goes.
 */
export const Justify: Story = () => {
  const store = useMemo(makeJustifyStore, []);
  const [justify, setJustify] = useState<Justify>('start');
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="strip-controls">
          <label>
            justify{' '}
            <select
              value={justify}
              data-testid="justify"
              onChange={(e) => {
                const next = e.target.value as Justify;
                setJustify(next);
                store.updateContainerConfig(JUSTIFY_ZONE, { justify: next });
              }}
            >
              <option value="start">start</option>
              <option value="center">center</option>
              <option value="end">end</option>
              <option value="between">between</option>
            </select>
          </label>
        </div>
        <Container
          parentId={JUSTIFY_ZONE}
          chrome={chrome}
          viewport={{ w: 800, h: 60 }}
          className="windease-zone"
        />
      </StrategyRegistryProvider>
    </Provider>
  );
};

const STEP_ZONE = asNodeId('strip-step');
const CELL = 12;
/** Sixty cells and five pixels over, so the remainder has somewhere to go. */
const STEP_W = 60 * CELL + 5;

function makeStepStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'x', fill: true, resizeMode: 'neighbor', step: CELL },
      },
      id: STEP_ZONE,
    }),
  );
  for (const name of ['shell', 'editor', 'logs']) {
    const id = asNodeId(`step-${name}`);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: STEP_ZONE,
        hints: { minSize: { w: 4 * CELL, h: 0 } },
        meta: { title: name },
      }),
    );
    s.showNode(id);
  }
  return s;
}

const stepChrome: ChromeMap = {
  panel: ({ node }) => {
    const w = (node.membership?.placement?.size as { w?: number } | undefined)?.w;
    return (
      <div className="windease-panel">
        <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        <span className="strip-readout" data-cols={w === undefined ? '' : String(w / CELL)}>
          {w === undefined ? 'fill' : `${w / CELL} cols`}
        </span>
      </div>
    );
  },
};

/**
 * Panes sized in 12px cells, the way tmux sizes in characters. A seam drag
 * lands on whole cells; the last fill pane takes the 5px no cell covers.
 */
export const Steps: Story = () => {
  const store = useMemo(makeStepStore, []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="strip-stage">
          <Container
            parentId={STEP_ZONE}
            chrome={stepChrome}
            viewport={{ w: STEP_W, h: 120 }}
            className="windease-zone"
            affordances
          />
        </div>
        <p className="strip-hint">
          <code>step: {CELL}</code>. Drag a seam and it lands on whole {CELL}px cells; focus one and
          each arrow press moves it a cell. The row is {STEP_W}px, five pixels past sixty cells, and
          the last fill pane carries those five.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const ZOOM_ZONE = asNodeId('strip-zoom');
const ZOOM_PANES = ['shell', 'editor', 'logs'] as const;
const ZOOM_STRATEGIES = { strip: stripStrategy as never, stack: stackStrategy as never };

function makeZoomStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: {
          axis: 'x',
          gap: 6,
          padding: 6,
          fill: true,
          resizeMode: 'neighbor',
          headerSize: 28,
        },
      },
      id: ZOOM_ZONE,
    }),
  );
  for (const name of ZOOM_PANES) {
    const id = asNodeId(`zoom-${name}`);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: ZOOM_ZONE,
        hints: { minSize: { w: 60, h: 0 } },
        meta: { title: name },
      }),
    );
    s.showNode(id);
  }
  return s;
}

/**
 * `zoom` names one child that fills the container while the rest keep their
 * sizes to return to, like tmux's prefix-z. Switch the zone to `stack` and a
 * zoomed child covers the tab band too.
 */
export const Zoom: Story = () => {
  const store = useMemo(makeZoomStore, []);
  const [zoom, setZoom] = useState<string | undefined>(undefined);
  const [strategy, setStrategy] = useState<'strip' | 'stack'>('strip');
  const zoomTo = (id: string | undefined) => {
    setZoom(id);
    store.updateContainerConfig(ZOOM_ZONE, { zoom: id });
  };
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={ZOOM_STRATEGIES}>
        <div className="strip-controls">
          <label>
            strategy{' '}
            <select
              value={strategy}
              data-testid="zoom-strategy"
              onChange={(e) => {
                const next = e.target.value as typeof strategy;
                setStrategy(next);
                store.setStrategy(ZOOM_ZONE, next);
              }}
            >
              <option value="strip">strip</option>
              <option value="stack">stack</option>
            </select>
          </label>
          <fieldset className="strip-zoom">
            <legend>zoom</legend>
            {[undefined, ...ZOOM_PANES.map((n) => `zoom-${n}`)].map((id) => (
              <button
                key={id ?? 'none'}
                type="button"
                aria-pressed={zoom === id}
                data-testid={`zoom-${id ?? 'none'}`}
                onClick={() => zoomTo(id)}
              >
                {id ? id.slice('zoom-'.length) : 'none'}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="strip-stage">
          <Container
            parentId={ZOOM_ZONE}
            chrome={chrome}
            viewport={{ w: 720, h: 160 }}
            className="windease-zone"
            affordances
          />
        </div>
        <p className="strip-hint">
          Drag a seam, zoom a pane, then zoom <b>none</b>: the row comes back at the sizes you left
          it. Under <code>stack</code> the zone reserves a 28px tab band; a zoomed child covers it.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const STICKY_ZONE = asNodeId('strip-sticky');
const PINNED_TABS = ['mail', 'chat'];
const OPEN_TABS = Array.from({ length: 10 }, (_, i) => `page ${i + 1}`);

function makeStickyStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'x', gap: 4, padding: 4, overflowMode: 'scroll', resizable: false },
      },
      id: STICKY_ZONE,
    }),
  );
  const tabs = [
    ...PINNED_TABS.map((name) => ({ name, w: 44, sticky: true })),
    ...OPEN_TABS.map((name) => ({ name, w: 140, sticky: false })),
  ];
  for (const { name, w, sticky } of tabs) {
    const id = asNodeId(`sticky-${name.replace(' ', '-')}`);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id,
        parentId: STICKY_ZONE,
        placement: { size: { w }, ...(sticky ? { sticky: true } : {}) },
        meta: { title: name },
      }),
    );
    s.showNode(id);
  }
  return s;
}

const stickyChrome: ChromeMap = {
  panel: ({ node }) => (
    <div
      className={`windease-panel strip-tab${node.membership?.placement?.sticky ? ' is-sticky' : ''}`}
    >
      {String(node.meta?.title ?? node.id)}
    </div>
  ),
};

/**
 * `placement.sticky` under `overflowMode: 'scroll'`: the two pinned tabs stay
 * at the start of the bar while the rest scroll under them, as in Firefox.
 */
export const StickyTabs: Story = () => {
  const store = useMemo(makeStickyStore, []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div ref={scrollRef} className="strip-scroller" data-testid="sticky-scroller">
          <Container
            parentId={STICKY_ZONE}
            chrome={stickyChrome}
            viewport={{ w: 600, h: 40 }}
            scrollRef={scrollRef}
            className="windease-zone"
          />
        </div>
        <p className="strip-hint">
          Scroll the tab bar sideways. <b>mail</b> and <b>chat</b> set <code>placement.sticky</code>
          , so they hold at the start while the pages slide under them. The strategy never sees the
          scroll; it reports where each sticky tab sticks, and the container holds it there as the
          scroll changes.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};
