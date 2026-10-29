import Cartesian3 from "../../../../packages/core/Source/Cartesian3.js";
import Ellipsoid from "../../../../packages/core/Source/Ellipsoid.js";
import EllipsoidTangentPlane from "../../../../packages/core/Source/EllipsoidTangentPlane.js";
import Matrix4 from "../../../../packages/core/Source/Matrix4.js";
import PolygonPipeline from "../../../../packages/core/Source/PolygonPipeline.js";
import Rectangle from "../../../../packages/core/Source/Rectangle.js";
import BufferPolygonCollection from "../../../../packages/engine/Source/Scene/BufferPolygonCollection.js";
import BufferPolygonMaterial from "../../../../packages/engine/Source/Scene/BufferPolygonMaterial.js";
import HeightReference from "../../../../packages/engine/Source/Scene/HeightReference.js";
import VectorTileFillBucket from "./VectorTileFillBucket.js";
import VectorTileBucketUtils from "./VectorTileBucketUtils.js";
import VectorTileBucketFallbackReason from "./VectorTileBucketFallbackReason.js";
import VectorTileBufferPolygonPrimitive from "./VectorTileBufferPolygonPrimitive.js";

/** 独立的 Buffer 面桶；继承旧桶仅复用轮廓和公共生命周期，不修改旧实现。 */
class VectorTileBufferPolygonBucket extends VectorTileFillBucket {
  constructor(styleRule, options = {}) {
    super(styleRule, options);
    this._scene = options.scene;
  }

