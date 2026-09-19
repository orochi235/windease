export default { title: 'Tab stack' };

import type { Story } from '@ladle/react';
import { type CSSProperties, useCallback, useMemo, useRef } from 'react';
import {
  asNodeId,
  createNode,
  type Node,
  type NodeId,
  Store,
  stackStrategy,
  stripStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  type ContainerLayout,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useChildren,
  useNode,
  useStack,
  useStore,
} from '../index.js';
import '../styles.css';
import './tab-stack.css';

const STRATEGIES = { stack: stackStrategy as never, strip: stripStrategy as never };

const ROOT = asNodeId('workbench');
const HEADER = 28;
const VIEWPORT = { w: 660, h: 260 };
const STACK_CONFIG = { headerSize: HEADER };

const PANES = [
  { id: 'editor', title: 'Editor' },
  { id: 'preview', title: 'Preview' },
  { id: 'console', title: 'Console' },
];

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: ROOT,
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'x', gap: 8, padding: 8, fill: true },
      },
    }),
  );
  for (const pane of PANES) {
    const id = asNodeId(pane.id);
    s.registerNode(
      createNode({
        id,
        kind: 'panel',
        focus: true,
        parentId: ROOT,
        hints: { minSize: { w: 60, h: 0 } },
        meta: { title: pane.title },
      }),
    );
    s.showNode(id);
  }
  return s;
}

/** The tab strip is the consumer's to draw; `useStack` says what to draw. */
function TabStrip({ id }: { id: NodeId }) {
  const { tabs, activeId, activate } = useStack(id);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      const at = tabs.findIndex((t) => t.id === activeId);
      const next = tabs[(at + step + tabs.length) % tabs.length];
      if (!next) return;
      activate(next.id);
      stripRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
    },
    [tabs, activeId, activate],
  );

  return (
    <div className="ts-tabs" role="tablist" ref={stripRef} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-tab={tab.id}
          data-testid={`tab-${tab.id}`}
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          className="ts-tab"
          onClick={() => activate(tab.id)}
        >
          {tab.title}
        </button>
      ))}
    </div>
  );
}

function Readout() {
  const children = useChildren(ROOT);
  const describe = (n: Node): string =>
    n.container ? `[${n.container.childOrder.join(' ')}]` : String(n.id);
  return (
    <p className="ts-readout">
      Tree:{' '}
      <span className="ts-readout__value" data-testid="ts-readout">
        {children.map(describe).join(' ')}
      </span>
    </p>
  );
}

export const StackOnDrop: Story = () => {
  const store = useMemo(() => makeStore(), []);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <DragHandle nodeId={node.id} className="ts-panel">
          <header className="ts-panel__title" data-testid={`pane-${node.id}`}>
            {String(node.meta?.title ?? node.id)}
          </header>
          <div className="ts-panel__body">Drag me onto the middle of another pane.</div>
        </DragHandle>
      ),
      group: ({ node }) => (
        <div className="ts-stack" data-testid={`stack-${node.id}`}>
          <TabStrip id={node.id} />
          <Container parentId={node.id} chrome={chrome} />
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider stackConfig={STACK_CONFIG}>
          <div className="ts-frame">
            <Container
              parentId={ROOT}
              chrome={chrome}
              viewport={VIEWPORT}
              stackOnDrop
              className="windease-zone ts-zone"
            />
          </div>
          <Readout />
          <div className="ts-prose">
            <p>
              Drag a pane by its header onto the <b>middle</b> of another and the two become one
              tabbed stack. Drop near a pane's left or right <b>edge</b> instead and it inserts
              beside it, as it always did.
            </p>
            <p>
              Click a tab to switch, or focus one and use <kbd>←</kbd> <kbd>→</kbd>. Drag the last
              tab back out and the stack dissolves, lifting the survivor into the row.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const DOCS = asNodeId('docs');

type Fallback = 'next' | 'prev' | 'first';

function makePolicyStore(fallback: Fallback): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: ROOT,
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', gap: 8, padding: 8, fill: true } },
    }),
  );
  s.registerNode(
    createNode({
      id: DOCS,
      kind: 'group',
      parentId: ROOT,
      container: {
        strategyId: 'stack',
        config: { ...STACK_CONFIG, fallback, activeId: 'license' },
      },
    }),
  );
  s.showNode(DOCS);
  for (const [id, title, parentId] of [
    ['readme', 'README', DOCS],
    ['license', 'LICENSE', DOCS],
    ['changelog', 'CHANGELOG', DOCS],
    ['notes', 'Notes', ROOT],
    ['todo', 'TODO', ROOT],
  ] as const) {
    s.registerNode(
      createNode({
        id: asNodeId(id),
        kind: 'panel',
        focus: true,
        parentId,
        hints: { minSize: { w: 60, h: 0 } },
        meta: { title },
      }),
    );
    s.showNode(asNodeId(id));
  }
  // After the initial tabs: set first, each registration would have taken the stack.
  s.updateContainerConfig(DOCS, { show: 'dropped' });
  return s;
}

