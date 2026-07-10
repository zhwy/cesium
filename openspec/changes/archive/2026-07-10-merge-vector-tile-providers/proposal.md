## Why

`VectorTileLayerManager` currently stores one runtime layer per style source, but its public `getLayer()` / `removeLayer()` methods imply they address individual style document layers. This mismatch makes it impossible to remove a single style layer from a source that contains multiple style layers without removing the whole provider-backed runtime layer.

## What Changes

- Merge `VectorTileDataProvider` responsibilities into `VectorTileProvider`, so a provider represents one style source plus its tile request implementation and `VectorTileStyleRule[]`.
- Keep concrete XYZ/WMTS provider subclasses in `VectorTileProvider.js`, but make them carry source metadata and style-rule management directly.
- **BREAKING** Remove legacy `styles` compatibility adapters and require style-document based configuration for source/layer style state.
- **BREAKING** Replace `VectorTileLayerManager#getLayer(layerId)` with `getProvider(sourceId)` for source/provider lookup.
- Fix `VectorTileLayerManager#removeLayer(layerId)` so it removes one style document layer by id from its provider, only removing the runtime vector tile layer when that provider has no remaining style rules.
- Keep rendering/cache behavior source-scoped: one runtime `VectorTileLayer` continues to back one provider/source, while style layers remain individually addressable through provider style rules.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `vector-style-document`: Style document layers become individually addressable for removal while sharing a source/provider.
- `vector-tile-source-structure`: Provider structure changes so one `VectorTileProvider` owns source metadata, tile loading, and associated style rules.

## Impact

- Affected modules: `Apps/Demos/LoadVectorTile/src/VectorTileProvider.js`, `VectorTileDataProvider.js`, `VectorTileLayer.js`, `VectorTileLayerCollection.js`, `VectorTileLayerManager.js`, `VectorTileStyleUtils.js`, and tests/examples that call `getLayer()` or legacy `styles`.
- Public API impact: callers must use `getProvider(sourceId)` for provider lookup and `styleDocument`/`setStyle()` style layers for styling.
- Internal API impact: manager source bookkeeping moves from `_dataProviders` to provider instances stored by source id.
