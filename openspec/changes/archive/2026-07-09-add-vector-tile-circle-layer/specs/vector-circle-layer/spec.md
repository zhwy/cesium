## ADDED Requirements

### Requirement: Circle layer style document support

LoadVectorTile SHALL accept style document layers with `type: "circle"` as a supported layer type.

#### Scenario: Normalize circle layer

- **WHEN** a style document contains a visible layer with `type: "circle"`, a valid `source`, and a valid `sourceLayer`
- **THEN** style normalization SHALL preserve the layer as a circle layer instead of rejecting it.

#### Scenario: Reject invalid circle source references

- **WHEN** a circle layer references a missing source or omits `sourceLayer`
- **THEN** style normalization SHALL reject it using the same validation rules as other layer types.

### Requirement: Circle layer source geometry

Circle layers SHALL render MVT point and multipoint source geometry only.

#### Scenario: Preserve point features for circle

- **WHEN** worker or main-thread style filtering evaluates a circle layer
- **THEN** matching point features SHALL be preserved for bucket creation.

#### Scenario: Ignore non-point features for circle

- **WHEN** a source layer contains line or polygon features that match a circle filter
- **THEN** those non-point features SHALL NOT be used by the circle layer.

### Requirement: Circle billboard rendering

Circle layers SHALL render point features through a Cesium `BillboardCollection` using generated circle images.

#### Scenario: Build circle billboards

- **WHEN** a circle layer matches one or more point features in a decoded tile
- **THEN** the bucket factory SHALL create a circle bucket containing a billboard collection for those points.

#### Scenario: Preserve picking metadata

- **WHEN** `allowPicking` is enabled for the vector tile source
- **THEN** each circle billboard SHALL expose the matching feature metadata through its pick id.

### Requirement: Circle terrain behavior

Circle layer billboard height behavior SHALL follow the same terrain rules as symbol billboards.

#### Scenario: Clamp circle to ground

- **WHEN** a circle layer has `terrain.clampToGround: true` and `terrain.heightOffset` equal to `0`
- **THEN** circle billboards SHALL use `HeightReference.CLAMP_TO_GROUND`.

#### Scenario: Apply relative ground offset

- **WHEN** a circle layer has `terrain.clampToGround: true` and a non-zero `terrain.heightOffset`
- **THEN** circle billboards SHALL use `HeightReference.RELATIVE_TO_GROUND`.

#### Scenario: Use absolute height

- **WHEN** a circle layer does not enable `terrain.clampToGround`
- **THEN** circle billboards SHALL use `HeightReference.NONE`.

### Requirement: Circle style fields

Circle layers SHALL support Mapbox-style paint fields and Cesium-friendly aliases for size, color, outline, and offset.

#### Scenario: Evaluate Mapbox circle fields

- **WHEN** a circle layer defines `circle-radius`, `circle-color`, `circle-outline-color`, `circle-outline-width`, or `circle-offset`
- **THEN** the circle bucket SHALL evaluate those fields for each feature using the current style zoom and feature properties.

#### Scenario: Evaluate circle aliases

- **WHEN** a circle layer omits a Mapbox-style field and defines its alias `pixelSize`, `color`, `outlineColor`, `outlineWidth`, or `offset`
- **THEN** the circle bucket SHALL use the alias as the style value.

#### Scenario: Prefer Mapbox fields over aliases

- **WHEN** a circle layer defines both a Mapbox-style field and its alias
- **THEN** the circle bucket SHALL use the Mapbox-style field.

### Requirement: Circle radius and pixel size conversion

Circle layers SHALL treat `circle-radius` as radius in pixels and SHALL create point images with `pixelSize = radius * 2`.

#### Scenario: Radius controls pixel size

- **WHEN** a circle feature evaluates `circle-radius` to `8`
- **THEN** the generated circle point image SHALL be created with `pixelSize` equal to `16`.

#### Scenario: Pixel size alias controls radius

- **WHEN** a circle feature omits `circle-radius` and evaluates `pixelSize` to `18`
- **THEN** the circle bucket SHALL treat the effective radius as `9` and create the point image with `pixelSize` equal to `18`.

#### Scenario: Invalid size falls back

- **WHEN** a circle feature evaluates its configured size to a non-finite value
- **THEN** the circle bucket SHALL fall back to the default radius before calculating `pixelSize`.

### Requirement: Circle documentation and tests

Circle layer support SHALL be documented and covered by focused unit tests.

#### Scenario: Document supported circle fields

- **WHEN** developers read the LoadVectorTile style reference
- **THEN** the document SHALL list `circle` as a supported layer type and describe the supported fields, aliases, terrain behavior, and `pixelSize = radius * 2` rule.

#### Scenario: Test circle integration

- **WHEN** the LoadVectorTile unit tests run
- **THEN** they SHALL cover circle style normalization, geometry filtering, bucket creation, style expression evaluation, terrain height reference behavior, and radius-to-pixel-size conversion.
