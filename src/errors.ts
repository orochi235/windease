import type { NodeId, NodeKind } from './node.js';

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
  // Free-form code surface for InvariantViolationError.
  | (string & {});

export class WindeaseError extends Error {
  readonly code: WindeaseErrorCode;
  constructor(code: WindeaseErrorCode, message: string) {
    super(message);
    this.name = 'WindeaseError';
    this.code = code;
  }
}

export class NodeNotFoundError extends WindeaseError {
  readonly id: NodeId;
  constructor(id: NodeId) {
    super('unknown-node', `Unknown node: ${id}`);
    this.name = 'NodeNotFoundError';
    this.id = id;
  }
}

export class DuplicateNodeError extends WindeaseError {
  readonly id: NodeId;
  constructor(id: NodeId) {
    super('duplicate-id', `Duplicate node id: ${id}`);
    this.name = 'DuplicateNodeError';
    this.id = id;
  }
}

export class KindShapeError extends WindeaseError {
  readonly id: NodeId;
  readonly kind: NodeKind;
  readonly violation: string;
  constructor(id: NodeId, kind: NodeKind, violation: string) {
    super('kind-shape-mismatch', `Node ${id} (kind=${kind}): ${violation}`);
    this.name = 'KindShapeError';
    this.id = id;
    this.kind = kind;
    this.violation = violation;
  }
}

export class CapabilityMissingError extends WindeaseError {
  readonly id: NodeId;
  readonly capability: 'container' | 'slot' | 'focus';
  readonly operation: string;
  constructor(id: NodeId, capability: 'container' | 'slot' | 'focus', operation: string) {
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

export class InvariantViolationError extends WindeaseError {
  readonly context: Record<string, unknown>;
  constructor(code: string, message: string, context: Record<string, unknown>) {
    super(code, message);
    this.name = 'InvariantViolationError';
    this.context = context;
  }
}
