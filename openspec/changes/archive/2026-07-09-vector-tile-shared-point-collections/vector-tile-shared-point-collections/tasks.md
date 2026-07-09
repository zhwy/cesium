# Tasks

## 1. Shared collection manager
- [x] 1.1 Add `SharedPointCollections` (owns BillboardCollection + LabelCollection per layer, `add/removeTileEntries(tileKey, ...)`, handle map, `destroy`)
- [x] 1.2 Wire construction/destruction into `VectorTileLayer` lifecycle
- [x] 1.3 Add diagnostics counters: shared collections, live billboard/label entries, per-frame add/remove counts

## 2. Convert circle bucket
- [x] 2.1 Change `VectorTileCircleBucket.build()` to return billboard descriptors instead of a collection
- [x] 2.2 Route descriptors through the manager on commit; remove on decommit
- [x] 2.3 Update `VectorTileBucketFactory` storage to keep descriptors, not a collection primitive

## 3. Convert symbol bucket
- [x] 3.1 Change `VectorTileSymbolBucket.build()` to return billboard + label descriptors
- [x] 3.2 Handle both collections in the manager for a single tile key

## 4. Render/commit integration
- [x] 4.1 Diff previous vs current committed point set in `VectorTileQuadtreePrimitive`; add/remove entries on transition
- [x] 4.2 Re-evaluate zoom-range style visibility on style-zoom change
- [x] 4.3 Ensure warm-up and pick passes work with shared collections
- [x] 4.4 Remove per-tile `primitive.show` handling for point buckets

## 5. Lifecycle & cleanup
- [x] 5.1 Call `removeTileEntries` in `VectorTile.destroyResources` / eviction before releasing references
- [x] 5.2 Verify reference-counted LOD retention keeps entries alive as expected

## 6. Verification
- [x] 6.1 Unit test: add/remove entries keeps handle map consistent (no leaks)
- [x] 6.2 Unit test: zoom in/out toggles entries correctly
- [x] 6.3 Manual: confirm draw-call / update-count drop for point layers via diagnostics
- [x] 6.4 Manual: picking, clamp-to-ground, LOD pan/zoom show no regressions
