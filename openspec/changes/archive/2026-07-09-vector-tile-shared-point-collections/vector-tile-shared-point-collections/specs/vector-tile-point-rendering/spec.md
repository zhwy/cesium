## ADDED Requirements

### Requirement: Point symbols render through shared per-layer collections

The system SHALL render circle and symbol (billboard/label) features through
`BillboardCollection`/`LabelCollection` instances that are owned per layer and
shared across all vector tiles of that layer, rather than allocating a separate
collection per tile per style rule. Draw calls and per-frame collection updates
for point layers SHALL scale with the number of point-producing layers, not with
the number of committed tiles.

#### Scenario: Multiple tiles contribute to one collection

- **WHEN** several tiles of the same layer are committed and each contributes
  point features for the same style rule
- **THEN** their billboards/labels are added to a single shared collection for
  that layer
- **AND** the layer issues one draw call and one `update` per shared collection
  rather than one per tile

#### Scenario: Small tile does not allocate a dedicated collection

- **WHEN** a committed tile contains only a few point features
- **THEN** those features are added into the existing shared collection
- **AND** no new per-tile `BillboardCollection` or `LabelCollection` is created

### Requirement: Shared collection membership follows commit transitions

The system SHALL add a tile's point entries to the shared collections when the
tile enters the committed render set and SHALL remove exactly that tile's
entries when the tile leaves the committed set, is evicted, or is destroyed.
Membership SHALL be updated on commit/decommit transitions, not by toggling
per-tile `show` every frame. Entry handles SHALL be tracked per tile so removal
affects only that tile's entries.

#### Scenario: Tile committed then decommitted

- **WHEN** a tile is committed and later leaves the committed render set
- **THEN** its point entries are added on commit and removed on decommit
- **AND** entries belonging to other tiles remain untouched

#### Scenario: Tile destroyed while retained

- **WHEN** a tile's resources are destroyed or it is evicted from the cache
- **THEN** its point entries are removed from the shared collections before its
  reference is released
- **AND** no orphaned billboards or labels remain in the collections

### Requirement: Existing point behavior is preserved

The shared-collection rendering SHALL preserve the externally observable
behavior of the previous per-tile implementation, including per-feature picking
identity, zoom-range style-rule visibility, clamp-to-ground / relative-to-ground
height references, and LOD retention with reference counting.

#### Scenario: Feature picking

- **WHEN** picking is enabled and a rendered point feature is picked
- **THEN** the picked id resolves to that feature's metadata, identical to the
  per-tile implementation

#### Scenario: Zoom-range visibility

- **WHEN** the frame style zoom crosses a style rule's min/max zoom
- **THEN** the affected point entries are added or removed so that only features
  whose rule is visible at the current zoom are rendered

#### Scenario: Clamp-to-ground height reference

- **WHEN** a point style rule requests clamp-to-ground or relative-to-ground
  placement
- **THEN** entries in the shared collection use the same height reference as the
  previous per-tile collection
