import { KindShapeError } from './errors.js';
import type { Node } from './node.js';

/**
 * Verify a node's capability shape matches its kind. Throws KindShapeError
 * on the first violation. Used at registerNode time and at hydrate time.
 *
 *   zone  → container present; slot absent; focus absent.
 *   group → container + slot present; focus absent.
 *   panel → slot + focus present; container optional (recursive panel).
 *
 * `lifecycle` is required on every node and enforced by the type system
 * (non-optional field); not re-checked here.
 */
export function validateKindShape(node: Node): void {
  switch (node.kind) {
    case 'zone':
      if (!node.container) throw new KindShapeError(node.id, 'zone', 'missing container');
      if (node.slot) throw new KindShapeError(node.id, 'zone', 'zone must not have slot');
      if (node.focus) throw new KindShapeError(node.id, 'zone', 'zone must not have focus');
      return;
    case 'group':
      if (!node.container) throw new KindShapeError(node.id, 'group', 'missing container');
      if (!node.slot) throw new KindShapeError(node.id, 'group', 'missing slot');
      if (node.focus) throw new KindShapeError(node.id, 'group', 'group must not have focus');
      return;
    case 'panel':
      if (!node.slot) throw new KindShapeError(node.id, 'panel', 'missing slot');
      if (!node.focus) throw new KindShapeError(node.id, 'panel', 'missing focus');
      return;
    default: {
      const exhaustive: never = node.kind;
      throw new KindShapeError(node.id, exhaustive, 'unknown kind');
    }
  }
}
