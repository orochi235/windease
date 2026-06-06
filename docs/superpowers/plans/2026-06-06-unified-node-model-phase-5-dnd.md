# Unified Node Model — Phase 5: DnD Scaffolding Implementation Plan

**Goal:** Minimum viable DnD against `WindeaseNodeStore`: drag-handle hook + component (locked-aware), drag-state hook, drop-target registration. Hit-testing is consumer-implemented via the registered drop targets. Full innermost-wins recursive hit-testing and animations are deferred to v0.3.

**Architecture:** A `NodeDragController` lives in the React context next to the node store. The controller owns the active drag (source id, transit state) and a registry of drop targets. `useNodeDragHandle(nodeId)` returns pointer handlers; on pointer-up over a registered drop target, the controller calls `store.moveNode`.

---

## Tasks

### Task 1: NodeDragController + context

- [ ] Class with `tryBegin(sourceId)`, `hover(targetId)`, `drop()`, `cancel()`, `state` getter.
- [ ] React context separate from `WindeaseNodeContext` so consumers can opt out.
- [ ] Commit.

### Task 2: useNodeDragHandle + NodeDragHandle component

- [ ] Hook returns `{ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }`.
- [ ] No-op when `node.slot.placement.locked === true`.
- [ ] Component wraps children with the gesture.
- [ ] Tests.
- [ ] Commit.

### Task 3: useNodeDropTarget(nodeId, ref)

- [ ] Registers `nodeId`'s element rect with the controller; on pointerup over that rect, controller calls `store.moveNode(source, nodeId)`.
- [ ] Returns hover state.
- [ ] Tests.
- [ ] Commit.

### Task 4: useNodeDragState hook + exports

- [ ] Returns current `{ draggingId, hover }` or null.
- [ ] Index exports.
- [ ] Commit.
