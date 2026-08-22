import type { FocusAdapter, NodeId } from '../../index.js';

export interface DomFocusAdapterOptions {
  root: { current: HTMLElement | null };
  /** Set while this adapter writes DOM focus, so the `focusin` it causes is
   *  ignored rather than fed back into the store. */
  applying: { current: boolean };
  speak: (text: string) => void;
}

/**
 * The DOM implementation of `FocusAdapter`: moves the caret onto the wrapper
 * carrying `data-node`, and hands announcements to a live region the caller
 * renders. A canvas host writes its own — draw a ring, push to its own live
 * region — and the rest of the focus stack is unchanged.
 */
export function createDomFocusAdapter({
  root,
  applying,
  speak,
}: DomFocusAdapterOptions): FocusAdapter {
  return {
    present(id: NodeId | null) {
      const el = root.current;
      if (!el || !id) return;
      const wrapper = el.querySelector(`[data-node="${CSS.escape(String(id))}"]`);
      if (!(wrapper instanceof HTMLElement)) return;
      if (document.activeElement === wrapper || wrapper.contains(document.activeElement)) return;
      applying.current = true;
      try {
        wrapper.focus();
      } finally {
        applying.current = false;
      }
    },
    announce: speak,
  };
}
