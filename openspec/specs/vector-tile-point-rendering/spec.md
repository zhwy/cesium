# Vector Tile Point Rendering Specification

## Overview

This specification defines the implementation of shared point collections for vector tile rendering. The system will render circle and symbol (billboard/label) features through `BillboardCollection`/`LabelCollection` instances that are owned per layer and shared across all vector tiles of that layer, rather than allocating a separate collection per tile per style rule.

## 1. Shared Collection Manager

### 1.1 SharedPointCollections Class

The `SharedPointCollections` class manages shared collections for point features:

```javascript
class SharedPointCollections {
    constructor(layer) {
        // One BillboardCollection and one LabelCollection per layer
        this.billboardCollection = new Cesium.BillboardCollection({
            scene: layer._scene,
            // Other collection options...
        });

        this.labelCollection = new Cesium.LabelCollection({
            scene: layer._scene,
            // Other collection options...
        });

        // Map of tileKey to handles for each collection
        this.tileBillboardHandles = new Map();
        this.tileLabelHandles = new Map();

        // Diagnostic counters
        this.sharedCollectionsCount = 1; // This layer's collections
        this.liveBillboardEntries = 0;
        this.liveLabelEntries = 0;
        this.frameAdds = 0;
        this.frameRemoves = 0;
    }
}
```

#### Requirements:
- **1.1.1** Own one `BillboardCollection` and one `LabelCollection` per layer
- **1.1.2** Maintain maps of tile keys to billboard/label handles for efficient removal
- **1.1.3** Track diagnostic counters: shared collections, live entries, frame operations

### 1.2 Lifecycle Integration

The `SharedPointCollections` must be integrated into the `VectorTileLayer` lifecycle:

#### Requirements:
- **1.2.1** Create `SharedPointCollections` when the layer is constructed
- **1.2.2** Call `destroy()` on the collections when the layer is destroyed
- **1.2.3** Wire the manager into the tile commit/decommit flow

### 1.3 Diagnostics

#### Requirements:
- **1.3.1** Track total shared collections count
- **1.3.2** Track live billboard and label entries
- **1.3.3** Count per-frame add and remove operations
- **1.3.4** Expose diagnostic counters via `VectorTileDiagnostics`

## 2. Circle Bucket Conversion

### 2.1 CircleBucket.build() Changes

The `VectorTileCircleBucket.build()` method must change to return billboard descriptors instead of creating collections:

#### Before:
```javascript
build() {
    const collection = new Cesium.BillboardCollection();
    // Add billboards to collection
    return collection;
}
```

#### After:
```javascript
build() {
    const descriptors = [];
    // Create billboard descriptors (option objects)
    for (const feature of this.features) {
        descriptors.push({
            position: feature.position,
            pixelSize: feature.pixelSize,
            color: feature.color,
            // Other billboard options...
        });
    }
    return descriptors;
}
```

#### Requirements:
- **2.1.1** Return array of billboard descriptor objects instead of `BillboardCollection`
- **2.1.2** Maintain all existing billboard properties in descriptors
- **2.1.3** Ensure descriptors are compatible with `BillboardCollection.add()`

### 2.2 Commit/Deccommit Integration

Circle bucket descriptors must be routed through the shared collection manager:

#### Requirements:
- **2.2.1** On tile commit: call `sharedPointCollections.addTileEntries(tileKey, descriptors)`
- **2.2.2** On tile decommit: call `sharedPointCollections.removeTileEntries(tileKey)`
- **2.2.3** Handle billboard/label handles returned by add operations

### 2.3 BucketFactory Storage Update

The `VectorTileBucketFactory` storage must be updated:

#### Requirements:
- **2.3.1** Store descriptors instead of collection primitives
- **2.3.2** Maintain descriptor arrays for each bucket
- **2.3.3** Provide access to descriptors for commit/decommit operations

## 3. Symbol Bucket Conversion

### 3.1 SymbolBucket.build() Changes

The `VectorTileSymbolBucket.build()` method must return both billboard and label descriptors:

#### Requirements:
- **3.1.1** Return object with `billboardDescriptors` and `labelDescriptors` arrays
- **3.1.2** Maintain all existing billboard and label properties
- **3.1.3** Ensure descriptors are compatible with respective collection add methods

### 3.2 Collection Management

Symbol buckets must handle both collections in the manager:

#### Requirements:
- **3.2.1** Add billboard descriptors to `BillboardCollection`
- **3.2.2** Add label descriptors to `LabelCollection`
- **3.2.3** Track both types of handles for tile removal
- **3.2.4** Handle tile key for both collections consistently

## 4. Render/Commit Integration

### 4.1 Committed Set Diffing

The `VectorTileQuadtreePrimitive` must diff previous vs current committed point sets:

#### Requirements:
- **4.1.1** Maintain previous committed point set state
- **4.1.2** Compare current frame's committed tiles with previous
- **4.1.3** Call `addTileEntries` for newly committed tiles
- **4.1.4** Call `removeTileEntries` for decommitted tiles
- **4.1.5** Handle tile transitions efficiently (O(1) amortized per tile)

### 4.2 Zoom-Range Visibility

Style visibility must be re-evaluated on zoom changes:

#### Requirements:
- **4.2.1** Detect when frame style zoom crosses style rule min/max boundaries
- **4.2.2** Re-evaluate zoom-range visibility for affected entries
- **4.2.3** Add/remove entries based on updated visibility
- **4.2.4** Maintain consistent visibility state across tiles

### 4.3 Warm-up and Pick Passes

Warm-up and pick passes must work with shared collections:

#### Requirements:
- **4.3.1** Ensure warm-up passes use shared collections correctly
- **4.3.2** Verify picking works with shared collection entries
- **4.3.3** Maintain picking IDs and hit detection accuracy
- **4.3.4** Handle shared collection state in pick passes

