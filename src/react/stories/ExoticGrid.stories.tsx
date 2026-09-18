export default { title: 'Exotic / Grid' };

import type { Story } from '@ladle/react';
import { type ReactNode, useMemo } from 'react';
import {
  asNodeId,
  gridStrategy,
  type Node,
  type NodeId,
  nodeToLayoutItem,
  stripStrategy,
} from '../../index.js';
import { PRESETS } from '../../test-utils/exotic/grid-scenarios.js';
import { type Preset, presetNodes, presetToStore } from '../../test-utils/exotic/preset.js';
import {
  type ChromeHandler,
  Container,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useChildren,
  useDragState,
  useNode,
} from '../index.js';
import '../styles.css';
import './exotic-grid.css';
import { PresetInfo } from './PresetInfo.js';
import { PresetPicker, usePresetPick } from './PresetPicker.js';
import { PresetCode } from './presetCode.js';

const STRATEGIES = { grid: gridStrategy as never, strip: stripStrategy as never };

const titleOf = (node: Node) => String(node.meta?.title ?? node.id);

function spanLabel(node: Node): string | null {
  const span = node.membership?.placement?.span as { cols?: number; rows?: number } | undefined;
  if (!span) return null;
  return `${span.cols ?? 1}×${span.rows ?? 1}`;
}

/** The hover verdict for `id`, as the frame class the e2e spec reads. */
function useVerdictClass(id: NodeId, base: string): string {
  const drag = useDragState();
  if (drag?.hover?.targetId !== id) return base;
  return `${base} ${drag.hover.accepted ? 'xg-frame--accept' : 'xg-frame--reject'}`;
}

function GroupFrame({ node }: { node: Node }) {
  const className = useVerdictClass(node.id, 'xg-group xg-frame');
  return (
    <section className={className} data-testid={`frame-${node.id}`}>
      <header className="xg-group__title">{titleOf(node)}</header>
      <div className="xg-group__body">
        <Container parentId={node.id} chrome={chrome} affordances />
      </div>
    </section>
  );
}

const chrome: ChromeHandler = ({ node }) => {
  if (node.container) return <GroupFrame node={node} />;
  if (node.meta?.spacer) return <div className="xg-spacer" aria-hidden="true" />;
  const span = spanLabel(node);
  return (
    <DragHandle nodeId={node.id} className="xg-tile">
      <span className="xg-tile__title">{titleOf(node)}</span>
      {span ? <span className="xg-tile__span">{span}</span> : null}
    </DragHandle>
  );
};

/** childOrder and grid's `unplaced` for one container — what a drop changes
 *  that the canvas cannot show, since unplaced children render nowhere. */
function Readout({ id, title }: { id: NodeId; title: string }) {
  const parent = useNode(id);
  const visible = useChildren(id).filter((c) => c.lifecycle.state === 'visible');
  // `unplaced` in the default squeeze mode never depends on the container.
  const unplaced =
    gridStrategy.layout({
      items: visible.map(nodeToLayoutItem),
      container: { w: 1, h: 1 },
      state: undefined,
      options: (parent?.container?.config ?? {}) as Record<string, unknown>,
    }).unplaced ?? [];
  return (
    <div className="xg-readout__row">
      <dt>{title}</dt>
      <dd>
        {visible.length} children, unplaced:{' '}
        <output data-testid={`unplaced-${id}`}>
          {unplaced.length ? unplaced.join(',') : '(none)'}
        </output>
        <output className="xg-readout__order" data-testid={`order-${id}`}>
          {visible.map((c) => c.id).join(',')}
        </output>
      </dd>
    </div>
  );
}

/** A root that is not itself a grid is the device shell (a launcher, a Start
 *  menu), not a place a tile can land. Accepting there would also start its
 *  live preview, which re-lays out the shell and slides the page out from
 *  under the cursor. */
const refuseAtShell = () => false;

function RootFrame({ id, children }: { id: NodeId; children: ReactNode }) {
  return (
    <div className={useVerdictClass(id, 'xg-root xg-frame')} data-testid={`frame-${id}`}>
      {children}
    </div>
  );
}

function PresetView({ preset }: { preset: Preset }) {
  const store = useMemo(() => presetToStore(preset), [preset]);
  const grids = presetNodes(preset)
    .map(({ node }) => node)
    .filter((n) => n.strategy === 'grid');
  const rootId = asNodeId(preset.mechanics.id);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <PresetInfo preset={preset} />
          <RootFrame id={rootId}>
            <Container
              parentId={rootId}
              chrome={chrome}
              viewport={preset.viewport}
              affordances
              {...(preset.mechanics.strategy === 'grid' ? {} : { acceptPolicy: refuseAtShell })}
            />
          </RootFrame>
          <dl className="xg-readout">
            {grids.map((g) => (
              <Readout key={g.id} id={asNodeId(g.id)} title={String(g.meta?.title ?? g.id)} />
            ))}
          </dl>
          <PresetCode preset={preset} />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/**
 * Every grid preset from `grid-scenarios.ts`, rendered through the real React
 * layer. Drag a tile by its body into another group; drag a tile's right or
 * bottom edge where the group is resizable. A frame turns green or red with
 * the drop verdict before you release.
 */
export const Presets: Story = () => {
  const [preset, pick] = usePresetPick(PRESETS);
  return (
    <div className="xg-story">
      <PresetPicker presets={PRESETS} value={preset} onChange={pick} />
      <PresetView key={preset.id} preset={preset} />
    </div>
  );
};