  build(polygons, zoom, tileContext = {}) {
    this.buildZoom ??= zoom;
    const started = this._diagnostics?.startTimer?.();
    const ground = VectorTileBucketUtils.shouldUseGroundPath(this.styleRule);
    const height = ground
      ? 0
      : VectorTileBucketUtils.getStyleRuleHeightOffset(this.styleRule);
    if (
      VectorTileBucketUtils.requiresGroundHeightOffsetFallback(this.styleRule)
    ) {
      this._diagnostics?.increment("groundHeightOffsetFallbacks");
    }
    const candidates = [];
    for (let i = 0; i + 1 < (polygons?.polygonOffsets?.length ?? 0); i++) {
      const rings = [];
      for (
        let r = polygons.polygonOffsets[i];
        r < polygons.polygonOffsets[i + 1];
        r++
      ) {
        rings.push(
          polygons.positions.subarray(
            polygons.ringOffsets[r] * 2,
            polygons.ringOffsets[r + 1] * 2,
          ),
        );
      }
      candidates.push({ rings, geometry: polygons, index: i, type: 3 });
    }
    const lines = tileContext.lines;
    for (let i = 0; i + 1 < (lines?.offsets?.length ?? 0); i++) {
      candidates.push({
        rings: [
          lines.positions.subarray(
            lines.offsets[i] * 2,
            lines.offsets[i + 1] * 2,
          ),
        ],
        geometry: lines,
        index: i,
        type: 2,
      });
    }
    const rectangle = this._vectorTile?.rectangle;
    const center = rectangle && Rectangle.center(rectangle);
    const origin = center
      ? Cartesian3.fromRadians(
          center.longitude,
          center.latitude,
          0,
          Ellipsoid.WGS84,
        )
      : new Cartesian3();
    const geometries = [];
    // 同步构建轮廓用的 packed 环，继续复用旧桶的边界裁剪和线图元工厂。
    const outline = {
      positions: [],
      ringOffsets: [0],
      polygonOffsets: [0],
      featureIndices: [],
      metadata: [],
    };
    for (const candidate of candidates) {
      const feature = VectorTileBucketUtils.getGeometryFeature(
        this._featureTable,
        candidate.geometry,
        candidate.index,
      );
      if (
        !VectorTileBucketUtils.doesStyleRuleMatchMetadata(
          feature,
          candidate.type,
          this.styleRule,
          zoom,
          { ignoreZoomRange: true },
        )
      ) {
        continue;
      }
      if (
        !center &&
        geometries.length === 0 &&
        candidate.rings[0]?.length >= 2
      ) {
        Cartesian3.fromDegrees(
          candidate.rings[0][0],
          candidate.rings[0][1],
          0,
          Ellipsoid.WGS84,
          origin,
        );
      }
      const geometry = this._prepareGeometry(
        candidate.rings,
        origin,
        ground,
        height,
      );
      if (!geometry) {
        continue;
      }
      geometry.featureIndex = VectorTileBucketUtils.getGeometryFeatureIndex(
        candidate.geometry,
        candidate.index,
      );
      geometry.color = VectorTileBucketUtils.evaluateColorStyleValue(
        this.styleRule.paint?.["fill-color"],
        feature,
        zoom,
        "#ff000077",
        { state: this._getFeatureStateForFeature(feature) },
      );
      geometries.push(geometry);
      for (const ring of geometry.rings) {
        for (const value of ring) {
          outline.positions.push(value);
        }
        // 旧轮廓工具要求闭合环。
        outline.positions.push(ring[0], ring[1]);
        outline.ringOffsets.push(outline.positions.length / 2);
      }
      outline.polygonOffsets.push(outline.ringOffsets.length - 1);
      outline.featureIndices.push(geometry.featureIndex);
      outline.metadata.push(feature);
    }
    if (geometries.length > 0) {
      const collection = new BufferPolygonCollection({
        primitiveCountMax: geometries.length,
        vertexCountMax: geometries.reduce(
          (sum, geometry) => sum + geometry.positions.length / 3,
          0,
        ),
        holeCountMax: geometries.reduce(
          (sum, geometry) => sum + geometry.holes.length,
          0,
        ),
        triangleCountMax: geometries.reduce(
          (sum, geometry) => sum + geometry.triangles.length / 3,
          0,
        ),
        modelMatrix: Matrix4.fromTranslation(origin),
        allowPicking: this._allowPicking,
        heightReference: ground
          ? HeightReference.CLAMP_TO_GROUND
          : HeightReference.NONE,
      });
      const primitive = new VectorTileBufferPolygonPrimitive(collection, {
        scene: tileContext.scene ?? this._scene,
        ground,
        diagnostics: this._diagnostics,
      });
      geometries.forEach((geometry, id) => {
        collection.add({
          ...geometry,
          material: new BufferPolygonMaterial({ color: geometry.color }),
          pickObject: this._allowPicking ? { primitive, id } : undefined,
        });
      });
      this.addPrimitive(
        primitive,
        "buffer-fill",
        geometries.map((geometry) => geometry.featureIndex),
      );
      this._diagnostics?.increment("bufferPolygonBuckets");
      this._diagnostics?.increment("createdBufferPolygons", geometries.length);
      this._diagnostics?.increment("createdPrimitives");
      // 容量统计在填充后登记，primitiveCount 此时才是实际面数。
      this._diagnostics?.addGauge("residentBufferPolygons", geometries.length);
    }
    const result = this._createFillOutlineGeometryInstances(
      outline,
      zoom,
      ground,
      tileContext.tileBounds,
    );
    if (result.instances.length > 0) {
      this.addPrimitive(
        ground
          ? VectorTileBucketUtils.createGroundPolylinePrimitive(
              result.instances,
              {
                allowPicking: this._allowPicking,
                diagnostics: this._diagnostics,
                createGroundPolylinePrimitive:
                  this._createGroundPolylinePrimitive,
              },
            )
          : VectorTileBucketUtils.createPrimitive(
              result.instances,
              "line",
              {},
              {
                allowPicking: this._allowPicking,
                asynchronous: this._asynchronous,
                diagnostics: this._diagnostics,
                shadows: this._shadows,
              },
            ),
        "fill-outline",
        result.featureIndices,
      );
    }
    this._diagnostics?.recordDuration?.("bufferPolygonBuild", started);
    return this;
  }

