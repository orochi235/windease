export default { title: 'Desktop' };

import type { Story } from '@ladle/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  asNodeId,
  createNode,
  desktopStrategy,
  type NodeId,
  Store,
  shelfStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  FocusProvider,
  Provider,
  StrategyRegistryProvider,
  useFocusedNode,
  useStore,
} from '../index.js';
import './desktop.css';
import './windease.css';

const STRATEGIES = { desktop: desktopStrategy(shelfStrategy) as never };

const ZONE_ID = asNodeId('desktop');

/** Registered in this order, so each window starts above the one before it. */
const WINDOWS: { id: string; x: number; y: number; w: number; h: number }[] = [
  { id: 'win-1', x: 16, y: 96, w: 200, h: 140 },
  { id: 'win-2', x: 136, y: 150, w: 200, h: 140 },
  { id: 'win-3', x: 40, y: 24, w: 180, h: 120 },
];

const ICONS = ['icon-1', 'icon-2', 'icon-3'];

interface Args {
  minimize: 'shade' | 'icon';
}

function useDesktopStore(minimize: Args['minimize']): Store {
  return useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: ZONE_ID,
        container: {
          strategyId: 'desktop',
          config: { minimize, gap: 8, iconWidth: 72, iconHeight: 64 },
        },
      }),
    );
    for (const id of ICONS) {
      s.registerNode(
        createNode({
          kind: 'icon',
          id: asNodeId(id),
          parentId: ZONE_ID,
          placement: { icon: true },
          hints: { preferredSize: { w: 72, h: 64 } },
        }),
      );
      s.showNode(asNodeId(id));
    }
    for (const { id, x, y, w, h } of WINDOWS) {
      s.registerNode(
        createNode({
          kind: 'window',
          focus: true,
          id: asNodeId(id),
          parentId: ZONE_ID,
          placement: { x, y },
          hints: { preferredSize: { w, h } },
          meta: { title: id },
        }),
      );
      s.showNode(asNodeId(id));
    }
    return s;
  }, [minimize]);
}

/** The desktop's one rule a host has to supply: focus brings a window to the top. */
function RaiseOnFocus() {
  const store = useStore();
  const focused = useFocusedNode();
  useEffect(() => {
    if (!focused || focused.membership?.parentId !== ZONE_ID) return;
    const order = store.getNode(ZONE_ID)?.container?.childOrder ?? [];
    const last = order.length - 1;
    if (order[last] !== focused.id) store.reorderInParent(focused.id, last);
  }, [focused, store]);
  return null;
}

