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

- **WHEN** a circle layer has `terrain: "clamp-to-ground"` and the feature has a terrain height reference
- **THEN** circle SHALL be clamped to the terrain surface.

#### Scenario: Absolute height

- **WHEN** a circle layer has `terrain: "absolute"` and the feature has a height property
- **THEN** circle SHALL be positioned at the height above the ellipsoid.

### Requirement: Circle paint properties

Circle layers SHALL support circle-specific paint properties for visual customization.

#### Scenario: Circle color

- **WHEN** a circle layer specifies `paint.circle-color` with a color value
- **THEN** circles SHALL be rendered with the specified color.

#### Scenario: Circle radius

- **WHEN** a circle layer specifies `paint.circle-radius` with a numeric value
- **THEN** circles SHALL be rendered with the specified radius in pixels.

#### Scenario: Circle stroke

- **WHEN** a circle layer specifies `paint.circle-stroke-color` and `paint.circle-stroke-width`
- **THEN** circles SHALL be rendered with the specified stroke color and width.

### Requirement: Circle layout properties

Circle layers SHALL support layout properties for positioning and visibility control.

#### Scenario: Circle placement

- **WHEN** a circle layer specifies `layout.circle-placement` with "point" or "line"
- **THEN** circles SHALL be placed according to the specified placement strategy.

#### Scenario: Circle visibility

- **WHEN** a circle layer specifies `layout.circle-visibility` with "visible" or "none"
- **THEN** circles SHALL be shown or hidden accordingly.

### Requirement: Circle performance optimization

Circle layers SHALL be optimized for performance with large point datasets.

#### Scenario: Billboard pooling

- **WHEN** multiple tiles contribute to the same circle layer
- **THEN** the system SHALL reuse billboard instances where possible to reduce memory usage.

#### Scenario: Batch rendering

- **WHEN** multiple circles share the same visual properties
- **THEN** the system SHALL batch them together for efficient rendering.

### Requirement: Circle interaction support

Circle layers SHALL support user interaction and picking functionality.

#### Scenario: Mouse picking

- **WHEN** a user clicks on a circle billboard
- **THEN** the system SHALL return the corresponding feature metadata.

#### Scenario: Highlighting

- **WHEN** a circle is hovered or selected
- **THEN** the system SHALL provide visual feedback through highlighting.

### Requirement: Circle data-driven properties

Circle layers SHALL support data-driven styling based on feature properties.

#### Scenario: Data-driven color

- **WHEN** a circle layer uses a data-driven expression for `paint.circle-color`
- **THEN** circles SHALL be colored based on feature property values.

#### Scenario: Data-driven radius

- **WHEN** a circle layer uses a data-driven expression for `paint.circle-radius`
- **THEN** circle sizes SHALL vary based on feature property values.

### Requirement: Circle zoom-based styling

Circle layers SHALL support zoom-based styling variations.

#### Scenario: Zoom-based radius

- **WHEN** a circle layer specifies `paint.circle-radius` with a zoom function
- **THEN** circle sizes SHALL vary based on the current zoom level.

#### Scenario: Zoom-based color

- **WHEN** a circle layer specifies `paint.circle-color` with a zoom function
- **THEN** circle colors SHALL vary based on the current zoom level.

### Requirement: Circle transition support

Circle layers SHALL support smooth transitions when visual properties change.

#### Scenario: Color transitions

- **WHEN** circle colors change due to data updates or zoom changes
- **THEN** the system SHALL smoothly transition between color values.

#### Scenario: Size transitions

- **WHEN** circle sizes change due to data updates or zoom changes
- **THEN** the system SHALL smoothly transition between size values.

### Requirement: Circle error handling

Circle layers SHALL provide appropriate error handling and diagnostics.

#### Scenario: Invalid paint properties

- **WHEN** a circle layer specifies invalid paint property values
- **THEN** the system SHALL log appropriate warnings and use fallback values.

#### Scenario: Missing source features

- **WHEN** a circle layer has no matching features in a tile
- **THEN** the system SHALL handle this gracefully without errors.

### Requirement: Circle documentation

Circle layers SHALL be documented with clear examples and usage guidelines.

#### Scenario: Usage examples

- **WHEN** developers need to implement circle layers
- **THEN** comprehensive examples SHALL be available in the documentation.

#### Scenario: Property reference

- **WHEN** developers need to understand circle layer properties
- **THEN** a complete property reference SHALL be available.
