export default { title: 'Throttling' };

import type { Story } from '@ladle/react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  type NodeId,
  Store,
  asNodeId,
  createPanel,
  createZone,
  gridStrategy,
  stackStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  Provider,
  StrategyRegistryProvider,
  useChildren,
  useNode,
} from '../index.js';
import './windease.css';
import './throttling.css';

const STRATEGIES = {
  stack: stackStrategy as never,
  grid: gridStrategy as never,
};

const PANEL_CHROME: ChromeMap = {
  panel: ({ node }) => (
    <div className="windease-panel throttling-panel">
      <span className="throttling-panel__title">{String(node.meta?.title ?? node.id)}</span>
    </div>
  ),
};

// ===== Bounce — demonstrates dwell =====
//
// A single panel starts unshown. Clicking "Bounce" fires show → hide →
// show roughly 40ms apart (~80ms total). The point of dwell is an
// *absence* — a suppressed transition that never reaches the published
// view — so this demo logs every truth transition (from `store.events`,
// which is synchronous and never throttled) and then resolves each row
// against the `throttle.published` event: the last unresolved row is the
// state that actually landed, and every row before it was suppressed.
// With dwell on, three truth rows collapse into one publish; with dwellMs
// at 0 every row publishes on its own.

interface BounceArgs {
  throttled: boolean;
  dwellMs: number;
}

type RowStatus = 'pending' | 'published' | 'suppressed';

interface BounceRow {
  truth: string;
  status: RowStatus;
  detail: string;
}

const BOUNCE_ZONE = asNodeId('bounce-zone');
const BOUNCE_PANEL = asNodeId('bounce-panel');

function buildBounceStore(throttled: boolean, dwellMs: number): Store {
  const store = new Store(throttled ? { throttle: { dwell: { lifecycle: dwellMs } } } : {});
  store.registerNode(
    createZone({ id: BOUNCE_ZONE, strategyId: 'stack', config: { gap: 8, padding: 8 } }),
  );
  store.registerNode(
    createPanel({
      id: BOUNCE_PANEL,
      parentId: BOUNCE_ZONE,
      meta: { title: 'Bounced panel' },
      hints: { preferredSize: { w: 0, h: 120 } },
    }),
  );
  store.flushNow();
  return store;
}

/**
 * A publish reveals the node's *current* truth state, so the newest
 * unresolved row is the one that landed and every earlier unresolved row
 * was suppressed. `findLastIndex` is deliberately hand-rolled — the story
 * builds against the same lib target as the library.
 */
function resolveRows(
  rows: readonly BounceRow[],
  event: { heldMs: number; forced: boolean },
): BounceRow[] {
  let landed = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.status === 'pending') {
      landed = i;
      break;
    }
  }
  if (landed === -1) return rows as BounceRow[];

  // Deliberately NOT `event.coalesced` — that counts internal dirty-marks
  // (one `showNode` alone yields 1), so showing it here would misreport
  // the demo. The suppressed count below is derived from the truth log,
  // which is the number this story is actually about.
  const suppressed = rows.filter((r, i) => r.status === 'pending' && i !== landed).length;
  const parts = [`held ${event.heldMs}ms`];
  if (suppressed > 0) parts.push(`${suppressed} suppressed`);
  if (event.forced) parts.push('forced');
  const detail = parts.join(', ');

  return rows.map((row, i) => {
    if (row.status !== 'pending') return row;
    if (i === landed) return { ...row, status: 'published', detail };
    return { ...row, status: 'suppressed', detail: 'never reached the published view' };
  });
}

