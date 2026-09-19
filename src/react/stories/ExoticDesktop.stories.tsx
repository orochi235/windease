export default { title: 'Exotic / Desktop' };

import type { Story } from '@ladle/react';
import { type ReactNode, useMemo, useRef } from 'react';
import { asNodeId, type Node, type NodeId, type Store } from '../../index.js';
import { OVERLAP_STRATEGIES, PRESETS } from '../../test-utils/exotic/overlap-scenarios.js';
import { type Preset, presetToStore } from '../../test-utils/exotic/preset.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useChildren,
  useDragHandle,
  useNode,
  useStack,
  useStore,
} from '../index.js';
import '../styles.css';
import './exotic-desktop.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetStyle, presetClass, withMetaClass } from './PresetStyle.js';
import { PresetCode } from './presetCode.js';

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
    return <div className={withMetaClass('xd-icon xd-icon--window', node)}>{titleOf(node)}</div>;
  }
  return (
    <div className={withMetaClass('xd-window', node)}>
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

function Tab({
  id,
  title,
  active,
  onPick,
}: {
  id: NodeId;
  title: string;
  active: boolean;
  onPick: () => void;
}) {
  const drag = useDragHandle(id);
  return (
    <button
      type="button"
      role="tab"
      className="xd-tab__label"
      data-testid={`tab-${id}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onPick}
      {...drag}
    >
      {title}
    </button>
  );
}

/** A stack's tabs. Dragging one out, or back in, is the stack's `tear` config. */
function TabStrip({ node }: { node: Node }) {
  const store = useStore();
  const { tabs, activeId, activate } = useStack(node.id);
  const config = node.container?.config as { headerSize?: number; tear?: string } | undefined;
  const header = config?.headerSize ?? 0;
  return (
    <div className={`xd-tabs ${header >= 30 ? 'xd-tabs--tall' : 'xd-tabs--short'}`} role="tablist">
      {tabs.map((tab) => (
        <div key={tab.id} className="xd-tab" role="presentation">
          <Tab
            id={tab.id}
            title={tab.title}
            active={tab.id === activeId}
            onPick={() => activate(tab.id)}
          />
          {config?.tear ? null : (
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

/** A torn-out panel: the bar over it moves it, and its tab drags back into a group. */
function FloatingTab({ node }: { node: Node }) {
  return (
    <div className={withMetaClass('xd-palette', node)} data-testid={`palette-${node.id}`}>
      <header className="xd-palette__bar" />
      <div className="xd-palette__tabs">
        <DragHandle nodeId={node.id} className="xd-palette__tab">
          <span data-testid={`chip-${node.id}`}>{titleOf(node)}</span>
        </DragHandle>
      </div>
      <div className="xd-palette__body" />
    </div>
  );
}

const chrome: ChromeMap = {
  window: ({ node }) => <DesktopWindow node={node} />,
  icon: ({ node }) => (
    <div className={withMetaClass('xd-icon', node)} data-testid={`icon-${node.id}`}>
      {titleOf(node)}
    </div>
  ),
  palette: ({ node }) => (
    <div className={withMetaClass('xd-palette', node)}>
      <header className="xd-palette__bar">{titleOf(node)}</header>
      <div className="xd-palette__body">{String(node.id)}</div>
    </div>
  ),
  tab: ({ node }) =>
    placementOf(node).floating === true ? (
      <FloatingTab node={node} />
    ) : (
      <div className={withMetaClass('xd-page', node)} data-testid={`page-${node.id}`}>
        {titleOf(node)}
      </div>
    ),
  tabs: ({ node }) => (
    <div className={withMetaClass('xd-stack', node)} data-testid={`stack-${node.id}`}>
      <TabStrip node={node} />
      <Container parentId={node.id} chrome={chrome} className="windease-zone" settleMs={0} />
    </div>
  ),
  dock: ({ node }) => (
    <Container
      parentId={node.id}
      chrome={chrome}
      className={withMetaClass('windease-zone xd-dock', node)}
      settleMs={0}
    />
  ),
  canvas: ({ node }) => <div className={withMetaClass('xd-canvas', node)}>{titleOf(node)}</div>,
  'snap-zone': ({ node }) => (
    <div className={withMetaClass('xd-snap-zone', node)}>{titleOf(node)}</div>
  ),
};

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
    <div className={withMetaClass('xd-stack', root)} data-testid={`stack-${rootId}`}>
      <TabStrip node={root} />
      {children}
    </div>
  );
}

/**
 * A desktop is scaled to the frame's width. Two keep their designed size in a scrolling frame: a
 * preset that asks for its scroll extent (Figma's canvas pans), and a root stack, whose tab strip
 * is drawn outside the container and would not scale with it.
 */
function fitOf(preset: Preset): 'width' | undefined {
  const pans = preset.mechanics.config?.overflow === 'scroll';
  return pans || preset.mechanics.strategy === 'stack' ? undefined : 'width';
}

function PresetView({ preset }: { preset: Preset }) {
  const store = useMemo(() => presetToStore(preset), [preset]);
  const rootId = asNodeId(preset.mechanics.id);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const fit = fitOf(preset);
  const mode = fit
    ? ' xd-frame--fit'
    : preset.mechanics.config?.overflow === 'clip'
      ? ' xd-frame--clip'
      : '';
  return (
    <Provider store={store}>
      <DragProvider>
        <PresetStyle preset={preset} />
        <div
          ref={frameRef}
          className={`xd-frame ${presetClass(preset)}${mode}`}
          data-testid="xd-frame"
        >
          <RootFrame rootId={rootId}>
            <Container
              parentId={rootId}
              chrome={chrome}
              viewport={preset.viewport}
              affordances={true}
              settleMs={0}
              className="windease-zone xd-root"
              {...(fit ? { fit } : { scrollRef: frameRef })}
            />
          </RootFrame>
        </div>
        <Readout rootId={rootId} />
        <PresetCode preset={preset} />
      </DragProvider>
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
