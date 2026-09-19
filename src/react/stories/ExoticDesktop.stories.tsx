export default { title: 'Exotic / Desktop' };

import type { Story } from '@ladle/react';
import { type ReactNode, useMemo, useRef } from 'react';
import { asNodeId, type Node, type NodeId, type Store } from '../../index.js';
import { OVERLAP_STRATEGIES, PRESETS } from '../../test-utils/exotic/overlap-scenarios.js';
import { type Preset, presetToStore } from '../../test-utils/exotic/preset.js';
import {
  type ChromeMap,
  Container,
  Provider,
  StrategyRegistryProvider,
  useChildren,
  useNode,
  useStack,
  useStore,
} from '../index.js';
import '../styles.css';
import './exotic-desktop.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetCode } from './presetCode.js';

const TORN_OUT_SIZE = { w: 240, h: 260 };

const placementOf = (node: Node | undefined) => node?.membership?.placement ?? {};
const parentOf = (store: Store, node: Node) =>
  node.membership ? store.getNode(node.membership.parentId) : undefined;
const titleOf = (node: Node) => String(node.meta?.title ?? node.id);

/** Draws a window's title bar and minimize glyph; dragging, raising and minimizing are the desktop's config. */
function DesktopWindow({ node }: { node: Node }) {
  const store = useStore();
  const minimized = placementOf(node).minimized === true;
  const config = parentOf(store, node)?.container?.config as
    | { minimize?: string; minimizable?: boolean }
    | undefined;
  if (minimized && config?.minimize === 'icon') {
    return <div className="xd-icon xd-icon--window">{titleOf(node)}</div>;
  }
  return (
    <div className="xd-window">
      <header className="xd-window__bar" data-testid={`bar-${node.id}`}>
        <span className="xd-window__title">{titleOf(node)}</span>
        {config?.minimizable ? (
          <span className="xd-window__glyph" aria-hidden="true">
            {minimized ? '▢' : '–'}
          </span>
        ) : null}
      </header>
      <div className="xd-window__body">{String(node.id)}</div>
    </div>
  );
}

