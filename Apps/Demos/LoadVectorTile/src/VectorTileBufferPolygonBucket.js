import Cartesian3 from "../../../../packages/core/Source/Cartesian3.js";
import Matrix4 from "../../../../packages/core/Source/Matrix4.js";
import BufferPolygonCollection from "../../../../packages/engine/Source/Scene/BufferPolygonCollection.js";
import HeightReference from "../../../../packages/engine/Source/Scene/HeightReference.js";
import VectorTileBufferPolygonGeometry from "./VectorTileBufferPolygonGeometry.js";
import VectorTileFillBucket from "./VectorTileFillBucket.js";
import VectorTileBucketUtils from "./VectorTileBucketUtils.js";
import VectorTileBucketFallbackReason from "./VectorTileBucketFallbackReason.js";
import VectorTileBufferPolygonPrimitive from "./VectorTileBufferPolygonPrimitive.js";

const FALLBACK_FILL_COLOR = "#ff000077";

function createOutline() {
  return {
    positions: [],
    ringOffsets: [0],
    polygonOffsets: [0],
    featureIndices: [],
    metadata: [],
  };
}

/** 把第 i 个面的所有环追加为旧轮廓工具需要的闭合环。 */
function appendOutline(outline, group, i, featureIndex, feature) {
  for (let r = group.polygonOffsets[i]; r < group.polygonOffsets[i + 1]; r++) {
    const start = group.ringOffsets[r] * 2;
    const end = group.ringOffsets[r + 1] * 2;
    for (let j = start; j < end; j++) {
      outline.positions.push(group.ringPositions[j]);
    }
    outline.positions.push(
      group.ringPositions[start],
      group.ringPositions[start + 1],
    );
    outline.ringOffsets.push(outline.positions.length / 2);
  }
  outline.polygonOffsets.push(outline.ringOffsets.length - 1);
  outline.featureIndices.push(featureIndex);
  outline.metadata.push(feature);
}

/** 独立的 Buffer 面桶；继承旧桶仅复用轮廓和公共生命周期，不修改旧实现。 */
class VectorTileBufferPolygonBucket extends VectorTileFillBucket {
  constructor(styleRule, options = {}) {
    super(styleRule, options);
    this._scene = options.scene;
    this._budget = options.bufferPolygonBudget;
    this._isCurrent = options.isCurrent;
  }

  build(polygons, zoom, tileContext = {}) {
    this.buildZoom ??= zoom;
    const started = this._diagnostics?.startTimer?.();
    const { ground, height } = VectorTileBufferPolygonGeometry.getParameters(
      this.styleRule,
    );
    if (
      VectorTileBucketUtils.requiresGroundHeightOffsetFallback(this.styleRule)
    ) {
      this._diagnostics?.increment("groundHeightOffsetFallbacks");
    }
    const group = tileContext.bufferPolygons?.find(
      (prepared) => prepared.ground === ground && prepared.height === height,
    );
    if (!group) {
      throw new Error(`BufferPolygon 图层 ${this.id} 缺少 Worker 面准备结果。`);
    }

    const selection = this._selectFeatures(group, zoom, ground);
    if (selection.indices.length > 0) {
      this._addFillPrimitive(group, selection, ground);
    }
    if (selection.outline) {
      this._addOutlinePrimitive(
        selection.outline,
        zoom,
        ground,
        tileContext.tileBounds,
      );
    }

    const buildMs = this._diagnostics?.recordDuration?.(
      "bufferPolygonBuild",
      started,
    );
    this._diagnostics?.addFrameWork?.("bufferPolygonBuild", buildMs ?? 0);
    return this;
  }

