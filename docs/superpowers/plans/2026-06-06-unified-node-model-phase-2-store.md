# Unified Node Model — Phase 2: WindeaseNodeStore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `WindeaseNodeStore` — net-new class implementing the unified node model. Lives alongside the existing `Store`; no v0.1 wrappers in this phase (Phase 7 deprecates the old one). All mutations use record replacement so React's `useSyncExternalStore` re-renders correctly.

**Architecture:** New file `store-v2.ts`. Single `nodes: Map<NodeId, Node>`. Every mutation that touches a node produces a fresh `Node` object via shallow spread. FSMs use Machine instances internally; the containing Node is replaced when the FSM transitions. Events on a `TypedEmitter` keyed by `v0.2 Event` types.

**Tech Stack:** TypeScript, Vitest. Builds on Phase 1's `Node`, constructors, errors.

**Spec:** `docs/superpowers/specs/2026-06-06-unified-node-model-design.md` — sections "Store API", "Errors", "Events", "FSMs".

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/store-v2.ts` (new) | `WindeaseNodeStore` class — single map, mutations, selectors, events, subscribers |
| `packages/core/src/store-v2.test.ts` (new) | Comprehensive store tests |
| `packages/core/src/index.ts` (modify) | Export `WindeaseNodeStore` and event types |

---

## Tasks

### Task 1: Skeleton — Map, register, unregister (with cascade), require helper

**Files:** `packages/core/src/store-v2.ts`, `packages/core/src/store-v2.test.ts`

- [ ] Write tests for `registerNode` (validates kind shape, throws on duplicate, attaches to parent's childIds when slotted), `unregisterNode` (removes from parent, cascade-destroys descendants depth-first, emits events in correct order).
- [ ] Implement: `nodes` Map, `rootIds` array, `events: TypedEmitter<NodeEvents>`, `subscribe(fn)`, `registerNode(node)`, `unregisterNode(id)`, `getNode(id)`, `requireNode(id)`.
- [ ] Tests pass.
- [ ] Commit `feat(core): WindeaseNodeStore — register/unregister/cascade`.

### Task 2: `moveNode` with atomic transit transitions

- [ ] Tests: moveNode succeeds for a slotted node; transit walks idle→releasing→claiming→idle; emits node.moved with from/to parents and indices; cycle detection throws CycleError; missing target throws NodeNotFoundError; panel cannot lose slot.
- [ ] Implement `moveNode(id, newParentId, at?)`. Walk transit FSM. Update parent.childIds on both ends. Replace involved Nodes (record replacement).
- [ ] Tests pass. Commit `feat(core): moveNode with atomic transit`.

### Task 3: `reorderInParent` + pinned-prefix invariant

- [ ] Tests: reorder succeeds; pinned children stay in prefix; reorder requests that violate prefix snap; events.
- [ ] Implement `reorderInParent(id, at)`, internal `resortByPin(parentId)`. Replace container's childIds array and the container Node.
- [ ] Commit `feat(core): reorderInParent + pinned-prefix`.

### Task 4: `setPlacement` / `patchPlacement` / `setMeta`

- [ ] Tests: setPlacement on key works, patchPlacement merges and deletes undefined, setMeta replaces meta. Each emits batched change events.
- [ ] Implement all three. Replace slot.placement / node.meta with fresh records.
- [ ] Commit `feat(core): placement and meta mutations`.

### Task 5: `updateContainerConfig` / `setAllowsPinning`

- [ ] Tests: config merge-patch (undefined deletes), allowsPinning flip triggers resort or clears pinned flags. Events fire.
- [ ] Implement both. Commit `feat(core): container config + allowsPinning`.

### Task 6: `showNode` / `hideNode`

- [ ] Tests: state transitions via lifecycle Machine. Events fire. Cannot show destroyed.
- [ ] Implement. Commit `feat(core): showNode / hideNode`.

### Task 7: `focusNode` / `blurAll` with single-focus invariant

- [ ] Tests: focusNode blurs previous before focusing new; capability-missing throws; unregister of focused blurs first.
- [ ] Implement. Commit `feat(core): focus management`.

### Task 8: Selectors — getChildren, getParent, getAncestors, isContainer, isSlotted, hasFocus, getContainerView

- [ ] Tests for each selector.
- [ ] Implement. Commit `feat(core): node selectors`.

### Task 9: Index exports + integration test

- [ ] Export `WindeaseNodeStore` and event map types from index.ts.
- [ ] Integration test: build a 3-level tree, move a leaf across levels, verify events + final state.
- [ ] Commit `feat(core): export WindeaseNodeStore + integration test`.

---

**Exit criteria:** WindeaseNodeStore implements every store-side spec invariant; all v0.1 tests still pass; v0.2 store is independent of the v0.1 store.

Phase 3 next: layout strategies receive `LayoutNode` shapes from the new store.
