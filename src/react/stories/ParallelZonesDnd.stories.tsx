export default { title: 'Parallel zones' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useDragState,
} from '../index.js';
import './windease.css';
import './parallel-zones-dnd.css';

const STRATEGIES = {
  stack: stripStrategy as never,
};

const LEFT = asNodeId('left-zone');
const RIGHT = asNodeId('right-zone');

function makeStore(): Store {
  const s = new Store();
  for (const zid of [LEFT, RIGHT]) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: { axis: 'y', fill: true, gap: 8, padding: 12 } },
        id: zid,
      }),
    );
  }
  const seed: Array<[string, typeof LEFT, string]> = [
    ['left-a', LEFT, 'Alpha'],
    ['left-b', LEFT, 'Bravo'],
    ['left-c', LEFT, 'Charlie'],
    ['right-a', RIGHT, 'Delta'],
    ['right-b', RIGHT, 'Echo'],
  ];
  for (const [id, parentId, title] of seed) {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: nid,
        parentId,
        meta: { title },
      }),
    );
    s.showNode(nid);
  }
  return s;
}

function ZoneShell({
  zoneId,
  label,
  chrome,
}: {
  zoneId: ReturnType<typeof asNodeId>;
  label: string;
  chrome: ChromeMap;
}) {
  // `<Container>` registers the zone as a drop target itself, with the default
  // getInsertionIndex. A useDropTarget call here would clobber that — child
  // effects run before parent effects — and every drop would append.
  const drag = useDragState();
  const isTarget = drag?.hover?.targetId === zoneId;
  const accepted = isTarget && drag?.hover?.accepted === true;
  const className = [
    'pz-zone',
    isTarget && accepted ? 'pz-zone--accept' : '',
    isTarget && !accepted ? 'pz-zone--reject' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="pz-column">
      <header className="pz-column__header">{label}</header>
      <div className={className}>
        <Container parentId={zoneId} chrome={chrome} className="pz-zone__inner" />
      </div>
    </section>
  );
}

export const DragBetween: Story = () => {
  const store = useMemo(() => makeStore(), []);

  const chrome: ChromeMap = useMemo(
    () => ({
      zone: ({ children }) => <>{children}</>,
      panel: ({ node }) => (
        <DragHandle nodeId={node.id} className="pz-panel">
          <div className="windease-panel">
            <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
          </div>
          <span className="pz-panel__grip" aria-hidden="true">
            ⋮⋮
          </span>
        </DragHandle>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <GeometryProvider>
            <FocusProvider>
              <div className="pz-row">
                <ZoneShell zoneId={LEFT} label="Left zone" chrome={chrome} />
                <ZoneShell zoneId={RIGHT} label="Right zone" chrome={chrome} />
              </div>
              <p className="pz-hint">
                Drag any panel by its grip into the other zone. Escape cancels. Or click a panel and
                use <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> to move the caret — the
                sideways ones cross between the zones — and <kbd>Shift</kbd> plus an arrow to send
                the panel itself across.
              </p>
            </FocusProvider>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
