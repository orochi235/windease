import type { LockAxis } from './lock.js';
import type { NodeId } from './node.js';

export type WindeaseErrorCode =
  // codes (still used by existing store/window/zone)
  | 'UNKNOWN_WINDOW'
  | 'UNKNOWN_ZONE'
  | 'ILLEGAL_TRANSITION'
  | 'DUPLICATE_ZONE'
  | 'DUPLICATE_WINDOW'
  | 'ZONE_NOT_EMPTY'
  | 'UNKNOWN_STRATEGY'
  | 'WRONG_ITEM_COUNT'
  | 'UNKNOWN_AFFORDANCE_KIND'
  | 'NO_INITIAL_STATE'
  // codes (unified node model)
  | 'unknown-node'
  | 'duplicate-id'
  | 'kind-shape-mismatch'
  | 'capability-missing'
  | 'cycle-detected'
  | 'strategy-rejected'
  | 'locked'
  | 'pin-index-out-of-range'
  // codes (throttling)
  | 'invalid-throttle-policy'
  // Free-form code surface for InvariantViolationError.
  | (string & {});

/** @group Errors */
export class WindeaseError extends Error {
  readonly code: WindeaseErrorCode;
  constructor(code: WindeaseErrorCode, message: string) {
    super(message);
    this.name = 'WindeaseError';
    this.code = code;
  }
}

/** @group Errors */
export class NodeNotFoundError extends WindeaseError {
  readonly id: NodeId;
  constructor(id: NodeId) {
    super('unknown-node', `Unknown node: ${id}`);
    this.name = 'NodeNotFoundError';
    this.id = id;
  }
}

/** @group Errors */
export class DuplicateNodeError extends WindeaseError {
  readonly id: NodeId;
  constructor(id: NodeId) {
    super('duplicate-id', `Duplicate node id: ${id}`);
    this.name = 'DuplicateNodeError';
    this.id = id;
  }
}

/** @group Errors */
export class CapabilityMissingError extends WindeaseError {
  readonly id: NodeId;
  readonly capability: 'container' | 'membership' | 'focus';
  readonly operation: string;
  constructor(id: NodeId, capability: 'container' | 'membership' | 'focus', operation: string) {
    super(
      'capability-missing',
      `Operation ${operation} requires ${capability} capability on ${id}`,
    );
    this.name = 'CapabilityMissingError';
    this.id = id;
    this.capability = capability;
    this.operation = operation;
  }
}

/** @group Errors */
export class CycleError extends WindeaseError {
  readonly nodeId: NodeId;
  readonly attemptedParentId: NodeId;
  constructor(nodeId: NodeId, attemptedParentId: NodeId) {
    super('cycle-detected', `Cannot move ${nodeId} under ${attemptedParentId}: cycle`);
    this.name = 'CycleError';
    this.nodeId = nodeId;
    this.attemptedParentId = attemptedParentId;
  }
}

/** @group Errors */
export class StrategyRejectionError extends WindeaseError {
  readonly parentId: NodeId;
  readonly reason: string | undefined;
  constructor(parentId: NodeId, reason?: string) {
    super('strategy-rejected', `Container ${parentId} rejected: ${reason ?? 'no reason given'}`);
    this.name = 'StrategyRejectionError';
    this.parentId = parentId;
    this.reason = reason;
  }
}

/** @group Errors */
export class LockedError extends WindeaseError {
  readonly id: NodeId;
  readonly axis: LockAxis;
  readonly operation: string;
  constructor(id: NodeId, axis: LockAxis, operation: string) {
    super('locked', `Operation ${operation} on ${id} is blocked by lock.${axis}`);
    this.name = 'LockedError';
    this.id = id;
    this.axis = axis;
    this.operation = operation;
  }
}

/** @group Errors */
export class PinIndexError extends WindeaseError {
  readonly id: NodeId;
  readonly requested: number;
  readonly length: number;
  constructor(id: NodeId, requested: number, length: number) {
    super(
      'pin-index-out-of-range',
      `Cannot pin ${id} to index ${requested}: parent has ${length} children`,
    );
    this.name = 'PinIndexError';
    this.id = id;
    this.requested = requested;
    this.length = length;
  }
}

/** @group Errors */
export class InvalidThrottlePolicyError extends WindeaseError {
  readonly field: string;
  readonly value: unknown;
  constructor(field: string, value: unknown, message: string) {
    super('invalid-throttle-policy', message);
    this.name = 'InvalidThrottlePolicyError';
    this.field = field;
    this.value = value;
  }
}

/** @group Errors */
export class InvariantViolationError extends WindeaseError {
  readonly context: Record<string, unknown>;
  constructor(code: string, message: string, context: Record<string, unknown>) {
    super(code, message);
    this.name = 'InvariantViolationError';
    this.context = context;
  }
}