/** The first stack under `rootId`, where a floating tab docks back to. */
function firstStack(store: Store, rootId: NodeId): NodeId | null {
  const walk = (id: NodeId): NodeId | null => {
    const n = store.getNode(id);
    if (n?.container?.strategyId === 'stack') return id;
    for (const c of n?.container?.childOrder ?? []) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(rootId);
}

function TabStrip({ node, rootId }: { node: Node; rootId: NodeId }) {
  const store = useStore();
  const { tabs, activeId, activate } = useStack(node.id);
  const header = (node.container?.config as { headerSize?: number } | undefined)?.headerSize ?? 0;
  const canFloat = store.getNode(rootId)?.container?.strategyId.startsWith('floating') === true;

  // The one remaining behavior callback, with dock() below: tearing out waits on config `tear` (phase 2).
  const tearOut = (id: NodeId) =>
    store.transact(() => {
      store.moveNode(id, rootId);
      store.patchPlacement(id, { floating: true });
      store.setHints(id, { preferredSize: TORN_OUT_SIZE });
    }, 'tear out');

  return (
    <div className={`xd-tabs ${header >= 30 ? 'xd-tabs--tall' : 'xd-tabs--short'}`} role="tablist">
      {tabs.map((tab) => (
        <div key={tab.id} className="xd-tab" role="presentation">
          <button
            type="button"
            role="tab"
            className="xd-tab__label"
            data-testid={`tab-${tab.id}`}
            aria-selected={tab.id === activeId}
            tabIndex={tab.id === activeId ? 0 : -1}
            onClick={() => activate(tab.id)}
          >
            {tab.title}
          </button>
          {canFloat ? (
            <button
              type="button"
              className="xd-tab__action"
              data-testid={`float-${tab.id}`}
              aria-label={`Float ${tab.title}`}
              onClick={() => tearOut(tab.id)}
            >
              ⇱
            </button>
          ) : (
            <button
              type="button"
              className="xd-tab__action"
              data-testid={`close-${tab.id}`}
              aria-label={`Close ${tab.title}`}
              onClick={() => store.unregisterNode(tab.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FloatingTab({ node, rootId }: { node: Node; rootId: NodeId }) {
  const store = useStore();
  const dock = () => {
    const target = firstStack(store, rootId);
    if (!target) return;
    store.transact(() => {
      store.patchPlacement(node.id, { floating: false });
      store.moveNode(node.id, target);
      store.setActiveChild(target, node.id);
    }, 'dock');
  };
  return (
    <div className="xd-palette">
      <header className="xd-palette__bar">{titleOf(node)}</header>
      <div className="xd-palette__body">
        <button
          type="button"
          className="xd-palette__button"
          data-testid={`dock-${node.id}`}
          onClick={dock}
        >
          Dock
        </button>
      </div>
    </div>
  );
}

function makeChrome(rootId: NodeId): ChromeMap {
  const chrome: ChromeMap = {
    window: ({ node }) => <DesktopWindow node={node} />,
    icon: ({ node }) => (
      <div className="xd-icon" data-testid={`icon-${node.id}`}>
        {titleOf(node)}
      </div>
    ),
    palette: ({ node }) => (
      <div className="xd-palette">
        <header className="xd-palette__bar">{titleOf(node)}</header>
        <div className="xd-palette__body">{String(node.id)}</div>
      </div>
    ),
    tab: ({ node }) =>
      placementOf(node).floating === true ? (
        <FloatingTab node={node} rootId={rootId} />
      ) : (
        <div className="xd-page" data-testid={`page-${node.id}`}>
          {titleOf(node)}
        </div>
      ),
    tabs: ({ node }) => (
      <div className="xd-stack" data-testid={`stack-${node.id}`}>
        <TabStrip node={node} rootId={rootId} />
        <Container parentId={node.id} chrome={chrome} className="windease-zone" settleMs={0} />
      </div>
    ),
    dock: ({ node }) => (
      <Container
        parentId={node.id}
        chrome={chrome}
        className="windease-zone xd-dock"
        settleMs={0}
      />
    ),
    canvas: ({ node }) => <div className="xd-canvas">{titleOf(node)}</div>,
    'snap-zone': ({ node }) => <div className="xd-snap-zone">{titleOf(node)}</div>,
  };
  return chrome;
}

function Readout({ rootId }: { rootId: NodeId }) {
  const children = useChildren(rootId);
  const root = useNode(rootId);
  const floating = children.filter((c) => placementOf(c).floating === true).map((c) => c.id);
  return (
    <dl className="xd-readout">
      <dt>Top window</dt>
      <dd data-testid="xd-top">{String(root?.container?.childOrder.at(-1) ?? '')}</dd>
      <dt>Floating</dt>
      <dd data-testid="xd-floating">{floating.join(' ')}</dd>
    </dl>
  );
}

/** A stack at the root has no parent chrome to draw its tab strip, so draw it here. */
function RootFrame({ rootId, children }: { rootId: NodeId; children: ReactNode }) {
  const root = useNode(rootId);
  if (root?.container?.strategyId !== 'stack') return <>{children}</>;
  return (
    <div className="xd-stack" data-testid={`stack-${rootId}`}>
      <TabStrip node={root} rootId={rootId} />
      {children}
    </div>
  );
}

function PresetView({ preset }: { preset: Preset }) {
  const store = useMemo(() => presetToStore(preset), [preset]);
  const rootId = asNodeId(preset.mechanics.id);
  const chrome = useMemo(() => makeChrome(rootId), [rootId]);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const clip = preset.mechanics.config?.overflow === 'clip';
  return (
    <Provider store={store}>
      <div
        ref={frameRef}
        className={`xd-frame${clip ? ' xd-frame--clip' : ''}`}
        data-testid="xd-frame"
      >
        <RootFrame rootId={rootId}>
          <Container
            parentId={rootId}
            scrollRef={frameRef}
            chrome={chrome}
            viewport={preset.viewport}
            affordances={true}
            settleMs={0}
            className="windease-zone xd-root"
          />
        </RootFrame>
      </div>
      <Readout rootId={rootId} />
      <PresetCode preset={preset} />
    </Provider>
  );
}

/** Each preset reproduces one real product's layout; pick one and operate it. */
export const Presets: Story = () => {
  const [preset, pick] = usePresetPick(PRESETS);
  return (
    <StrategyRegistryProvider strategies={OVERLAP_STRATEGIES}>
      <PresetPicker presets={PRESETS} value={preset} onChange={pick} testId="xd-preset" />
      <PresetInfo preset={preset} />
      <PresetView key={preset.id} preset={preset} />
    </StrategyRegistryProvider>
  );
};
