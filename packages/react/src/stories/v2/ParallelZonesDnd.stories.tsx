export default { title: 'v0.2 / Parallel zones (drag between)' };

import {
  asNodeId,
  createPanel,
  createZone,
  stackStrategy,
  WindeaseNodeStore,
} from '@windease/core';
import type { Story } from '@ladle/react';
import { type RefObject, useMemo, useRef } from 'react';
import {
  type ChromeMap,
  NodeContainer,
  NodeDragHandle,
  NodeDragProvider,
  StrategyRegistryProvider,
  useNodeDragState,
  useNodeDropTarget,
  WindeaseNodeProvider,
} from '../../v2/index.js';
import '../windease.css';
import './parallel-zones-dnd.css';
import { colorClassForId } from '../Panel.js';

const STRATEGIES = {
  stack: stackStrategy as never,
};

const LEFT = asNodeId('left-zone');
const RIGHT = asNodeId('right-zone');

function makeStore(): WindeaseNodeStore {
  const s = new WindeaseNodeStore();
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
  useNodeDropTarget(zoneId, ref as RefObject<Element | null>);
  const drag = useNodeDragState();
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
        <NodeContainer parentId={zoneId} chrome={chrome} className="pz-zone__inner" />
      </div>
    </section>
  );
}

export const ParallelZonesDnd: Story = () => {
  const store = useMemo(() => makeStore(), []);

  const chrome: ChromeMap = useMemo(
    () => ({
      zone: ({ children }) => <>{children}</>,
      group: ({ node, children }) => (
        <div className={`story-panel ${colorClassForId(node.id)}`}>{children}</div>
      ),
      panel: ({ node }) => (
        <NodeDragHandle nodeId={node.id} className={`story-panel ${colorClassForId(node.id)} pz-panel`}>
          <span className="story-panel__title">{String(node.meta?.title ?? node.id)}</span>
          <span className="pz-panel__grip" aria-hidden="true">⋮⋮</span>
        </NodeDragHandle>
      ),
    }),
    [],
  );

  return (
    <WindeaseNodeProvider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <NodeDragProvider>
          <div className="pz-row">
            <ZoneShell zoneId={LEFT} label="Left zone" chrome={chrome} />
            <ZoneShell zoneId={RIGHT} label="Right zone" chrome={chrome} />
          </div>
          <p className="pz-hint">
            Drag any panel by its grip into the other zone. Escape cancels.
          </p>
        </NodeDragProvider>
      </StrategyRegistryProvider>
    </WindeaseNodeProvider>
  );
};
