## 1. Style And Geometry Integration

- [x] 1.1 Add `circle` to supported style layer types in `VectorTileStyleUtils`.
- [x] 1.2 Map circle style rules to MVT point geometry in `VectorTileGeometryPlacement`.
- [x] 1.3 Include circle rules in decode filtering and primitive build selection in `VectorTileLayer`.
- [x] 1.4 Route circle style rules to a circle bucket from `VectorTileBucketFactory`.

## 2. Circle Bucket Implementation

- [x] 2.1 Create `VectorTileCircleBucket` using `BillboardCollection`.
- [x] 2.2 Evaluate `circle-radius`, `circle-color`, `circle-outline-color`, `circle-outline-width`, and `circle-offset` per feature and style zoom.
- [x] 2.3 Support aliases `pixelSize`, `color`, `outlineColor`, `outlineWidth`, and `offset`, with Mapbox-style fields taking precedence.
- [x] 2.4 Generate circle canvas images with `pixelSize = radius * 2`, including outline drawing without changing the radius semantics.
- [x] 2.5 Cache generated circle images within the bucket by evaluated size, color, outline color, and outline width.
- [x] 2.6 Apply billboard terrain height reference, pixel offset, disable-depth-test distance, and picking metadata.

## 3. Documentation

- [x] 3.1 Update `STYLE.md` to list `circle` as a supported layer type.
- [x] 3.2 Document circle paint fields, aliases, defaults, terrain behavior, and the `pixelSize = radius * 2` rule.
- [x] 3.3 Add a circle layer example using property and zoom expressions.

## 4. Tests

- [x] 4.1 Add style normalization tests for accepting circle layers and rejecting invalid source references.
- [x] 4.2 Add geometry placement tests proving circle preserves point features and ignores line/polygon features.
- [x] 4.3 Add bucket factory tests proving circle layers create billboard collections from point data.
- [x] 4.4 Add circle bucket tests for style evaluation, alias precedence, radius-to-pixel-size conversion, terrain height reference, offset, outline, and picking metadata.
- [x] 4.5 Run the LoadVectorTile unit tests and update any affected expectations.
