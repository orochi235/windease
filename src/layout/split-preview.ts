import type { LayoutPreview, LayoutStrategy, Rect } from '../layout-types.js';

/**
 * Where the two panes land inside the slot a prospective split would take.
 *
 * `store.splitInto` gives the new group the onto-child's exact placement, so
 * the parent's layout is unchanged by a split and only this one slot's
 * interior moves. Running the group's own strategy over it — rather than
 * halving the rect — is what keeps the preview and the committed layout from
 * disagreeing over `gap` and `padding`.
 *
 * Returns null when the strategy places neither child, which leaves the caller
 * showing the un-split layout rather than a wrong one.
 *
 * @group Layout
 */
export function splitPreviewPlacements(
  slot: Rect,
  sourceId: string,
  split: NonNullable<LayoutPreview['split']>,
  strategy: LayoutStrategy<never, string, unknown>,
): Map<string, Rect> | null {
  const [first, second] =
    split.edge === 'start' ? [sourceId, split.ontoId] : [split.ontoId, sourceId];
  const result = strategy.layout({
    items: [{ id: first }, { id: second }],
    container: { w: slot.w, h: slot.h },
    state: undefined as never,
    options: { axis: split.axis, fill: true, ...split.config },
  });
  const out = new Map<string, Rect>();
  for (const id of [first, second]) {
    const rect = result.placements.get(id);
    if (!rect) continue;
    out.set(id, { x: slot.x + rect.x, y: slot.y + rect.y, z: 0, w: rect.w, h: rect.h });
  }
  return out.size > 0 ? out : null;
}
