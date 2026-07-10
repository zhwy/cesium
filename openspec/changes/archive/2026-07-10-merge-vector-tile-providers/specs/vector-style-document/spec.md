## ADDED Requirements

### Requirement: Style document layers are removable by layer id

The vector tile manager SHALL remove a single style document layer by matching the layer id against provider style rules instead of removing the source-backed runtime layer unconditionally.

#### Scenario: Remove one layer from a multi-layer source

- **WHEN** a style document contains two or more layers that reference the same source and `removeLayer(layerId)` is called with one of those layer ids
- **THEN** the manager SHALL remove only the matching style rule from that source provider and keep the provider and runtime vector tile layer active for the remaining style rules

#### Scenario: Remove the final layer from a source

- **WHEN** `removeLayer(layerId)` removes the last style rule owned by a source provider
- **THEN** the manager SHALL remove that provider's runtime vector tile layer from the collection and delete the source provider entry

#### Scenario: Remove an unknown layer

- **WHEN** `removeLayer(layerId)` is called with an id that does not match any provider style rule
- **THEN** the manager SHALL return `false` and leave all providers, style rules, and runtime layers unchanged

### Requirement: Style state is sourced from normalized style documents

The vector tile style system SHALL use normalized style documents as the source of style layer state and SHALL NOT require legacy `styles` option conversion for manager-managed style layers.

#### Scenario: Apply a style document

- **WHEN** `setStyle(styleDocument)` is called with valid sources and layers
- **THEN** the manager SHALL create source providers with style rules derived from the normalized style document layers

#### Scenario: Read a style document after layer removal

- **WHEN** a style layer has been removed from a provider and `getStyle()` is called
- **THEN** the returned style document SHALL include the provider's source and only its remaining style rules

## REMOVED Requirements

### Requirement: Legacy styles option compatibility

**Reason**: The style-document flow now needs a single source of truth for source/provider ownership and style-layer removal. Maintaining `styles` conversion alongside normalized style documents preserves the provider/layer ambiguity that this change removes.

**Migration**: Callers SHALL provide style layers through a normalized style document via `setStyle(styleDocument)` or equivalent style-document construction, rather than passing legacy `styles` maps.

#### Scenario: Legacy styles maps are no longer used for manager style state

- **WHEN** manager-managed vector tile styling is configured
- **THEN** style layers SHALL be represented as style document layer entries rather than legacy `styles` maps
