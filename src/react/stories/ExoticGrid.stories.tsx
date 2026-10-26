export default { title: 'Exotic / Grid' };

import type { Story } from '@ladle/react';
import { type ReactNode, useMemo, useRef } from 'react';
import { readReorderConfig } from '../../container-config.js';
import {
  asNodeId,
  gridStrategy,
  type Node,
  type NodeId,
  nodeToLayoutItem,
  stripStrategy,
} from '../../index.js';
import { PRESETS } from '../../nuts/grid-scenarios.js';
import { type Preset, presetNodes, presetToStore } from '../../nuts/preset.js';
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
import { PresetStyle, presetClass, withMetaClass } from './PresetStyle.js';
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
  const className = useVerdictClass(node.id, withMetaClass('xg-group xg-frame', node));
  return (
    <section className={className} data-testid={`frame-${node.id}`}>
      <header className="xg-group__title">{titleOf(node)}</header>
      <div className="xg-group__body">
        <Container parentId={node.id} chrome={chrome} affordances />
      </div>
    </section>
  );
}

/** A tile drags by a `DragHandle` unless its container declares `reorder`,
 *  which makes the wrapper the library renders the drag source instead. */
function Tile({ node }: { node: Node }) {
  const parent = useNode(node.membership?.parentId ?? node.id);
  const span = spanLabel(node);
  const className = withMetaClass('xg-tile', node);
  const body = (
    <>
      <span className="xg-tile__title">{titleOf(node)}</span>
      {span ? <span className="xg-tile__span">{span}</span> : null}
    </>
  );
  if (readReorderConfig(parent?.container?.config)) return <div className={className}>{body}</div>;
  return (
    <DragHandle nodeId={node.id} className={className}>
      {body}
    </DragHandle>
  );
}

const chrome: ChromeHandler = ({ node }) =>
  node.container ? <GroupFrame node={node} /> : <Tile node={node} />;

/** childOrder and grid's `unplaced` for one container — what a drop changes
 *  that the canvas cannot show, since unplaced children render nowhere. */
function Readout({ id, title }: { id: NodeId; title: string }) {
  const parent = useNode(id);
  const visible = useChildren(id).filter((c) => c.lifecycle.state === 'visible');
  // `unplaced` in squeeze mode depends on the container only through a fixed
  // `cell.w` with no `cols`, which no preset uses.
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

function RootFrame({
  id,
  className,
  children,
}: {
  id: NodeId;
  className: string;
  children: ReactNode;
}) {
  const root = useNode(id);
  return (
    <div
      className={useVerdictClass(id, withMetaClass(`xg-root xg-frame ${className}`, root))}
      data-testid={`frame-${id}`}
    >
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrolls = preset.mechanics.config?.overflowMode === 'scroll';
  const container = (
    <Container
      parentId={rootId}
      chrome={chrome}
      viewport={preset.viewport}
      affordances
      {...(scrolls ? { scrollRef } : {})}
    />
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <PresetInfo preset={preset} />
          <PresetStyle preset={preset} />
          <RootFrame id={rootId} className={presetClass(preset)}>
            {scrolls ? (
              // Sized to the designed viewport, which is the preset's data.
              <div
                ref={scrollRef}
                className="xg-scroller"
                style={{ width: preset.viewport.w, height: preset.viewport.h }}
                data-testid="xg-scroller"
              >
                {container}
              </div>
            ) : (
              container
            )}
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
  const [preset, pick, run] = usePresetPick(PRESETS);
  return (
    <div className="xg-story">
      <PresetPicker presets={PRESETS} value={preset} onChange={pick} onReset={run.reset} />
      <PresetView key={run.key} preset={preset} />
    </div>
  );
};
