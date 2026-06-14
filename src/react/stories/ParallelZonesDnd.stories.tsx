export default { title: 'Parallel zones (drag between)' };

import type { Story } from '@ladle/react';
import { type RefObject, useMemo, useRef } from 'react';
import { Store, asNodeId, createPanel, createZone, stackStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useDragState,
  useDropTarget,
} from '../index.js';
import './windease.css';
import './parallel-zones-dnd.css';

const STRATEGIES = {
  stack: stackStrategy as never,
};

const LEFT = asNodeId('left-zone');
const RIGHT = asNodeId('right-zone');

function makeStore(): Store {
  const s = new Store();
  for (const zid of [LEFT, RIGHT]) {
    s.registerNode(
      createZone({
        id: zid,
        strategyId: 'stack',
        config: { axis: 'vertical', gap: 8, padding: 12 },
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
    s.registerNode(createPanel({ id: nid, parentId, meta: { title } }));
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
  const ref = useRef<HTMLDivElement | null>(null);
  useDropTarget(zoneId, ref as RefObject<Element | null>);
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
      <div ref={ref} className={className}>
        <Container parentId={zoneId} chrome={chrome} className="pz-zone__inner" />
      </div>
    </section>
  );
}

export const ParallelZonesDnd: Story = () => {
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
          <div className="pz-row">
            <ZoneShell zoneId={LEFT} label="Left zone" chrome={chrome} />
            <ZoneShell zoneId={RIGHT} label="Right zone" chrome={chrome} />
          </div>
          <p className="pz-hint">Drag any panel by its grip into the other zone. Escape cancels.</p>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
