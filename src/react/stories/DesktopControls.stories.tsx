export default { title: 'Desktop Controls' };

import type { Story } from '@ladle/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  asNodeId,
  createNode,
  type DesktopControl,
  desktopStrategy,
  type NodeId,
  Store,
} from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './desktop.css';
import './desktop-controls.css';
import './windease.css';

const STRATEGIES = { desktop: desktopStrategy() as never };
const ZONE = asNodeId('controls-desktop');
const BAR = 26;

/** What the host does with a close request: the strategy only asks. */
type CloseAction = 'hide' | 'unregister' | 'confirm';

interface Args {
  close: boolean;
  minimize: boolean;
  zoom: boolean;
  side: 'start' | 'end';
  onClose: CloseAction;
}

const WINDOWS = [
  { id: 'notes', x: 24, y: 24, w: 200, h: 140 },
  { id: 'mail', x: 150, y: 110, w: 220, h: 150 },
  // Draws no controls of its own: `placement.controls: []` under a config that has them.
  { id: 'palette', x: 330, y: 30, w: 130, h: 100, controls: [] as DesktopControl[] },
];

function controlsOf(args: Args): DesktopControl[] {
  const all: DesktopControl[] = ['close', 'minimize', 'zoom'];
  return all.filter((c) => args[c]);
}

function addWindow(s: Store, w: (typeof WINDOWS)[number]) {
  const placement: Record<string, unknown> = { x: w.x, y: w.y };
  if (w.controls) placement.controls = w.controls;
  s.registerNode(
    createNode({
      kind: 'window',
      focus: true,
      id: asNodeId(w.id),
      parentId: ZONE,
      placement,
      hints: { preferredSize: { w: w.w, h: w.h }, minSize: { w: 120, h: 60 } },
      meta: { title: w.id },
    }),
  );
  s.showNode(asNodeId(w.id));
}

function useControlsStore(args: Args): Store {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: ZONE,
        container: { strategyId: 'desktop', config: { raise: 'click' } },
      }),
    );
    for (const w of WINDOWS) addWindow(s, w);
    return s;
  }, []);
  const controls = controlsOf(args);
  const key = `${controls.join(',')}|${args.side}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the config's value identity.
  useLayoutEffect(() => {
    store.updateContainerConfig(ZONE, {
      handleSize: BAR,
      drag: true,
      resize: true,
      clamp: 'bar',
      controls,
      controlsSide: args.side,
    });
  }, [store, key]);
  return store;
}

/** Draws the bar and a light under each box; the affordances over them do the work. */
function chrome(
  controls: DesktopControl[],
  side: Args['side'],
  confirming: NodeId | null,
  answer: (id: NodeId, close: boolean) => void,
): ChromeMap {
  return {
    window: ({ node }) => {
      const own = node.membership?.placement.controls as DesktopControl[] | undefined;
      const lights = own ?? controls;
      const title = String(node.meta?.title ?? node.id);
      return (
        <div className="desktop-window">
          <header className={`desktop-window__bar stoplights-bar stoplights-bar--${side}`}>
            <span className="stoplights" aria-hidden="true">
              {lights.map((c) => (
                <span key={c} className={`stoplight stoplight--${c}`} />
              ))}
            </span>
            <span className="stoplights-title">{title}</span>
          </header>
          <div className="desktop-window__body">
            {confirming === node.id ? (
              <div className="stoplights-confirm" data-testid={`confirm-${node.id}`}>
                Close {title}?{' '}
                <button type="button" onClick={() => answer(node.id, true)}>
                  Close
                </button>{' '}
                <button type="button" onClick={() => answer(node.id, false)}>
                  Cancel
                </button>
              </div>
            ) : (
              String(node.id)
            )}
          </div>
        </div>
      );
    },
  };
}

function ControlsDesktop(args: Args) {
  const store = useControlsStore(args);
  const [hidden, setHidden] = useState<NodeId[]>([]);
  const [gone, setGone] = useState<NodeId[]>([]);
  const [confirming, setConfirming] = useState<NodeId | null>(null);
  const action = args.onClose;

  useEffect(
    () =>
      store.events.on('node.closeRequested', ({ id }) => {
        if (action === 'confirm') setConfirming(id);
        else if (action === 'hide') {
          store.hideNode(id);
          setHidden((h) => [...h, id]);
        } else {
          store.unregisterNode(id);
          setGone((g) => [...g, id]);
        }
      }),
    [store, action],
  );

  const answer = (id: NodeId, close: boolean) => {
    setConfirming(null);
    if (!close) return;
    store.hideNode(id);
    setHidden((h) => [...h, id]);
  };
  const reopen = (id: NodeId) => {
    if (gone.includes(id)) {
      const w = WINDOWS.find((x) => x.id === id);
      if (w) addWindow(store, w);
      setGone((g) => g.filter((x) => x !== id));
    } else {
      store.showNode(id);
      setHidden((h) => h.filter((x) => x !== id));
    }
  };

  const controls = controlsOf(args);
  const map = chrome(controls, args.side, confirming, answer);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="desktop-scroller desktop-scroller--clip">
          <Container
            parentId={ZONE}
            chrome={map}
            viewport={{ w: 480, h: 360 }}
            className="desktop-surface"
            affordances
          />
        </div>
        <div className="stoplights-closed">
          {[...hidden, ...gone].map((id) => (
            <button key={id} type="button" data-testid={`reopen-${id}`} onClick={() => reopen(id)}>
              Reopen {id}
            </button>
          ))}
        </div>
        <p className="desktop-hint">
          <code>controls</code> lists the boxes each title bar carries and <code>controlsSide</code>{' '}
          the end they sit at; this story draws a light under each. Close only asks: the story
          answers <code>node.closeRequested</code> by hiding, unregistering, or asking first, as{' '}
          <code>onClose</code> says. Zoom fills the desktop, and a second press or a drag of the
          title bar puts the window back. The palette sets <code>placement.controls: []</code>, so
          it carries none.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** Close, minimize and zoom boxes from `desktopStrategy`'s `controls` config. */
export const WindowControls: Story<Args> = (args) => <ControlsDesktop {...args} />;
WindowControls.args = {
  close: true,
  minimize: true,
  zoom: true,
  side: 'start',
  onClose: 'hide',
};
WindowControls.argTypes = {
  side: { options: ['start', 'end'], control: { type: 'radio' } },
  onClose: { options: ['hide', 'unregister', 'confirm'], control: { type: 'radio' } },
};
