# Unified Node Model — Phase 6: Snapshot v2 + Migration Implementation Plan

**Goal:** `serializeNodes(store)` produces v2 snapshots; `deserializeToNodeStore(snap)` consumes either v1 or v2 and returns a `WindeaseNodeStore`. Unowned v1 windows drop with a warning. Transit not serialized.

**Architecture:** New file `snapshot-v2.ts`. Existing v0.1 `serialize`/`deserialize` untouched. v2 deserializer reuses existing v0.1 deserializer for the v1 case and then translates the v1 Maps into node records via the same migration logic.

---

## Tasks

### Task 1: SnapshotV2 type + serializeNodes

- [ ] Tests: round-trip a store with zones, panels (some with placement, some with meta), a recursive panel.
- [ ] Implement type + serializer.
- [ ] Commit.

### Task 2: deserialize v2 to fresh WindeaseNodeStore

- [ ] Tests: v2 round-trips; bad version throws; bad bidirectional link throws.
- [ ] Implement.
- [ ] Commit.

### Task 3: v1 → v2 migration

- [ ] Tests: v1 zones → zone nodes; v1 windows → panel nodes; itemMeta → placement; unowned v1 window emits warning and is dropped; focusedWindowId mapping.
- [ ] Implement migrateV1ToV2.
- [ ] Commit.

### Task 4: Index exports

- [ ] Commit.
