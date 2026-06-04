import { Machine } from '../fsm.js';

export type FocusState = 'focused' | 'blurred';
export type FocusEvent = 'focus' | 'blur';

export function createFocusMachine(): Machine<FocusState, FocusEvent> {
  return new Machine<FocusState, FocusEvent>({
    initial: 'blurred',
    transitions: {
      blurred: { focus: 'focused' },
      focused: { blur: 'blurred' },
    },
  });
}
