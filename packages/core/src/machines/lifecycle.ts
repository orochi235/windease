import { Machine } from '../fsm.js';

export type LifecycleState = 'mounted' | 'visible' | 'hidden' | 'destroyed';
export type LifecycleEvent = 'show' | 'hide' | 'destroy';

export function createLifecycleMachine(): Machine<LifecycleState, LifecycleEvent> {
  return new Machine<LifecycleState, LifecycleEvent>({
    initial: 'mounted',
    transitions: {
      mounted: { show: 'visible', destroy: 'destroyed' },
      visible: { hide: 'hidden', destroy: 'destroyed' },
      hidden:  { show: 'visible', destroy: 'destroyed' },
      destroyed: {},
    },
  });
}
