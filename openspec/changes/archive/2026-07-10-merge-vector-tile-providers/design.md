## Context

The vector-tile runtime currently has two provider-shaped abstractions:

- `VectorTileProvider` and its concrete subclasses own tile availability, URL templating, and network loading.
- `VectorTileDataProvider` wraps a source id, source object, concrete provider, and the `VectorTileStyleRule[]` that consume that source.

`VectorTileLayerCollection` stores runtime `VectorTileLayer` instances created from these provider objects. In the style-document path, `VectorTileLayerManager#setStyle()` groups style layers by `source`, creates one `VectorTileDataProvider` per source, then adds one runtime `VectorTileLayer` per provider. This is good for cache/decode efficiency, but `getLayer(layerId)` and `removeLayer(layerId)` currently imply that collection entries are style document layers. They are not; each entry is a source-backed runtime layer containing multiple style rules.

## Goals / Non-Goals

**Goals:**

- Collapse `VectorTileDataProvider` into `VectorTileProvider` so one provider represents one style source, its tile request implementation, and its style rules.
- Remove the legacy `styles` adapter path and use normalized style documents as the source of style state.
- Rename manager lookup semantics from `getLayer(layerId)` to `getProvider(sourceId)`.
- Make `removeLayer(layerId)` remove one style document layer rule from its owning provider.
- Preserve source-scoped tile request, cache, decode, and render behavior.

**Non-Goals:**

- Do not create one runtime `VectorTileLayer` per style document layer.
- Do not introduce a new public Mapbox-compatible style API beyond the existing normalized style document shape.
- Do not change primitive bucket rendering behavior except for removing stale buckets through cache invalidation after style-rule updates.

## Decisions

### Merge source metadata and style rules into `VectorTileProvider`

`VectorTileProvider` will carry:

- `sourceId`
- `source`
- `styleRules`
- `setStyleRules(styleRules)`
- `getStyleRule(layerId)`
- `removeStyleRule(layerId)`
- `toStyleDocument()`

Concrete providers such as `XYZVectorTileProvider` and `WMTSVectorTileProvider` keep their tile-resource implementations, but they inherit the style-source behavior from the base provider.

Alternative considered: rename `VectorTileDataProvider` to `VectorTileStyleSource` and keep two layers. That is semantically clear, but it leaves two provider-like types in the main flow. Since the old `styles` compatibility path is being removed, the wrapper no longer buys enough separation to justify the extra class.

### Keep one runtime `VectorTileLayer` per source/provider

The runtime rendering model remains:

```text
style source/provider
  -> runtime VectorTileLayer
    -> styleRules[]
      -> primitive buckets keyed by styleRule.id
```

This avoids duplicate tile requests and duplicate decode work for multiple style layers sharing one source.

Alternative considered: create one runtime `VectorTileLayer` per style document layer while sharing a provider. That would make layer removal trivial, but the current cache/decode/primitives live on `VectorTileLayer`, so the change would either duplicate work or require a larger cache ownership redesign.

### Replace `getLayer()` with `getProvider()`

`VectorTileLayerManager#getProvider(sourceId)` will return the provider associated with a style source. The manager no longer exposes collection lookup as `getLayer()` because that name collides with style document layer semantics.

`removeLayer(layerId)` keeps the style-document term "layer" and searches provider style rules by rule id. If the provider becomes empty, the manager removes the provider's runtime layer from the collection and deletes the source entry.

### Remove legacy `styles` compatibility

`VectorTileLayer` will be configured from `styleDocument` only. `VectorTileStyleUtils` keeps style normalization and validation, but removes legacy conversion helpers such as `createStyleDocumentFromLegacyOptions()` and `createLegacyLayerOptionsFromStyleDocument()`.

This makes one source of truth for manager style state:

```text
normalized style document
  -> provider.source/sourceId
  -> provider.styleRules
  -> provider.toStyleDocument()
```

## Risks / Trade-offs

- Existing callers using `addLayer({ styles })` break -> update demos/tests to use `styleDocument` or `setStyle()`.
- Existing callers using `getLayer(id)` break -> migrate source lookup to `getProvider(sourceId)` and keep style-layer operations on `removeLayer(layerId)`.
- Removing one style rule requires rebuilding cached tile primitives for the source -> call `setStyle()`/`clearCache()` on the runtime layer and invalidate quadtree tiles after provider style-rule changes.
- Provider now owns both loading and style-rule state -> keep style-rule helper methods small and avoid moving rendering concerns into the provider.

## Migration Plan

1. Add source/style-rule state and helper methods to `VectorTileProvider`.
2. Update `XYZVectorTileProvider`, `WMTSVectorTileProvider`, and `WMTSGeoVectorTileProvider` construction to preserve tile-resource behavior while carrying source metadata.
3. Remove `VectorTileDataProvider` imports/usages and delete the file.
4. Update `VectorTileLayerManager` to store providers by source id, add `getProvider(sourceId)`, and rewrite `removeLayer(layerId)`.
5. Remove legacy style conversion helpers and update `VectorTileLayer` to require normalized style documents for style state.
6. Update tests/examples for style-document based configuration.
