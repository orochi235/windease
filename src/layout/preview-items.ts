import type { LayoutItem, LayoutPreview } from '../layout-types.js';

/**
 * `items` as an insert preview lays them out: the dragged child spliced in at
 * `preview.insertIndex` (or appended) when it comes from elsewhere, moved there
 * when it is already a child. Strategies that never read `preview` still see
 * the item count the drop will leave. A split preview is not an insert, so it
 * is not handled here.
 */
export function withPreviewItem(
  items: readonly LayoutItem[],
  preview: LayoutPreview,
): LayoutItem[] {
  const out = [...items];
  const from = out.findIndex((it) => it.id === preview.insertId);
  const index = preview.insertIndex;
  if (from === -1) {
    const ghost: LayoutItem = { id: preview.insertId };
    if (index !== undefined && index >= 0 && index <= out.length) out.splice(index, 0, ghost);
    else out.push(ghost);
  } else if (index !== undefined) {
    const [picked] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(out.length, index)), 0, picked!);
  }
  return out;
}
