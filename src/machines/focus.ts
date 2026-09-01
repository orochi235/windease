import { Machine } from '../fsm.js';

/** Whether a node currently holds focus. */
export type FocusState = 'focused' | 'blurred';
/** Events driving {@link FocusState}. */
export type FocusEvent = 'focus' | 'blur';

/**
 * Build the focus machine for a node, starting `blurred`. Called by
 * `createNode` when `focus: true`; the store enforces the single-focus
 * invariant across nodes, not this machine.
 */
export function createFocusMachine(): Machine<FocusState, FocusEvent> {
  return new Machine<FocusState, FocusEvent>({
    initial: 'blurred',
    transitions: {
      blurred: { focus: 'focused' },
      focused: { blur: 'blurred' },
    },
  });
}
