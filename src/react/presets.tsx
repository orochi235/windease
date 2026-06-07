import type { CSSProperties, ReactNode } from 'react';

/**
 * Preset chrome components for the three named role conventions
 * (`panel`, `group`, `zone`). Each is a thin styled div that consumers
 * can compose around the children Container hands to a chrome handler.
 *
 * The windease core has no opinion about these names — they're a
 * convention shared with `createPanel`/`createGroup`/`createZone`. Use
 * these if you want a sensible default look without writing CSS yourself.
 */

interface BaseProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
}

function compose(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Top-level container chrome. Renders `<div class="windease-zone">`. */
export function Zone({ children, className, style }: BaseProps) {
  return (
    <div className={compose('windease-zone', className)} style={style}>
      {children}
    </div>
  );
}

/** A container that lives in a slot. Renders `<div class="windease-group">`. */
export function Group({ children, className, style, title }: BaseProps) {
  return (
    <div className={compose('windease-group', className)} style={style}>
      {title !== undefined && <header className="windease-group__title">{title}</header>}
      {children}
    </div>
  );
}

/**
 * Leaf renderable. Renders `<div class="windease-panel">` with an optional
 * title header above `children`. For a recursive panel, mount the
 * `<Container>` for its own children inside.
 */
export function Panel({ children, className, style, title }: BaseProps) {
  return (
    <div className={compose('windease-panel', className)} style={style}>
      {title !== undefined && <header className="windease-panel__title">{title}</header>}
      {children}
    </div>
  );
}
