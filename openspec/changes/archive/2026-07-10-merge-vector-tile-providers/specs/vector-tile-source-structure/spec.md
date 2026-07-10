## ADDED Requirements

### Requirement: Provider owns source metadata and style rules

`VectorTileProvider` SHALL represent one vector tile style source, including source id, source configuration, tile request behavior, and the style rules that consume that source.

#### Scenario: Create provider for a style source

- **WHEN** the manager creates a provider for a style document source
- **THEN** the provider SHALL expose the source id, source configuration, tile availability, tile resource creation, tile request behavior, and associated style rules through one object

#### Scenario: Serialize provider style state

- **WHEN** a provider has one or more style rules and `toStyleDocument()` is called
- **THEN** the provider SHALL return a style document containing its source and those style rules

#### Scenario: Remove provider style rule

- **WHEN** `removeStyleRule(layerId)` is called with a matching style rule id
- **THEN** the provider SHALL remove that rule and report that a rule was removed

### Requirement: Manager exposes provider lookup by source id

`VectorTileLayerManager` SHALL expose provider lookup through `getProvider(sourceId)` instead of exposing source-backed runtime layers through `getLayer(layerId)`.

#### Scenario: Lookup existing provider

- **WHEN** `getProvider(sourceId)` is called for a source that is present in the current style document
- **THEN** the manager SHALL return the `VectorTileProvider` for that source

#### Scenario: Lookup missing provider

- **WHEN** `getProvider(sourceId)` is called for a source that is not present
- **THEN** the manager SHALL return `undefined`

#### Scenario: Runtime layer remains internal

- **WHEN** callers need to remove a style document layer
- **THEN** callers SHALL use `removeLayer(layerId)` rather than removing the source-backed runtime layer directly