### 4.4 Primitive Show Handling

Remove per-tile show handling for point buckets:

#### Requirements:
- **4.4.1** Eliminate `primitive.show` toggling for point buckets
- **4.4.2** Use collection membership instead of show property
- **4.4.3** Ensure draw calls are not affected by removal

## 5. Lifecycle & Cleanup

### 5.1 Resource Destruction

Call `removeTileEntries` in destruction paths:

#### Requirements:
- **5.1.1** Call `removeTileEntries` in `VectorTile.destroyResources`
- **5.1.2** Call `removeTileEntries` on tile eviction
- **5.1.3** Ensure entries are removed before releasing references
- **5.1.4** Handle cleanup in all destruction scenarios

### 5.2 Reference Counting

Verify LOD retention works correctly:

#### Requirements:
- **5.2.1** Ensure entries remain alive during LOD retention
- **5.2.2** Verify reference counting is not broken
- **5.2.3** Test tile eviction behavior with shared collections
- **5.2.4** Confirm no premature removal during LOD transitions

## 6. Verification Tests

### 6.1 Unit Tests

#### Requirements:
- **6.1.1** Test add/remove entries maintains handle map consistency
- **6.1.2** Verify no memory leaks in add/remove operations
- **6.1.3** Test tile key mapping accuracy
- **6.1.4** Verify collection state consistency

### 6.2 Zoom Tests

#### Requirements:
- **6.2.1** Test zoom in/out toggles entries correctly
- **6.2.2** Verify zoom-range visibility changes
- **6.2.3** Test style rule boundary crossings
- **6.2.4** Ensure no flickering during zoom transitions

### 6.3 Manual Verification

#### Requirements:
- **6.3.1** Confirm draw-call reduction via diagnostics
- **6.3.2** Verify update count reduction
- **6.3.3** Test performance with multiple tiles
- **6.3.4** Measure memory usage improvement

### 6.4 Regression Tests

#### Requirements:
- **6.3.1** Verify picking functionality unchanged
- **6.3.2** Test clamp-to-ground behavior
- **6.3.3** Verify LOD pan/zoom behavior
- **6.3.4** Ensure no visual regressions

## 7. API Reference

### 7.1 SharedPointCollections API

```javascript
class SharedPointCollections {
    // Add descriptors for a tile
    addTileEntries(tileKey, billboardDescriptors, labelDescriptors) {
        // Returns handles for added entries
    }

    // Remove entries for a tile
    removeTileEntries(tileKey) {
        // Removes all entries for the given tile
    }

    // Destroy all collections
    destroy() {
        // Cleanup resources
    }

    // Get diagnostic counters
    getDiagnostics() {
        return {
            sharedCollections: this.sharedCollectionsCount,
            liveBillboards: this.liveBillboardEntries,
            liveLabels: this.liveLabelEntries,
            frameAdds: this.frameAdds,
            frameRemoves: this.frameRemoves
        };
    }
}
```

### 7.2 Updated Bucket APIs

```javascript
// VectorTileCircleBucket
build() {
    // Returns array of billboard descriptors
    return descriptors;
}

// VectorTileSymbolBucket
build() {
    // Returns object with billboard and label descriptors
    return {
        billboardDescriptors: [...],
        labelDescriptors: [...]
    };
}
```

## 8. Performance Metrics

### 8.1 Expected Improvements

- **Draw Calls**: Reduced from O(tiles) to O(layers) for point layers
- **Per-frame Updates**: Reduced from O(tiles) to O(layers) for point layers
- **Memory Usage**: Reduced collection overhead for point features
- **Performance**: Significant improvement for scenes with many tiles

### 8.2 Monitoring

- Track draw call count in `VectorTileDiagnostics`
- Monitor per-frame update operations
- Measure memory usage of shared collections
- Log performance metrics before/after changes

## 9. Backward Compatibility

### 9.1 API Compatibility

- External APIs remain unchanged
- Public interfaces continue to work as before
- No breaking changes to existing code

### 9.2 Behavior Compatibility

- Picking behavior unchanged
- Visual appearance unchanged
- Zoom-range visibility unchanged
- LOD retention unchanged

## 10. Implementation Schedule

### Phase 1: Core Infrastructure
- Implement `SharedPointCollections` class
- Add lifecycle integration
- Implement basic add/remove operations

### Phase 2: Circle Bucket Conversion
- Update `VectorTileCircleBucket.build()`
- Implement commit/decommit integration
- Update `VectorTileBucketFactory`

### Phase 3: Symbol Bucket Conversion
- Update `VectorTileSymbolBucket.build()`
- Implement label collection management
- Handle both collections per tile

### Phase 4: Render Integration
- Implement committed set diffing
- Add zoom-range visibility handling
- Remove per-tile show handling

### Phase 5: Testing & Verification
- Unit tests for all components
- Performance testing
- Manual verification
- Regression testing

## 11. Risk Assessment

### 11.1 Technical Risks

- **Memory Leaks**: Improper handle management
- **Performance**: Incorrect diffing algorithm
- **Correctness**: State synchronization issues
- **Compatibility**: Behavioral changes

### 11.2 Mitigation Strategies

- Comprehensive testing
- Incremental implementation
- Performance monitoring
- Backward compatibility checks

## 12. Success Criteria

### 12.1 Functional Success

- All tasks completed
- All tests passing
- No regressions
- Performance improvements verified

### 12.2 Performance Success

- Draw calls reduced by 70-90% for point layers
- Per-frame updates reduced proportionally
- Memory usage optimized
- No performance degradation

### 12.3 Quality Success

- Complete test coverage
- No breaking changes
- Clean, maintainable code
- Good documentation
