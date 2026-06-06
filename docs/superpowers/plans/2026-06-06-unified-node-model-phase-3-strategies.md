# Unified Node Model — Phase 3: LayoutNode + Strategy Adapter Implementation Plan

**Goal:** Add `LayoutNode` shape and a converter that lets the existing `LayoutStrategy` family operate on Nodes from `WindeaseNodeStore`. Existing strategy code unchanged. New strategy authors can target either shape.

**Architecture:** Pure additive. `LayoutNode` joins `LayoutItem` in `layout-types.ts`. A helper `nodeToLayoutItem` and a higher-level `runStrategyForContainer(store, parentId, viewportSize)` produce a `LayoutResult` keyed by `NodeId`. Phase 4 (React) calls the helper.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/layout-types.ts` (modify) | Add `LayoutNode` interface |
| `packages/core/src/layout-node-adapter.ts` (new) | `nodeToLayoutItem`, `runStrategyForContainer`, `getLayoutNodes` |
| `packages/core/src/layout-node-adapter.test.ts` (new) | Tests |
| `packages/core/src/index.ts` (modify) | Export |

---

## Tasks

### Task 1: Add `LayoutNode` type and converter

- [ ] Tests: `nodeToLayoutItem` converts placement → meta and preserves hints; `LayoutNode` shape compiles.
- [ ] Implement type + converter.
- [ ] Commit `feat(core): LayoutNode type and nodeToLayoutItem converter`.

### Task 2: `getLayoutNodes(store, parentId)` — visible children only

- [ ] Tests: returns visible children in order, excludes hidden, includes `isContainer` flag.
- [ ] Implement.
- [ ] Commit `feat(core): getLayoutNodes helper`.

### Task 3: `runStrategyForContainer` — runs a registered strategy on a container's nodes

- [ ] Tests: returns `LayoutResult` keyed by NodeId; strategy receives correctly-shaped LayoutItems via the converter.
- [ ] Implement (signature: `(store, parentId, viewportSize, strategy, state) → LayoutResult`).
- [ ] Commit `feat(core): runStrategyForContainer`.

### Task 4: Index exports

- [ ] Export new types/helpers from index.
- [ ] Commit `feat(core): export Phase 3 adapter`.
