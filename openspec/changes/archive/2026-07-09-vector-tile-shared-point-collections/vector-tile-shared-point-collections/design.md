# Design

## Context

Today each tile stores its primitives in `tile.primitives[bucketId]` and the
render loop (`VectorTileQuadtreePrimitive`) iterates the committed render set
every frame, sets `primitive.show = true`, and calls `primitive.update`.
Collections are destroyed with the tile in `VectorTile.destroyResources`.

For point layers we want one collection per layer, shared across tiles, with
membership driven by commit/decommit transitions rather than per-frame `show`
toggling.

## Goals / Non-goals

- Goal: draw calls and per-frame `update` for point layers scale with layer
  count, not tile count.
- Goal: no visible behavior change (picking, zoom visibility, clamp-to-ground,
  LOD retention).
- Non-goal: touching fill/line batching or LOD selection.

## Decisions

### Decision: Buckets emit descriptors, a manager owns collections
Circle/symbol buckets stop calling `new Cesium.BillboardCollection`. `build()`
returns arrays of plain option objects (the same objects currently passed to
`.add`). A `SharedPointCollections` object, owned by the layer, holds one
`BillboardCollection` + one `LabelCollection` and exposes
`addTileEntries(tileKey, descriptors)` / `removeTileEntries(tileKey)`.

- Alternatives considered: keep per-tile collections but pool/reuse them —
  rejected, still O(tiles) draw calls and update calls.

### Decision: Membership follows committed-set transitions, not per-frame show
The render loop diffs the previous committed point set against the current one.
Newly committed tiles → `addTileEntries`; decommitted tiles → `removeTileEntries`.
Zoom-driven style-rule visibility is re-evaluated when the frame style zoom
crosses a rule's min/max, triggering add/remove for affected entries.

- Rationale: `BillboardCollection.add/remove` is incremental; doing it on
  transition (not every frame) is cheaper than N per-frame `show` writes and
  keeps one draw call.

### Decision: Handle bookkeeping keyed by tile
`addTileEntries` stores the returned `Billboard`/`Label` handles in a
`Map<tileKey, handles[]>` so removal is O(entries-in-tile). Tile eviction and
`destroyResources` call `removeTileEntries` before releasing references.

### Decision: Reference counting and retention unchanged
Because a tile kept as LOD fallback stays in the committed set, its entries stay
added. When retention releases a tile, the decommit transition removes its
entries. The shared collections are owned/destroyed by the layer, not by tiles.

## Risks / Trade-offs

- Sync bugs: if a tile is destroyed without a matching `removeTileEntries`,
  billboards leak. Mitigate by removing entries inside the same code path that
  releases the tile reference, plus a debug assertion counting live entries.
- Clamp-to-ground: billboards with `HeightReference` need `scene`; the shared
  collection is constructed with `scene`, same as today.
- Picking: ids are per-billboard, preserved via the descriptor's `id`.

## Migration Plan

Incremental: land the manager + circle bucket first (simpler, single collection),
verify draw-call drop via diagnostics, then convert the symbol bucket
(two collections). Fill/line untouched throughout.

## Open Questions

- Collection granularity: one pair per layer, or one pair per (layer, style-rule
  signature) to keep declutter groups separable? Start per-layer; revisit if
  collision grouping needs finer buckets.
