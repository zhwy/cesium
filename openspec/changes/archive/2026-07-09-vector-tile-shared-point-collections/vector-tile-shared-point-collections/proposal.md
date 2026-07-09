# Share point-symbol collections across vector tiles

## Why

Circle and symbol buckets each allocate a fresh `BillboardCollection`
(and `LabelCollection` for symbols) per tile, per style rule. A tile with
only a handful of points still produces a full collection = one draw call +
one `primitive.update(frameState)` every frame. Under LOD streaming the tile
count is large and constantly churning, so the point layers pay a draw-call
and per-frame-update cost proportional to tile count rather than to the number
of visible layers.

`BillboardCollection`/`LabelCollection` support cheap incremental `add`/`remove`
without a full GPU rebuild (unlike `Primitive`), so points are the one geometry
class where a shared, layer-scoped collection is both feasible and a clear win:
draw calls drop from O(tiles) to O(layers), and declutter/collision can later
operate globally instead of per tile.

## What Changes

- Introduce a per-layer shared collection manager that owns one
  `BillboardCollection` and one `LabelCollection` per point-producing layer.
- Change circle and symbol buckets to emit lightweight point descriptors
  instead of constructing collections directly.
- Add tile point entries to the shared collections on commit and remove them
  on decommit/eviction, keyed so a tile's entries can be located and removed
  in O(1) amortized.
- Preserve existing behavior: per-feature picking ids, zoom-range style
  visibility, clamp-to-ground height references, LOD retention/reference
  counting, and warm-up correctness.
- Keep fill/line geometry primitives unchanged (combining those across tiles
  is incompatible with streaming — out of scope).

## Non-goals

- No change to fill/line/`Primitive`/`GroundPrimitive` batching.
- No new declutter/collision algorithm (this only makes it possible later).
- No change to the tile request/decode/LOD selection pipeline.

## Impact

- Affected: `VectorTileCircleBucket.js`, `VectorTileSymbolBucket.js`,
  `VectorTileBucketFactory.js`, `VectorTileQuadtreePrimitive.js` render/commit
  path, `VectorTile.js` destroy path, `VectorTileLayer.js` lifecycle,
  `VectorTileDiagnostics.js` counters.
- Behavior: fewer draw calls and per-frame updates for point layers; commit/
  decommit transitions now mutate shared collections instead of toggling
  `primitive.show` per tile.
- Risk: point add/remove must stay in sync with the committed render set and
  reference counting to avoid leaked or prematurely removed billboards.
