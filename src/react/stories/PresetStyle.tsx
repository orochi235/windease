import type { Node } from '../../index.js';
import type { Preset } from '../../test-utils/exotic/preset.js';

/** The class an Exotic story puts on a preset's root element, which its `data.css` is scoped under. */
export function presetClass(preset: Preset): string {
  return `preset-${preset.id.replace(/[^\w-]/g, '-')}`;
}

/** `base` plus the `meta.className` a preset's data gave `node`. */
export function withMetaClass(base: string, node: Node | undefined): string {
  const extra = node?.meta?.className;
  return typeof extra === 'string' && extra !== '' ? `${base} ${extra}` : base;
}

/**
 * The preset's `data.css`, nested under {@link presetClass} so it styles only
 * that preset's example. `&` in the css is the root element itself.
 */
export function PresetStyle({ preset }: { preset: Preset }) {
  const css = preset.data?.css;
  if (!css) return null;
  return <style>{`.${presetClass(preset)} {\n${css}\n}`}</style>;
}