function ActiveReadout({ id }: { id: NodeId }) {
  const { activeId } = useStack(id);
  const configured = (useNode(id)?.container?.config as { activeId?: string } | undefined)
    ?.activeId;
  return (
    <p className="ts-readout">
      Showing:{' '}
      <span className="ts-readout__value" data-testid="ts-active">
        {activeId ?? 'none'}
      </span>{' '}
      · config activeId:{' '}
      <span className="ts-readout__value" data-testid="ts-configured">
        {configured ?? 'unset'}
      </span>
    </p>
  );
}

/** Acts on the stack's active tab, the way a tab's own close button would. */
function ActiveActions({ id }: { id: NodeId }) {
  const store = useStore();
  const { activeId } = useStack(id);
  if (!activeId) return null;
  return (
    <p className="ts-actions">
      <button
        type="button"
        data-testid="close-active"
        onClick={() => store.unregisterNode(activeId)}
      >
        Close {activeId}
      </button>
      <button type="button" data-testid="hide-active" onClick={() => store.hideNode(activeId)}>
        Hide {activeId}
      </button>
    </p>
  );
}

/**
 * A stack whose behavior is config: `show: 'dropped'` shows a pane dropped into it, and
 * `fallback` picks the tab that shows when the active one closes. No host listener does either.
 */
export const ShowAndFallback: Story<{ fallback: Fallback }> = ({ fallback }) => {
  const store = useMemo(() => makePolicyStore(fallback), [fallback]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <DragHandle nodeId={node.id} className="ts-panel">
          <header className="ts-panel__title" data-testid={`pane-${node.id}`}>
            {String(node.meta?.title ?? node.id)}
          </header>
          <div className="ts-panel__body">Drag me into the tabbed stack.</div>
        </DragHandle>
      ),
      group: ({ node }) => (
        <div className="ts-stack" data-testid={`stack-${node.id}`}>
          <TabStrip id={node.id} />
          <Container parentId={node.id} chrome={chrome} />
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="ts-frame">
            <Container
              parentId={ROOT}
              chrome={chrome}
              viewport={VIEWPORT}
              className="windease-zone ts-zone"
            />
          </div>
          <ActiveReadout id={DOCS} />
          <ActiveActions id={DOCS} />
          <div className="ts-prose">
            <p>
              The stack's config says <code>show: 'dropped'</code>: drag Notes or TODO by its header
              into the stack and it becomes the tab you are looking at.
            </p>
            <p>
              It also says <code>fallback: '{fallback}'</code>: close or hide the active tab and the
              stack shows{' '}
              {fallback === 'first'
                ? 'its first tab'
                : `the tab ${fallback === 'next' ? 'after' : 'before'} it, or the one on the other side at an end`}
              .
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
ShowAndFallback.args = { fallback: 'next' };
ShowAndFallback.argTypes = {
  fallback: { options: ['next', 'prev', 'first'], control: { type: 'radio' } },
};

const SIDED = asNodeId('sided');
const TAB_SIZE = 24;
const SIDE_BAND = 110;

type Tabs = 'strip' | 'stacked';
type Side = 'top' | 'bottom' | 'left' | 'right';

function makeSidedStore(tabs: Tabs, side: Side): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: ROOT,
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', padding: 8, fill: true } },
    }),
  );
  s.registerNode(
    createNode({
      id: SIDED,
      kind: 'sided',
      parentId: ROOT,
      container: {
        strategyId: 'stack',
        config: {
          tabs,
          side,
          headerSize: side === 'left' || side === 'right' ? SIDE_BAND : HEADER,
          tabSize: TAB_SIZE,
        },
      },
    }),
  );
  s.showNode(SIDED);
  for (const pane of PANES) {
    s.registerNode(
      createNode({
        id: asNodeId(pane.id),
        kind: 'panel',
        focus: true,
        parentId: SIDED,
        meta: { title: pane.title },
      }),
    );
    s.showNode(asNodeId(pane.id));
  }
  return s;
}