  _prepareGeometry(rawRings, origin, ground, height) {
    const rings = [];
    for (const raw of rawRings) {
      const ring = [];
      for (let i = 0; i < raw.length; i += 2) {
        if (
          Number.isFinite(raw[i]) &&
          Number.isFinite(raw[i + 1]) &&
          (ring.length === 0 ||
            raw[i] !== ring[ring.length - 2] ||
            raw[i + 1] !== ring[ring.length - 1])
        ) {
          ring.push(raw[i], raw[i + 1]);
        }
      }
      if (
        ring.length >= 4 &&
        ring[0] === ring[ring.length - 2] &&
        ring[1] === ring[ring.length - 1]
      ) {
        ring.length -= 2;
      }
      let area = 0;
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        area += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
      }
      if (ring.length < 6 || Math.abs(area) < 1e-14) {
        if (rings.length === 0) {
          return undefined;
        }
        continue;
      }
      rings.push(ring);
    }
    if (rings.length === 0) {
      return undefined;
    }
    const world = [];
    const holes = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) {
        holes.push(world.length);
      }
      for (let i = 0; i < rings[r].length; i += 2) {
        world.push(
          Cartesian3.fromDegrees(
            rings[r][i],
            rings[r][i + 1],
            0,
            Ellipsoid.WGS84,
          ),
        );
      }
    }
    const plane = EllipsoidTangentPlane.fromPoints(world, Ellipsoid.WGS84);
    let triangles = PolygonPipeline.triangulate(
      plane.projectPointsToNearestOnPlane(world),
      holes,
    );
    if (triangles.length === 0) {
      return undefined;
    }
    let positions;
    if (ground) {
      positions = Cartesian3.packArray(world);
    } else {
      const subdivided = PolygonPipeline.computeSubdivision(
        Ellipsoid.WGS84,
        world,
        triangles,
      );
      positions = subdivided.attributes.position.values;
      PolygonPipeline.scaleToGeodeticHeight(positions, height, Ellipsoid.WGS84);
      triangles = subdivided.indices;
    }
    const local = new Float64Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      local[i] = positions[i] - origin.x;
      local[i + 1] = positions[i + 1] - origin.y;
      local[i + 2] = positions[i + 2] - origin.z;
    }
    return {
      positions: local,
      holes: Uint32Array.from(holes),
      triangles: Uint32Array.from(triangles),
      rings,
    };
  }

  getStyleUpdateFallback(styleRule, plan) {
    if (
      (!plan?.changedPaths || plan.changedPaths.includes("paint.fill-color")) &&
      !this.hasResidentStyleDependencies(styleRule.paint?.["fill-color"])
    ) {
      return VectorTileBucketFallbackReason.MISSING_PROPERTIES;
    }
    return super.getStyleUpdateFallback(styleRule, plan);
  }

  applyStyle(styleRule, styleRevision, plan) {
    const result = super.applyStyle(styleRule, styleRevision, plan);
    if (
      !result.fallbackReason &&
      (!plan?.changedPaths || plan.changedPaths.includes("paint.fill-color"))
    ) {
      for (const record of this.primitiveRecords) {
        if (record.role !== "buffer-fill") {
          continue;
        }
        record.instanceFeatureIndices.forEach((featureIndex, index) => {
          const feature = this._featureTable[featureIndex];
          record.primitive.setColor(
            index,
            VectorTileBucketUtils.evaluateColorStyleValue(
              styleRule.paint?.["fill-color"],
              feature,
              this.buildZoom,
              "#ff000077",
              { state: this._getFeatureStateForFeature(feature) },
            ),
          );
          result.instanceUpdates++;
        });
      }
    }
    return result;
  }

  _indexFeatureStateBindings(record) {
    super._indexFeatureStateBindings(
      record.role === "buffer-fill" ? { ...record, role: "fill" } : record,
    );
  }

  _applyFeatureStateBinding(binding) {
    if (!(binding.primitive instanceof VectorTileBufferPolygonPrimitive)) {
      return super._applyFeatureStateBinding(binding);
    }
    const feature = this._featureTable[binding.featureIndex];
    binding.primitive.setColor(
      binding.instanceId,
      VectorTileBucketUtils.evaluateColorStyleValue(
        this.styleRule.paint?.[binding.property],
        feature,
        this.buildZoom,
        binding.fallback,
        { state: this._getFeatureStateForFeature(feature) },
      ),
    );
    return true;
  }
}

export default VectorTileBufferPolygonBucket;