function BounceDemo({ store, throttled }: { store: Store; throttled: boolean }) {
  const renders = useRef(0);
  renders.current += 1;

  const node = useNode(BOUNCE_PANEL);
  const state = node?.lifecycle.state ?? 'mounted';

  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [rows, setRows] = useState<BounceRow[]>([]);
  const [withheld, setWithheld] = useState(false);
  const [opensIn, setOpensIn] = useState(0);

  // Truth transitions and publish events, both off `store.events` — which
  // is synchronous and never throttled. An un-throttled store emits no
  // throttle events at all, so that arm marks each row published on
  // arrival instead of waiting for a resolution that will never come.
  useEffect(() => {
    const offTruth = store.events.on('node.transitioned', (payload) => {
      if (payload.id !== BOUNCE_PANEL || payload.machine !== 'lifecycle') return;
      setRows((prev) => [
        ...prev,
        throttled
          ? { truth: payload.to, status: 'pending', detail: '' }
          : { truth: payload.to, status: 'published', detail: 'published immediately' },
      ]);
    });
    const offPending = store.events.on('throttle.pending', (payload) => {
      if (payload.id !== BOUNCE_PANEL) return;
      setWithheld(true);
    });
    const offPublished = store.events.on('throttle.published', (payload) => {
      if (payload.id !== BOUNCE_PANEL) return;
      setWithheld(false);
      setRows((prev) => resolveRows(prev, payload));
    });
    return () => {
      offTruth();
      offPending();
      offPublished();
    };
  }, [store, throttled]);

  // The countdown ticker only runs while something is actually withheld —
  // `getPending` is a point read, so the story supplies the repaint.
  useEffect(() => {
    if (!withheld) {
      setOpensIn(0);
      return;
    }
    const handle = setInterval(() => {
      const pending = store.getPending(BOUNCE_PANEL);
      if (!pending) return;
      setOpensIn(Math.max(0, Math.round(pending.eligibleAt - Date.now())));
    }, 16);
    return () => clearInterval(handle);
  }, [withheld, store]);

  // Unmount-only cleanup. This component fully remounts (a fresh `store`)
  // whenever the story's `<Provider key=...>` changes, so there is no
  // "same component, new store" case to guard here — only "component goes
  // away with a bounce still in flight."
  useEffect(() => {
    return () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);

  const bounce = useCallback(() => {
    if (running) return;
    // A completed bounce leaves the panel `visible`, and the lifecycle FSM
    // rejects show-from-visible — so reset before replaying. Checked against
    // *truth* (getNodeTruth), not the published view: the published view can
    // legitimately lag behind while a transition is held, and deciding this
    // off a stale `visible` would throw exactly when throttling is doing its
    // job. That truth/published distinction is the whole subject of this
    // story. This reset is itself a real transition and shows up in the
    // truth log, which is honest.
    if (store.getNodeTruth(BOUNCE_PANEL)?.lifecycle.state === 'visible') {
      store.hideNode(BOUNCE_PANEL);
    }
    setRunning(true);
    store.showNode(BOUNCE_PANEL);
    timers.current.push(
      setTimeout(() => {
        store.hideNode(BOUNCE_PANEL);
        timers.current.push(
          setTimeout(() => {
            store.showNode(BOUNCE_PANEL);
            setRunning(false);
          }, 40),
        );
      }, 40),
    );
  }, [store, running]);

  const clearLog = useCallback(() => {
    setRows([]);
  }, []);

  return (
    <div className="throttling-demo">
      <p className="throttling-caption">
        Click <strong>Bounce</strong>: the panel is shown, hidden, and shown again within ~80ms.
        With dwell at 150ms all three truth transitions collapse into a single publish — only the
        last <code>visible</code> row reaches the published view; the first <code>visible</code> and
        the intermediate <code>hidden</code> are both marked <em>suppressed</em>. The row that did
        land reports how long it was held and how many earlier rows were suppressed. Set{' '}
        <strong>dwellMs</strong> to 0 and click <strong>Bounce</strong> again: now every truth
        transition publishes on its own.
      </p>
      <p className="throttling-caption">
        The two knobs are not the same lever. <strong>dwellMs</strong> at 0 keeps the throttle
        installed — transitions still flow through the publish pipeline, they just have no gate to
        wait behind. Turning <strong>throttled</strong> off builds the store with no{' '}
        <code>throttle</code> option at all, so it is the identity passthrough: published{' '}
        <em>is</em> truth, <code>store.getPending()</code> is always <code>null</code>, and neither{' '}
        <code>throttle.pending</code> nor <code>throttle.published</code> ever fires — which is why
        the withheld banner below never appears in that mode.
      </p>
      <div className="throttling-toolbar">
        <button type="button" onClick={bounce} disabled={running}>
          Bounce (show → hide → show, ~40ms apart)
        </button>
        <button type="button" onClick={clearLog} disabled={running || withheld}>
          Clear log
        </button>
        <span className="throttling-render-count">renders: {renders.current}</span>
      </div>
      <p className={`throttling-state throttling-state--${state}`}>
        Published lifecycle: <strong>{state}</strong>
      </p>
      {withheld ? (
        <p className="throttling-pending">
          Withheld — gate opens in <strong>{opensIn}ms</strong>{' '}
          <span className="throttling-annotation">(store.getPending)</span>
        </p>
      ) : null}
      <table className="throttling-table">
        <thead>
          <tr>
            <th>Truth</th>
            <th>Published</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="throttling-log-empty">
                No transitions recorded yet — click Bounce.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are an append-only log, index is a stable identity for this render's position
              <tr key={i} className={`is-${row.status}`}>
                <td>{row.truth}</td>
                <td>{row.status === 'published' ? row.truth : '—'}</td>
                <td>{row.detail}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="throttling-bounce-viewport" style={{ width: 260, height: 160 }}>
        <Container
          parentId={BOUNCE_ZONE}
          chrome={PANEL_CHROME}
          viewport={{ w: 260, h: 160 }}
          className="windease-zone"
        />
      </div>
    </div>
  );
}

export const Bounce: Story<BounceArgs> = ({ throttled, dwellMs }) => {
  const store = useMemo(() => buildBounceStore(throttled, dwellMs), [throttled, dwellMs]);
  // Provider only picks up its `store` prop on first mount (documented in
  // Provider.tsx) — key the subtree on the same deps as the store's useMemo
  // so a control change actually remounts with the new store instead of
  // silently rendering the old one.
  return (
    <Provider key={`${throttled}:${dwellMs}`} store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <BounceDemo store={store} throttled={throttled} />
      </StrategyRegistryProvider>
    </Provider>
  );
};

Bounce.args = {
  throttled: true,
  dwellMs: 150,
};

Bounce.argTypes = {
  throttled: { control: { type: 'boolean' } },
  dwellMs: { control: { type: 'range', min: 0, max: 400, step: 10 } },
};

// ===== ColdStartFlood — demonstrates stagger + notifyMs =====
//
// One synchronous burst registers (and shows) 24 panels. Structural changes
// bypass dwell, so what gates the reveal is notifyMs coalescing plus the
// stagger wave budget — a small batch reveals them in visible waves, a
// large one reveals them all at once.

interface FloodArgs {
  throttled: boolean;
  notifyMs: number;
  staggerBatch: number;
  staggerMs: number;
}

const FLOOD_ZONE = asNodeId('flood-zone');
const FLOOD_COUNT = 24;
const floodPanelId = (i: number): NodeId => asNodeId(`flood-panel-${i}`);

function buildFloodStore(
  throttled: boolean,
  notifyMs: number,
  staggerBatch: number,
  staggerMs: number,
): Store {
  const store = new Store(
    throttled ? { throttle: { notifyMs, stagger: { batch: staggerBatch, ms: staggerMs } } } : {},
  );
  store.registerNode(
    createZone({ id: FLOOD_ZONE, strategyId: 'grid', config: { cols: 6, gap: 6, padding: 6 } }),
  );
  store.flushNow();
  return store;
}

function FloodDemo({ store }: { store: Store }) {
  const renders = useRef(0);
  renders.current += 1;

  const children = useChildren(FLOOD_ZONE);
  const visibleCount = children.filter((n) => n.lifecycle.state === 'visible').length;

  const flood = useCallback(() => {
    for (let i = 0; i < FLOOD_COUNT; i++) {
      const id = floodPanelId(i);
      if (store.getNodeTruth(id)) continue;
      store.registerNode(createPanel({ id, parentId: FLOOD_ZONE, meta: { title: `#${i}` } }));
      store.showNode(id);
    }
  }, [store]);

  const reset = useCallback(() => {
    for (let i = 0; i < FLOOD_COUNT; i++) {
      const id = floodPanelId(i);
      if (store.getNodeTruth(id)) store.unregisterNode(id);
    }
  }, [store]);

  return (
    <div className="throttling-demo">
      <p className="throttling-caption">
        Click <strong>Register 24 panels</strong>: registration bypasses dwell, so what gates the
        reveal is <strong>notifyMs</strong> coalescing plus the stagger wave budget. Watch{' '}
        <em>published visible</em> — with a small stagger batch it climbs in visible steps instead
        of jumping straight to 24/24.
      </p>
      <div className="throttling-toolbar">
        <button type="button" onClick={flood}>
          Register 24 panels
        </button>
        <button type="button" onClick={reset}>
          Reset
        </button>
        <span className="throttling-annotation">
          published visible: {visibleCount} / {FLOOD_COUNT}
        </span>
        <span className="throttling-render-count">renders: {renders.current}</span>
      </div>
      <div className="throttling-flood-viewport" style={{ width: 480, height: 320 }}>
        <Container
          parentId={FLOOD_ZONE}
          chrome={PANEL_CHROME}
          viewport={{ w: 480, h: 320 }}
          className="windease-zone"
        />
      </div>
    </div>
  );
}

export const ColdStartFlood: Story<FloodArgs> = ({
  throttled,
  notifyMs,
  staggerBatch,
  staggerMs,
}) => {
  const store = useMemo(
    () => buildFloodStore(throttled, notifyMs, staggerBatch, staggerMs),
    [throttled, notifyMs, staggerBatch, staggerMs],
  );
  return (
    <Provider key={`${throttled}:${notifyMs}:${staggerBatch}:${staggerMs}`} store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <FloodDemo store={store} />
      </StrategyRegistryProvider>
    </Provider>
  );
};

ColdStartFlood.args = {
  throttled: true,
  notifyMs: 32,
  staggerBatch: 4,
  staggerMs: 150,
};

ColdStartFlood.argTypes = {
  throttled: { control: { type: 'boolean' } },
  notifyMs: { control: { type: 'range', min: 0, max: 200, step: 8 } },
  staggerBatch: { control: { type: 'range', min: 1, max: 24, step: 1 } },
  staggerMs: { control: { type: 'range', min: 0, max: 400, step: 10 } },
};

// ===== TruthVsPublished — the core invariant =====
//
// A live two-column readout: truth (getNodeTruth) beside published
// (getNode). An interval churns a few panels' visibility; rows where the
// two columns currently disagree are highlighted — that lag is the whole
// point of throttling.

interface TvpArgs {
  throttled: boolean;
  notifyMs: number;
  dwellMs: number;
}

const TVP_ZONE = asNodeId('tvp-zone');
const TVP_PANEL_IDS: NodeId[] = ['tvp-1', 'tvp-2', 'tvp-3', 'tvp-4'].map((s) => asNodeId(s));
const CHURN_INTERVAL_MS = 120;

function buildTvpStore(throttled: boolean, notifyMs: number, dwellMs: number): Store {
  const store = new Store(
    throttled ? { throttle: { notifyMs, dwell: { lifecycle: dwellMs } } } : {},
  );
  store.registerNode(
    createZone({ id: TVP_ZONE, strategyId: 'stack', config: { gap: 6, padding: 6 } }),
  );
  TVP_PANEL_IDS.forEach((id, i) => {
    store.registerNode(createPanel({ id, parentId: TVP_ZONE, meta: { title: id } }));
    if (i % 2 === 0) store.showNode(id);
  });
  store.flushNow();
  return store;
}

/** Referentially-stable-by-value snapshot: `id:truth:published` joined per node. */
function readoutSnapshot(store: Store, ids: readonly NodeId[]): string {
  return ids
    .map((id) => {
      const truth = store.getNodeTruth(id)?.lifecycle.state ?? 'unregistered';
      const published = store.getNode(id)?.lifecycle.state ?? 'unregistered';
      return `${id}:${truth}:${published}`;
    })
    .join('|');
}

function TvpDemo({ store }: { store: Store }) {
  const renders = useRef(0);
  renders.current += 1;

  const [churning, setChurning] = useState(false);
  const churnIndex = useRef(0);

  // Keyed on `store` and cleared on the way out — a leaked interval mutating
  // a store this component no longer owns is exactly the NodeNotFoundError
  // trap called out in the plan.
  useEffect(() => {
    if (!churning) return;
    const handle = setInterval(() => {
      const id = TVP_PANEL_IDS[churnIndex.current % TVP_PANEL_IDS.length];
      churnIndex.current += 1;
      if (id === undefined) return;
      const state = store.getNodeTruth(id)?.lifecycle.state;
      if (state === 'visible') store.hideNode(id);
      else if (state === 'mounted' || state === 'hidden') store.showNode(id);
    }, CHURN_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [churning, store]);

  const snapshot = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => readoutSnapshot(store, TVP_PANEL_IDS),
  );
  const rows = snapshot.split('|').map((entry) => {
    const [id, truth, published] = entry.split(':');
    return { id, truth, published, diverged: truth !== published };
  });

  return (
    <div className="throttling-demo">
      <p className="throttling-caption">
        Click <strong>Start churn</strong>: an interval flips a few panels' truth visibility every
        120ms. Watch for highlighted rows — a highlighted row means truth has already changed but
        the published column hasn't caught up yet; that lag is the whole point of throttling.
      </p>
      <div className="throttling-toolbar">
        <button type="button" onClick={() => setChurning((v) => !v)}>
          {churning ? 'Stop churn' : 'Start churn'}
        </button>
        <span className="throttling-render-count">renders: {renders.current}</span>
      </div>
      <table className="throttling-table">
        <thead>
          <tr>
            <th>Node</th>
            <th>Truth</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.diverged ? 'is-diverged' : undefined}>
              <td>{r.id}</td>
              <td>{r.truth}</td>
              <td>{r.published}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="throttling-tvp-viewport" style={{ width: 220, height: 220 }}>
        <Container
          parentId={TVP_ZONE}
          chrome={PANEL_CHROME}
          viewport={{ w: 220, h: 220 }}
          className="windease-zone"
        />
      </div>
    </div>
  );
}

export const TruthVsPublished: Story<TvpArgs> = ({ throttled, notifyMs, dwellMs }) => {
  const store = useMemo(
    () => buildTvpStore(throttled, notifyMs, dwellMs),
    [throttled, notifyMs, dwellMs],
  );
  return (
    <Provider key={`${throttled}:${notifyMs}:${dwellMs}`} store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <TvpDemo store={store} />
      </StrategyRegistryProvider>
    </Provider>
  );
};

TruthVsPublished.args = {
  throttled: true,
  notifyMs: 32,
  dwellMs: 150,
};

TruthVsPublished.argTypes = {
  throttled: { control: { type: 'boolean' } },
  notifyMs: { control: { type: 'range', min: 0, max: 200, step: 8 } },
  dwellMs: { control: { type: 'range', min: 0, max: 400, step: 10 } },
};
