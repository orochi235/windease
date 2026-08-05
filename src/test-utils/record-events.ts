import type { Store, StoreEvents } from '../store.js';

export type EventName = keyof StoreEvents;

export interface RecordedEvent<K extends EventName> {
  name: K;
  payload: StoreEvents[K];
}

export interface EventRecorder<K extends EventName> {
  /** Every recorded event, in emission order across all recorded names. */
  readonly log: readonly RecordedEvent<K>[];
  /** Payloads for one recorded name, in emission order. */
  of<N extends K>(name: N): readonly StoreEvents[N][];
  /** Unsubscribe. Anything already recorded stays readable. */
  stop(): void;
}

/**
 * Record store events for assertion *after* the mutation returns.
 *
 * `TypedEmitter.emit` swallows listener throws, so an `expect` written
 * inside a `store.events` handler prints `[windease] event listener threw`
 * and the test passes anyway. Recording here and asserting on the way out
 * is the only way an event assertion can actually fail a test.
 */
export function recordEvents<K extends EventName>(store: Store, ...names: K[]): EventRecorder<K> {
  const log: RecordedEvent<K>[] = [];
  const offs = names.map((name) =>
    store.events.on(name, (payload) => {
      log.push({ name, payload });
    }),
  );
  return {
    log,
    of<N extends K>(name: N): readonly StoreEvents[N][] {
      return log.filter((e): e is RecordedEvent<N> => e.name === name).map((e) => e.payload);
    },
    stop() {
      for (const off of offs) off();
    },
  };
}