function DesktopZone({ minimize }: Args) {
  const store = useDesktopStore(minimize);

  const chrome: ChromeMap = useMemo(() => {
    const toggle = (id: NodeId, minimized: boolean) =>
      store.patchPlacement(id, { minimized: !minimized });
    return {
      icon: ({ node }) => (
        <div className="desktop-icon" data-testid={`icon-${node.id}`}>
          {String(node.id)}
        </div>
      ),
      window: ({ node }) => {
        const minimized = node.membership?.placement.minimized === true;
        if (minimized && minimize === 'icon') {
          return (
            <button
              type="button"
              className="desktop-icon desktop-icon--window"
              data-testid={`restore-${node.id}`}
              onClick={() => toggle(node.id, true)}
            >
              {String(node.meta?.title ?? node.id)}
            </button>
          );
        }
        return (
          // On click, not pointerdown: raising moves this element in the DOM, and
          // a move mid-press drops the click the press was for.
          // biome-ignore lint/a11y/noStaticElementInteractions: Container's wrapper is this window's group; the click only raises it.
          // biome-ignore lint/a11y/useKeyWithClickEvents: raising is a pointer convenience in this story; the window's own button is its keyboard control.
          <div className="desktop-window" onClick={() => store.focusNode(node.id)}>
            <header className="desktop-window__bar">
              <span>{String(node.meta?.title ?? node.id)}</span>
              <button
                type="button"
                className="desktop-window__button"
                data-testid={`minimize-${node.id}`}
                aria-label={minimized ? 'Restore' : 'Minimize'}
                onClick={() => toggle(node.id, minimized)}
              >
                {minimized ? '▢' : '–'}
              </button>
            </header>
            <div className="desktop-window__body">{String(node.id)}</div>
          </div>
        );
      },
    };
  }, [store, minimize]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <RaiseOnFocus />
        <div className="desktop-demo">
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={{ w: 480, h: 360 }}
            className="windease-zone"
          />
        </div>
        <p className="desktop-hint">
          Press a window to raise it. Minimize{' '}
          {minimize === 'shade' ? 'rolls it up in place' : 'sends it to the icon row'}.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** Windows overlap over a shelf of icons; minimize rolls a window up where it is. */
export const Shade: Story<Args> = (args) => <DesktopZone {...args} />;
Shade.args = { minimize: 'shade' };
Shade.argTypes = { minimize: { options: ['shade', 'icon'], control: { type: 'radio' } } };

/** Minimize turns a window into an icon in the row beneath; pressing it restores it. */
export const IconMinimize: Story<Args> = (args) => <DesktopZone {...args} />;
IconMinimize.args = { minimize: 'icon' };
IconMinimize.argTypes = Shade.argTypes;

const BAR_HEIGHT = 26;

interface BehaviorArgs {
  drag: 'true' | 'x' | 'y' | 'false';
  clamp: 'none' | 'bar' | 'all';
  overflow: 'scroll' | 'clip';
  minimizable: boolean;
  resize: boolean;
  /** Keep the palette on the top layer, above every window you raise. */
  layer: boolean;
}

const BEHAVIOR_WINDOWS: { id: string; x: number; y: number; w: number; h: number }[] = [
  { id: 'win-1', x: 24, y: 24, w: 200, h: 140 },
  { id: 'win-2', x: 180, y: 120, w: 220, h: 150 },
  // Saved on a monitor to the left that is no longer plugged in.
  { id: 'win-3', x: -300, y: 190, w: 200, h: 120 },
  { id: 'palette', x: 320, y: 90, w: 140, h: 100 },
];

const PALETTE = asNodeId('palette');

const BEHAVIOR_STRATEGIES = { desktop: desktopStrategy() as never };

function behaviorConfig(args: BehaviorArgs): Record<string, unknown> {
  const drag = args.drag === 'true' ? true : args.drag === 'false' ? false : args.drag;
  return {
    handleSize: BAR_HEIGHT,
    drag,
    clamp: args.clamp === 'none' ? undefined : args.clamp,
    overflow: args.overflow,
    minimizable: args.minimizable,
    resize: args.resize,
  };
}

function useBehaviorStore(args: BehaviorArgs): Store {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', id: ZONE_ID, container: { strategyId: 'desktop', config: {} } }),
    );
    for (const { id, x, y, w, h } of BEHAVIOR_WINDOWS) {
      s.registerNode(
        createNode({
          kind: 'window',
          focus: true,
          id: asNodeId(id),
          parentId: ZONE_ID,
          placement: { x, y },
          hints: { preferredSize: { w, h }, minSize: { w: 120, h: 60 } },
          meta: { title: id },
        }),
      );
      s.showNode(asNodeId(id));
    }
    return s;
  }, []);
  // A patch, so an arg set back to 'none' has to arrive as undefined to delete its key.
  const patch = behaviorConfig(args);
  const patchKey = JSON.stringify(patch);
  // biome-ignore lint/correctness/useExhaustiveDependencies: patchKey is patch's value identity.
  useLayoutEffect(() => {
    store.updateContainerConfig(ZONE_ID, patch);
  }, [store, patchKey]);
  useLayoutEffect(() => {
    store.patchPlacement(PALETTE, { layer: args.layer ? 'top' : undefined });
  }, [store, args.layer]);
  return store;
}

/** Draws the bar and a glyph under the toggle; the desktop's affordances do the rest. */
const BEHAVIOR_CHROME: ChromeMap = {
  window: ({ node }) => (
    <div className="desktop-window">
      <header className="desktop-window__bar">
        <span>{String(node.meta?.title ?? node.id)}</span>
        <span className="desktop-window__glyph" aria-hidden="true">
          {node.membership?.placement.minimized === true ? '▢' : '–'}
        </span>
      </header>
      <div className="desktop-window__body">{String(node.id)}</div>
    </div>
  ),
};

/** Raising is not a desktop key yet, so a click on a window's title band raises it here. */
function raiseFromBand(store: Store, target: EventTarget | null) {
  const hit = (target as Element | null)?.closest('[data-affordance-hit]');
  const id = hit?.getAttribute('data-affordance-hit')?.match(/^desktop:drag:(.+)$/)?.[1];
  if (id && store.getNode(asNodeId(id))) store.focusNode(asNodeId(id));
}

