export default { title: 'Announcements' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useStore,
} from '../index.js';
import '../styles.css';
import './capabilities.css';

const STRATEGIES = { strip: stripStrategy as never };

const DOCK_A = asNodeId('dock-a');
const DOCK_B = asNodeId('dock-b');
const DOCK_VIEWPORT = { w: 240, h: 260 };

const PANES: Array<[NodeId, NodeId, string]> = [
  [asNodeId('editor'), DOCK_A, 'Editor'],
  [asNodeId('console'), DOCK_A, 'Console'],
  [asNodeId('preview'), DOCK_B, 'Preview'],
];

function makeStore(): Store {
  const s = new Store();
  for (const dock of [DOCK_A, DOCK_B]) {
    s.registerNode(
      createNode({
        kind: 'zone',
        id: dock,
        container: { strategyId: 'strip', config: { axis: 'y', gap: 6, padding: 6, fill: true } },
      }),
    );
    s.showNode(dock);
  }
  for (const [id, parentId, title] of PANES) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id, parentId, meta: { title } }));
    s.showNode(id);
  }
  return s;
}

const chrome: ChromeMap = {
  panel: ({ node }) => (
    <div className="cap-pane">
      <header className="cap-pane__title">{String(node.meta?.title ?? node.id)}</header>
      <div className="cap-pane__body">Click me, then use the buttons above.</div>
    </div>
  ),
};

/** The three gestures the announcer covers: a departure, a relocation, and a
 *  reorder. Each one leaves focus where it was, which is why none of them
 *  would otherwise say anything. */
function Controls() {
  const store = useStore();
  const act = (fn: (id: NodeId) => void) => () => {
    const id = store.focusedId;
    if (id) fn(id);
  };
  return (
    <>
      <button type="button" data-testid="close" onClick={act((id) => store.unregisterNode(id))}>
        close focused
      </button>
      <button
        type="button"
        data-testid="move"
        onClick={act((id) => {
          const from = store.getNode(id)?.membership?.parentId;
          store.moveNode(id, from === DOCK_A ? DOCK_B : DOCK_A);
        })}
      >
        move to the other dock
      </button>
      <button
        type="button"
        data-testid="reorder"
        onClick={act((id) => store.reorderInParent(id, 0))}
      >
        send to front
      </button>
    </>
  );
}

/**
 * `announce` is on by default and costs a polite live region. The region is
 * visually hidden in the shipped stylesheet; this story unhides it so the text
 * a screen reader would read is on screen next to the gesture that produced it.
 */
export const LiveRegion: Story = () => {
  const store = useMemo(makeStore, []);
  const [announce, setAnnounce] = useState(true);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <div className="cap-bar">
            <label>
              <input
                type="checkbox"
                checked={announce}
                data-testid="announce"
                onChange={(e) => setAnnounce(e.target.checked)}
              />{' '}
              announce
            </label>
            <Controls />
          </div>
          <div className="cap-live">
            <FocusProvider announce={announce}>
              <div className="cap-row">
                <Container
                  parentId={DOCK_A}
                  chrome={chrome}
                  viewport={DOCK_VIEWPORT}
                  className="windease-zone"
                />
                <Container
                  parentId={DOCK_B}
                  chrome={chrome}
                  viewport={DOCK_VIEWPORT}
                  className="windease-zone"
                />
              </div>
            </FocusProvider>
          </div>
          <p className="cap-hint">
            Click a pane to focus it, then close it, move it, or send it to the front. Focus does
            not move in any of those, so the live region is the only thing that reports them. Turn{' '}
            <code>announce</code> off and the region goes with it — for a host that owns one of its
            own and would otherwise speak everything twice.
          </p>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
