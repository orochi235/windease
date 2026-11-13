import type { LayoutItem, LayoutPreview } from '../layout-types.js';

/**
 * Applies a grid drop's cell rules to items already spliced for the preview:
 * a drop to a cell lands there, and a child dragged within its own grid
 * without one loses the cell it held, flowing from where the splice put it.
 * Never reorders: a wrapper's `insertIndex` counts its own children, not grid's.
 */
export function projectGridDrop(
  items: readonly LayoutItem[],
  preview: Pick<LayoutPreview, 'insertId' | 'cell'>,
): LayoutItem[] {
  const at = items.findIndex((it) => it.id === preview.insertId);
  const ghost = at >= 0 ? items[at] : undefined;
  if (preview.cell) {
    const rest = items.filter((_, i) => i !== at);
    const placement = { ...ghost?.placement, cell: preview.cell };
    return [...rest, { ...(ghost ?? { id: preview.insertId }), placement }];
  }
  if (!ghost?.placement?.cell) return [...items];
  const { cell: _cell, ...placement } = ghost.placement;
  return items.map((it, i) => (i === at ? { ...ghost, placement } : it));
}