  /** 按样式筛出要素，同时统计集合容量并（需要时）收集轮廓。 */
  _selectFeatures(group, zoom, ground) {
    const hasOutline = Object.prototype.hasOwnProperty.call(
      this.styleRule.paint ?? {},
      "fill-outline-color",
    );
    const selection = {
      indices: [],
      vertexCount: 0,
      holeCount: 0,
      triangleCount: 0,
      outline: hasOutline ? createOutline() : undefined,
    };
    for (let i = 0; i < group.featureIndices.length; i++) {
      const featureIndex = group.featureIndices[i];
      const feature = this._featureTable[featureIndex];
      if (
        !VectorTileBucketUtils.doesStyleRuleMatchMetadata(
          feature,
          group.geometryTypes[i],
          this.styleRule,
          zoom,
          { ignoreZoomRange: true },
        )
      ) {
        continue;
      }
      selection.indices.push(i);
      selection.vertexCount +=
        group.vertexOffsets[i + 1] - group.vertexOffsets[i];
      selection.holeCount += group.holeOffsets[i + 1] - group.holeOffsets[i];
      if (!ground) {
        selection.triangleCount +=
          (group.triangleOffsets[i + 1] - group.triangleOffsets[i]) / 3;
      }
      if (selection.outline) {
        appendOutline(selection.outline, group, i, featureIndex, feature);
      }
    }
    return selection;
  }

  _addFillPrimitive(group, selection, ground) {
    const { indices } = selection;
    const collection = new BufferPolygonCollection({
      primitiveCountMax: indices.length,
      vertexCountMax: selection.vertexCount,
      holeCountMax: selection.holeCount,
      triangleCountMax: selection.triangleCount,
      modelMatrix: Matrix4.fromTranslation(Cartesian3.fromArray(group.origin)),
      allowPicking: this._allowPicking,
      heightReference: ground
        ? HeightReference.CLAMP_TO_GROUND
        : HeightReference.NONE,
    });
    const featureIndices = Uint32Array.from(
      indices,
      (index) => group.featureIndices[index],
    );
    const primitive = new VectorTileBufferPolygonPrimitive(collection, {
      scene: this._scene,
      ground,
      diagnostics: this._diagnostics,
      prepared: group,
      indices: Uint32Array.from(indices),
      budget: this._budget,
      allowPicking: this._allowPicking,
      isCurrent: this._isCurrent,
      getColor: (index) => this._evaluateFillColor(featureIndices[index]),
    });
    this.addPrimitive(primitive, "buffer-fill", featureIndices);
    this._diagnostics?.increment("bufferPolygonBuckets");
    this._diagnostics?.increment("createdPrimitives");
  }

  _addOutlinePrimitive(outline, zoom, ground, tileBounds) {
    const started = this._diagnostics?.startTimer?.();
    const result = this._createFillOutlineGeometryInstances(
      outline,
      zoom,
      ground,
      tileBounds,
    );
    if (result.instances.length > 0) {
      const options = {
        allowPicking: this._allowPicking,
        diagnostics: this._diagnostics,
      };
      this.addPrimitive(
        ground
          ? VectorTileBucketUtils.createGroundPolylinePrimitive(
              result.instances,
              {
                ...options,
                createGroundPolylinePrimitive:
                  this._createGroundPolylinePrimitive,
              },
            )
          : VectorTileBucketUtils.createPrimitive(
              result.instances,
              "line",
              {},
              {
                ...options,
                asynchronous: this._asynchronous,
                shadows: this._shadows,
              },
            ),
        "fill-outline",
        result.featureIndices,
      );
    }
    this._diagnostics?.recordDuration?.("bufferPolygonOutline", started);
  }

  _evaluateFillColor(featureIndex) {
    const feature = this._featureTable[featureIndex];
    return VectorTileBucketUtils.evaluateColorStyleValue(
      this.styleRule.paint?.["fill-color"],
      feature,
      this.buildZoom,
      FALLBACK_FILL_COLOR,
      { state: this._getFeatureStateForFeature(feature) },
    );
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
          const updated = record.primitive.setColor(
            index,
            this._evaluateFillColor(featureIndex),
          );
          result.instanceUpdates += updated ? 1 : 0;
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
    return binding.primitive.setColor(
      binding.instanceId,
      VectorTileBucketUtils.evaluateColorStyleValue(
        this.styleRule.paint?.[binding.property],
        feature,
        this.buildZoom,
        binding.fallback,
        { state: this._getFeatureStateForFeature(feature) },
      ),
    );
  }
}

export default VectorTileBufferPolygonBucket;