function BehaviorZone(args: BehaviorArgs) {
  const store = useBehaviorStore(args);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={BEHAVIOR_STRATEGIES}>
        <RaiseOnFocus />
        <div
          ref={scrollRef}
          className={`desktop-scroller desktop-scroller--${args.overflow}${args.minimizable ? '' : ' desktop-scroller--no-toggle'}`}
          data-testid="desktop-scroller"
          onClickCapture={(e) => raiseFromBand(store, e.target)}
        >
          <Container
            parentId={ZONE_ID}
            chrome={BEHAVIOR_CHROME}
            viewport={{ w: 480, h: 360 }}
            className="desktop-surface"
            scrollRef={scrollRef}
            affordances
          />
        </div>
        <p className="desktop-hint">
          Drag a window by its title bar. <code>drag: 'y'</code> moves it up and down only;{' '}
          <code>clamp</code> keeps its title bar, or all of it, on the desktop;{' '}
          <code>minimizable</code> makes the box at its right roll it up; <code>resize</code> lets
          its edges and corners resize it. With <code>layer</code> on, the palette's placement
          carries <code>layer: 'top'</code>, so raising a window never covers it. win-3 was left on
          a monitor that is gone: scroll left to reach it, or clamp to bring it back.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** Every gesture here is a `desktopStrategy` config key; the story wires no pointer code. */
export const Behavior: Story<BehaviorArgs> = (args) => <BehaviorZone {...args} />;
Behavior.args = {
  drag: 'true',
  clamp: 'none',
  overflow: 'scroll',
  minimizable: true,
  resize: true,
  layer: true,
};
Behavior.argTypes = {
  drag: { options: ['true', 'x', 'y', 'false'], control: { type: 'radio' } },
  clamp: { options: ['none', 'bar', 'all'], control: { type: 'radio' } },
  overflow: { options: ['scroll', 'clip'], control: { type: 'radio' } },
};

const RAISE_ZONE = asNodeId('raise-desktop');

function useRaiseStore(raise: 'click' | 'focus'): Store {
  return useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: RAISE_ZONE,
        container: { strategyId: 'desktop', config: { raise } },
      }),
    );
    for (const { id, x, y, w, h } of WINDOWS) {
      s.registerNode(
        createNode({
          kind: 'window',
          focus: true,
          id: asNodeId(id),
          parentId: RAISE_ZONE,
          placement: { x, y },
          hints: { preferredSize: { w, h } },
          meta: { title: id },
        }),
      );
      s.showNode(asNodeId(id));
    }
    return s;
  }, [raise]);
}

function RaiseWindow({ id, title }: { id: NodeId; title: string }) {
  const [presses, setPresses] = useState(0);
  return (
    <div className="desktop-window">
      <header className="desktop-window__bar">
        <span>{title}</span>
        <button
          type="button"
          className="desktop-window__button"
          data-testid={`press-${id}`}
          onClick={() => setPresses((n) => n + 1)}
        >
          {presses}
        </button>
      </header>
      <div className="desktop-window__body">{String(id)}</div>
    </div>
  );
}

const RAISE_CHROME: ChromeMap = {
  window: ({ node }) => <RaiseWindow id={node.id} title={String(node.meta?.title ?? node.id)} />,
};

function RaiseDesktop({ raise }: { raise: 'click' | 'focus' }) {
  const store = useRaiseStore(raise);
  const desktop = (
    <div className="desktop-demo">
      <Container
        parentId={RAISE_ZONE}
        chrome={RAISE_CHROME}
        viewport={{ w: 480, h: 360 }}
        className="windease-zone"
      />
    </div>
  );
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        {raise === 'focus' ? <FocusProvider>{desktop}</FocusProvider> : desktop}
        <p className="desktop-hint">
          {raise === 'click'
            ? "Click a window to raise it; nothing here moves focus. A window's counter counts the presses that reached its button."
            : 'Focus a window, by pointer or Tab, to raise it.'}
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** No host code raises these windows: the zone's `raise` config does, on focus or on click. */
export const RaisePolicy: Story<{ raise: 'click' | 'focus' }> = (args) => (
  <RaiseDesktop {...args} />
);
RaisePolicy.args = { raise: 'click' };
RaisePolicy.argTypes = { raise: { options: ['click', 'focus'], control: { type: 'radio' } } };