/** A rect as custom properties; the stylesheet positions the element with them. */
const rectVars = (x: number, y: number, w: number, h: number) =>
  ({ '--x': `${x}px`, '--y': `${y}px`, '--w': `${w}px`, '--h': `${h}px` }) as CSSProperties;

/**
 * Draws the tabs into the band the strategy reserved. `stackStrategy` reports
 * the band, and under `tabs: 'stacked'` each child's own title bar, as
 * channels; the tabs themselves are this story's.
 */
function BandTabs({ id, channels }: { id: NodeId; channels: ContainerLayout['channels'] }) {
  const { tabs, activeId, activate } = useStack(id);
  const first = tabs[0] && channels?.get(tabs[0].id);
  if (!first || first.bandX === undefined) return null;
  const stacked = first.tabH !== undefined;
  const button = (tab: { id: NodeId; title: string }, style?: CSSProperties) => (
    <button
      key={tab.id}
      type="button"
      role="tab"
      data-testid={`tab-${tab.id}`}
      aria-selected={tab.id === activeId}
      className={stacked ? 'ts-tab ts-bar' : 'ts-tab'}
      style={style}
      onClick={() => activate(tab.id)}
    >
      {tab.title}
    </button>
  );
  if (stacked) {
    return (
      <div role="tablist" data-testid="ts-band">
        {tabs.map((tab) => {
          const c = channels?.get(tab.id);
          if (c?.tabX === undefined) return null;
          return button(tab, rectVars(c.tabX, c.tabY ?? 0, c.tabW ?? 0, c.tabH ?? 0));
        })}
      </div>
    );
  }
  return (
    <div
      role="tablist"
      data-testid="ts-band"
      className="ts-band"
      data-vertical={(first.bandH ?? 0) > (first.bandW ?? 0) || undefined}
      style={rectVars(first.bandX, first.bandY ?? 0, first.bandW ?? 0, first.bandH ?? 0)}
    >
      {tabs.map((tab) => button(tab))}
    </div>
  );
}

/**
 * The stack reserves its tab band on any edge, as one strip of tabs or as
 * i3's stacked title bars, one per child. The tabs are drawn where the
 * strategy's channels say the band is.
 */
export const TabsAndSide: Story<{ tabs: Tabs; side: Side }> = ({ tabs, side }) => {
  const store = useMemo(() => makeSidedStore(tabs, side), [tabs, side]);
  const added = useRef(0);
  const addPane = () => {
    added.current += 1;
    const id = asNodeId(`extra-${added.current}`);
    store.registerNode(
      createNode({
        id,
        kind: 'panel',
        focus: true,
        parentId: SIDED,
        meta: { title: `Extra ${added.current}` },
      }),
    );
    store.showNode(id);
  };

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className="ts-panel" data-testid={`body-${node.id}`}>
          <header className="ts-panel__title">{String(node.meta?.title ?? node.id)}</header>
          <div className="ts-panel__body">The body sits beside the band, on whichever edge.</div>
        </div>
      ),
      sided: ({ node }) => (
        <div className="ts-stack" data-testid={`stack-${node.id}`}>
          <Container
            parentId={node.id}
            chrome={chrome}
            overlay={(ctx) => <BandTabs id={node.id} channels={ctx.channels} />}
          />
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="ts-frame">
          <Container
            parentId={ROOT}
            chrome={chrome}
            viewport={VIEWPORT}
            className="windease-zone ts-zone"
          />
        </div>
        <p className="ts-actions">
          <button type="button" data-testid="add-pane" onClick={addPane}>
            Add a pane
          </button>
        </p>
        <div className="ts-prose">
          <p>
            <code>tabs: '{tabs}'</code>, <code>side: '{side}'</code>.{' '}
            {tabs === 'stacked'
              ? `Each child has its own ${TAB_SIZE}px title bar, so the band grows with every pane you add.`
              : 'One band of tabs, headerSize thick.'}{' '}
            Click a tab to show its pane.
          </p>
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};
TabsAndSide.args = { tabs: 'stacked', side: 'top' };
TabsAndSide.argTypes = {
  tabs: { options: ['strip', 'stacked'], control: { type: 'radio' } },
  side: { options: ['top', 'bottom', 'left', 'right'], control: { type: 'radio' } },
};
