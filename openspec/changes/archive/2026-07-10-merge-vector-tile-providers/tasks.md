## 1. Provider Model

- [x] 1.1 Move `VectorTileDataProvider` source/style-rule responsibilities into `VectorTileProvider`
- [x] 1.2 Add provider accessors for `sourceId`, `source`, and `styleRules`
- [x] 1.3 Add provider helpers `setStyleRules()`, `getStyleRule(layerId)`, `removeStyleRule(layerId)`, and `toStyleDocument()`
- [x] 1.4 Update XYZ/WMTS/WMTSGeo provider construction to preserve existing tile resource behavior with the merged base provider

## 2. Manager API And Layer Removal

- [x] 2.1 Replace `_dataProviders` with source-id keyed provider storage in `VectorTileLayerManager`
- [x] 2.2 Replace `getLayer(layerId)` with `getProvider(sourceId)`
- [x] 2.3 Rewrite `removeLayer(layerId)` to find and remove a matching provider style rule
- [x] 2.4 Remove the runtime vector tile layer and provider entry only when the provider has no remaining style rules
- [x] 2.5 Refresh the affected runtime layer style document, clear its cache, and invalidate quadtree tiles after a style rule is removed

## 3. Style Document Cleanup

- [x] 3.1 Remove legacy `styles` conversion imports and usage from `VectorTileLayer`
- [x] 3.2 Remove legacy conversion helpers from `VectorTileStyleUtils`
- [x] 3.3 Update `setStyle()` / `getStyle()` flows to rely on provider `toStyleDocument()` and normalized style documents
- [x] 3.4 Delete `VectorTileDataProvider.js` after all imports are removed

## 4. Callers And Compatibility Updates

- [x] 4.1 Update demos or tests that used legacy `styles` maps to use style documents
- [x] 4.2 Update callers that used `getLayer()` for provider lookup to use `getProvider()`
- [x] 4.3 Verify `addLayer()` behavior remains correct or document/migrate any style-document-only changes

## 5. Verification

- [x] 5.1 Add or update tests for removing one style layer while keeping other layers on the same source
- [x] 5.2 Add or update tests for removing the final style layer from a source
- [x] 5.3 Add or update tests for `getProvider(sourceId)` existing and missing source behavior
- [x] 5.4 Run the relevant vector tile test suite or demo validation
