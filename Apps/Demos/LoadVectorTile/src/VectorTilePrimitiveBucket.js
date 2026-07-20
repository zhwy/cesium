import { ColorGeometryInstanceAttribute } from "../../../../Build/CesiumUnminified/index.js";
import VectorTileBucketUtils from "./VectorTileBucketUtils.js";
import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";
import VectorTileFeatureStateUtils from "./VectorTileFeatureStateUtils.js";
import VectorTileBucketFallbackReason from "./VectorTileBucketFallbackReason.js";

const COLOR_ROLE_PROPERTIES = Object.freeze({
  line: { property: "line-color", fallback: "#ffff00ff" },
  "packed-line": { property: "line-color", fallback: "#ffff00ff" },
  fill: { property: "fill-color", fallback: "#ff000077" },
  "fill-outline": {
    property: "fill-outline-color",
    fallback: "#ffffffff",
  },
});

/**
 * 单条样式规则在单个矢量瓦片上的基础渲染桶，负责收集图元与共享点描述。
 *
 * @param {VectorTileStyleRule} styleRule 当前渲染桶对应的样式规则。
 */
export default function VectorTilePrimitiveBucket(styleRule, options = {}) {
  this.id = styleRule.id;
  this.type = styleRule.type;
  this.sourceLayer = styleRule.sourceLayer;
  this.styleRule = styleRule;
  this.buildZoom = options.vectorTile?.level;
  this.bucketRevision = options.bucketRevision ?? 0;
  this.appliedStyleRevision = options.styleRevision ?? 0;
  this.appliedPointStyleRevision = this.appliedStyleRevision;
  this.pendingStyleRevision = undefined;
  this.pendingStylePlan = undefined;
  this.pendingReplacement = undefined;
  this.primitives = [];
  this.primitiveRecords = [];
  this.pointDescriptors = {
    billboards: [],
    labels: [],
  };
  this._allowPicking = options.allowPicking ?? false;
  this._diagnostics = options.diagnostics;
  this._featureTable = options.featureTable ?? [];
  this._propertyProjection = options.propertyProjection;
  this._pickProperties = options.pickProperties;
  this._pickRegistry = options.pickRegistry;
  this._sourceId = options.sourceId;
  this._vectorTile = options.vectorTile;
  this._featureStateStore = options.featureStateStore;
  this._featureStateOwner = options.featureStateOwner;
  this._featureStateBindings = new Map();
  this._pendingFeatureStateKeys = new Map();
  this._registeredFeatureStateKeys = undefined;
  this._residentFeatureTableEntries = options.residentFeatureTableEntries ?? 0;
  this._residentPickPropertyValues = options.residentPickPropertyValues ?? 0;
  this._stored = false;
  this._destroyed = false;
}

VectorTilePrimitiveBucket.prototype.addPrimitive = function (
  primitive,
  role = "generic",
  instanceFeatureIndices,
) {
  if (primitive) {
    this.primitives.push(primitive);
    this.primitiveRecords.push({
      primitive,
      role,
      instanceFeatureIndices:
        instanceFeatureIndices === undefined
          ? undefined
          : Uint32Array.from(instanceFeatureIndices),
    });
    this._indexFeatureStateBindings(
      this.primitiveRecords[this.primitiveRecords.length - 1],
    );
  }
};

VectorTilePrimitiveBucket.prototype.addPrimitives = function (
  primitives,
  role = "generic",
) {
  primitives.forEach((primitive) => this.addPrimitive(primitive, role));
};

VectorTilePrimitiveBucket.prototype.addBillboardDescriptor = function (
  descriptor,
  featureIndex,
) {
  if (descriptor) {
    descriptor._vectorTileFeatureIndex = featureIndex;
    this.pointDescriptors.billboards.push(descriptor);
  }
};

VectorTilePrimitiveBucket.prototype.addLabelDescriptor = function (
  descriptor,
  featureIndex,
) {
  if (descriptor) {
    descriptor._vectorTileFeatureIndex = featureIndex;
    this.pointDescriptors.labels.push(descriptor);
  }
};

VectorTilePrimitiveBucket.prototype.createPickContext = function () {
  if (!this._allowPicking || !this._vectorTile) {
    return undefined;
  }
  return {
    featureTable: this._featureTable,
    pickProperties: this._pickProperties,
    sourceId: this._sourceId,
    sourceLayer: this.sourceLayer,
    styleLayerId: this.id,
    tile: {
      x: this._vectorTile.x,
      y: this._vectorTile.y,
      level: this._vectorTile.level,
    },
  };
};

Object.defineProperty(VectorTilePrimitiveBucket.prototype, "pointCount", {
  get: function () {
    return (
      this.pointDescriptors.billboards.length +
      this.pointDescriptors.labels.length
    );
  },
});

Object.defineProperty(VectorTilePrimitiveBucket.prototype, "length", {
  get: function () {
    return this.primitives.length + this.pointCount;
  },
});

VectorTilePrimitiveBucket.prototype.hasResidentStyleDependencies = function (
  ...values
) {
  const dependencies =
    VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies(
      ...values,
    );
  const projection = this._propertyProjection;
  if (!projection || projection.retainAll) {
    return true;
  }
  if (dependencies.all) {
    return false;
  }
  const residentProperties = new Set(projection.properties ?? []);
  return dependencies.properties.every((name) => residentProperties.has(name));
};

VectorTilePrimitiveBucket.prototype.getPointStyleValues = function () {
  return [];
};

VectorTilePrimitiveBucket.prototype.getPointUpdateProperties = function () {
  return [];
};

VectorTilePrimitiveBucket.prototype.isPrimitiveVisible = function (primitive) {
  if (this.styleRule.visibility === false) {
    return false;
  }
  const record = this.primitiveRecords.find(
    (candidate) => candidate.primitive === primitive,
  );
  return !(
    record?.role === "fill-outline" &&
    !Object.prototype.hasOwnProperty.call(
      this.styleRule.paint ?? {},
      "fill-outline-color",
    )
  );
};

VectorTilePrimitiveBucket.prototype.getStyleUpdateFallback = function (
  styleRule,
  plan,
) {
  if (
    this.type === "fill" &&
    doesPlanChangeProperty(plan, "paint.fill-outline-color") &&
    Object.prototype.hasOwnProperty.call(
      styleRule.paint ?? {},
      "fill-outline-color",
    ) &&
    !this.primitiveRecords.some((record) => record.role === "fill-outline")
  ) {
    return VectorTileBucketFallbackReason.MISSING_BUCKET;
  }
  const colorValues = [];
  for (const record of this.primitiveRecords) {
    const colorStyle = COLOR_ROLE_PROPERTIES[record.role];
    if (
      !colorStyle ||
      !doesPlanChangeProperty(plan, `paint.${colorStyle.property}`)
    ) {
      continue;
    }
    const value = styleRule.paint?.[colorStyle.property];
    if (
      record.role === "fill-outline" &&
      !Object.prototype.hasOwnProperty.call(
        styleRule.paint ?? {},
        colorStyle.property,
      )
    ) {
      continue;
    }
    if (
      record.role === "packed-line" &&
      VectorTileBucketUtils.isVectorStyleExpression(value)
    ) {
      return VectorTileBucketFallbackReason.MISSING_PROPERTIES;
    }
    colorValues.push(value);
  }
  colorValues.push(...this.getPointStyleValues(styleRule, plan));
  if (!this.hasResidentStyleDependencies(...colorValues)) {
    return VectorTileBucketFallbackReason.MISSING_PROPERTIES;
  }

  for (const record of this.primitiveRecords) {
    const colorStyle = COLOR_ROLE_PROPERTIES[record.role];
    if (
      !colorStyle ||
      !doesPlanChangeProperty(plan, `paint.${colorStyle.property}`) ||
      record.primitive.appearance?.translucent !== false
    ) {
      continue;
    }
    const value = styleRule.paint?.[colorStyle.property];
    if (
      hasTranslucentRecordColor(
        record,
        value,
        colorStyle.fallback,
        this._featureTable,
        this.buildZoom,
      )
    ) {
      return VectorTileBucketFallbackReason.RENDER_STATE;
    }
  }
  return undefined;
};

VectorTilePrimitiveBucket.prototype.applyStyle = function (
  styleRule,
  styleRevision,
  plan,
) {
  const fallbackReason = this.getStyleUpdateFallback(styleRule, plan);
  if (fallbackReason) {
    this.pendingReplacement = {
      styleRule,
      styleRevision,
      reason: fallbackReason,
    };
    return { fallbackReason, instanceUpdates: 0, pointUpdates: 0 };
  }

  this.styleRule = styleRule;
  this._rebuildFeatureStateBindings();
  this.pendingStyleRevision = styleRevision;
  this.pendingStylePlan = plan;
  const visible = styleRule.visibility !== false;
  for (const record of this.primitiveRecords) {
    record.primitive.show =
      visible && this.isPrimitiveVisible(record.primitive);
  }
  if (this._vectorTile?.primitiveStyleRules?.[this.id]) {
    this._vectorTile.primitiveStyleRules[this.id] = styleRule;
  }
  const pointBucket = this._vectorTile?.pointBuckets?.[this.id];
  if (pointBucket) {
    pointBucket.styleRule = styleRule;
    pointBucket.updateProperties = this.getPointUpdateProperties(plan);
  }

  let pointUpdates = 0;
  if (this.appliedPointStyleRevision < styleRevision) {
    pointUpdates =
      this.updatePointDescriptors?.(styleRule, styleRevision, plan) ?? 0;
    this.appliedPointStyleRevision = styleRevision;
  }

  let instanceUpdates = 0;
  let pendingReady = false;
  for (const record of this.primitiveRecords) {
    const colorStyle = COLOR_ROLE_PROPERTIES[record.role];
    if (
      !colorStyle ||
      !doesPlanChangeProperty(plan, `paint.${colorStyle.property}`)
    ) {
      continue;
    }
    const value = styleRule.paint?.[colorStyle.property];
    if (
      record.role === "fill-outline" &&
      !Object.prototype.hasOwnProperty.call(
        styleRule.paint ?? {},
        colorStyle.property,
      )
    ) {
      continue;
    }
    if (record.role === "packed-line") {
      const color = VectorTileBucketUtils.evaluateColorStyleValue(
        value,
        undefined,
        this.buildZoom,
        colorStyle.fallback,
      );
      const uniforms = record.primitive.appearance?.material?.uniforms;
      if (uniforms) {
        uniforms.color = color;
        instanceUpdates++;
      }
      continue;
    }
    if (!record.primitive.ready) {
      pendingReady = true;
      continue;
    }

    const featureIndices = record.instanceFeatureIndices ?? [];
    for (let instanceId = 0; instanceId < featureIndices.length; ++instanceId) {
      const attributes =
        record.primitive.getGeometryInstanceAttributes?.(instanceId);
      if (!attributes) {
        continue;
      }
      const feature = this._featureTable[featureIndices[instanceId]];
      const color = VectorTileBucketUtils.evaluateColorStyleValue(
        value,
        feature,
        this.buildZoom,
        colorStyle.fallback,
        {
          state: this._getFeatureStateForFeature(feature),
        },
      );
      attributes.color = ColorGeometryInstanceAttribute.toValue(
        color,
        attributes.color,
      );
      instanceUpdates++;
    }
  }

  if (!pendingReady) {
    this.appliedStyleRevision = styleRevision;
    this.pendingStyleRevision = undefined;
    this.pendingStylePlan = undefined;
    this.pendingReplacement = undefined;
    if (pointBucket) {
      pointBucket.styleRevision = styleRevision;
    }
  }
  return { pendingReady, instanceUpdates, pointUpdates };
};

VectorTilePrimitiveBucket.prototype._rebuildFeatureStateBindings = function () {
  if (this._stored) {
    this._featureStateOwner?.unregisterFeatureStateBucket?.(this);
  }
  this._featureStateBindings.clear();
  this._pendingFeatureStateKeys.clear();
  for (const record of this.primitiveRecords) {
    this._indexFeatureStateBindings(record);
  }
  if (this._stored) {
    this._featureStateOwner?.registerFeatureStateBucket?.(this);
  }
};

VectorTilePrimitiveBucket.prototype.getFeatureStateKeys = function () {
  return [...this._featureStateBindings.keys()];
};

VectorTilePrimitiveBucket.prototype.applyFeatureState = function (target) {
  const key = VectorTileFeatureStateUtils.encodeFeatureStateKey(
    target.sourceLayer,
    target.id,
  );
  const bindings = this._featureStateBindings.get(key);
  if (!bindings || bindings.length === 0) {
    return { instanceUpdates: 0, deferredUpdates: 0 };
  }

  let instanceUpdates = 0;
  let deferredUpdates = 0;
  for (const binding of bindings) {
    if (!binding.primitive.ready) {
      this._pendingFeatureStateKeys.set(key, this._featureStateStore.revision);
      deferredUpdates++;
      continue;
    }
    if (this._applyFeatureStateBinding(binding)) {
      instanceUpdates++;
    }
  }
  return { instanceUpdates, deferredUpdates };
};

VectorTilePrimitiveBucket.prototype.applyPendingFeatureStateUpdates =
  function () {
    if (this._pendingFeatureStateKeys.size === 0) {
      return { instanceUpdates: 0, deferredUpdates: 0 };
    }

    let instanceUpdates = 0;
    let remaining = 0;
    for (const key of [...this._pendingFeatureStateKeys.keys()]) {
      const bindings = this._featureStateBindings.get(key) ?? [];
      let hasPending = false;
      for (const binding of bindings) {
        if (!binding.primitive.ready) {
          hasPending = true;
          continue;
        }
        if (this._applyFeatureStateBinding(binding)) {
          instanceUpdates++;
        }
      }
      if (hasPending) {
        remaining++;
        this._pendingFeatureStateKeys.set(
          key,
          this._featureStateStore.revision,
        );
      } else {
        this._pendingFeatureStateKeys.delete(key);
      }
    }
    return { instanceUpdates, deferredUpdates: remaining };
  };

VectorTilePrimitiveBucket.prototype.destroy = function () {
  if (this._destroyed) {
    return;
  }
  this._destroyed = true;
  this.primitiveRecords.forEach(({ primitive }) => {
    this._pickRegistry?.unregister(primitive);
    if (!primitive.isDestroyed()) {
      primitive.destroy();
    }
  });
  if (this._stored) {
    this._featureStateOwner?.unregisterFeatureStateBucket?.(this);
    this._diagnostics?.addGauge("residentStyleBuckets", -1);
    this._diagnostics?.addGauge(
      "residentRenderPrimitives",
      -this.primitiveRecords.length,
    );
    this._diagnostics?.addGauge(
      "residentFeatureTableEntries",
      -this._residentFeatureTableEntries,
    );
    this._diagnostics?.addGauge(
      "residentPickPropertyValues",
      -this._residentPickPropertyValues,
    );
  }
  this.primitives.length = 0;
  this.primitiveRecords.length = 0;
  this.pointDescriptors.billboards.length = 0;
  this.pointDescriptors.labels.length = 0;
  this._featureStateBindings.clear();
  this._pendingFeatureStateKeys.clear();
};

VectorTilePrimitiveBucket.storeVectorTileBucket = function (
  vectorTile,
  bucket,
  styleRule,
) {
  if (bucket.length === 0) {
    bucket.destroy();
    return false;
  }

  bucket._stored = true;
  bucket._featureStateOwner?.registerFeatureStateBucket?.(bucket);
  vectorTile.buckets ??= {};
  vectorTile.primitives ??= {};
  vectorTile.primitiveStyleRules ??= {};
  vectorTile.buckets[bucket.id] = bucket;
  bucket._diagnostics?.addGauge("residentStyleBuckets", 1);
  bucket._diagnostics?.addGauge(
    "residentRenderPrimitives",
    bucket.primitiveRecords.length,
  );
  bucket._diagnostics?.addGauge(
    "residentFeatureTableEntries",
    bucket._residentFeatureTableEntries,
  );
  bucket._diagnostics?.addGauge(
    "residentPickPropertyValues",
    bucket._residentPickPropertyValues,
  );

  const pickContext = bucket.createPickContext();
  if (pickContext) {
    bucket.primitiveRecords.forEach((record) => {
      if (record.instanceFeatureIndices) {
        bucket._pickRegistry?.registerPrimitive(record.primitive, {
          ...pickContext,
          instanceFeatureIndices: record.instanceFeatureIndices,
        });
      }
    });
  }

  if (bucket.primitives.length > 0) {
    vectorTile.primitives[bucket.id] = bucket.primitives;
    vectorTile.primitiveStyleRules[bucket.id] = styleRule;
  }

  if (bucket.pointCount > 0) {
    if (!vectorTile.pointBuckets) {
      vectorTile.pointBuckets = {};
    }
    vectorTile.pointBuckets[bucket.id] = {
      styleRule,
      descriptors: bucket.pointDescriptors,
      pickContext,
      styleRevision: bucket.appliedStyleRevision,
    };
  }
  return true;
};

function doesPlanChangeProperty(plan, path) {
  return !plan?.changedPaths || plan.changedPaths.includes(path);
}

VectorTilePrimitiveBucket.prototype._indexFeatureStateBindings = function (
  record,
) {
  const colorStyle = COLOR_ROLE_PROPERTIES[record.role];
  if (
    !colorStyle ||
    record.role === "packed-line" ||
    !record.instanceFeatureIndices ||
    !VectorTileStyleExpressionUtils.hasVectorStyleFeatureStateDependency(
      this.styleRule.paint?.[colorStyle.property],
    )
  ) {
    return;
  }
  if (
    record.role === "fill-outline" &&
    !Object.prototype.hasOwnProperty.call(
      this.styleRule.paint ?? {},
      colorStyle.property,
    )
  ) {
    return;
  }

  for (
    let instanceId = 0;
    instanceId < record.instanceFeatureIndices.length;
    ++instanceId
  ) {
    const featureIndex = record.instanceFeatureIndices[instanceId];
    const feature = this._featureTable[featureIndex];
    if (!feature || feature.id === undefined || feature.id === null) {
      continue;
    }
    const key = VectorTileFeatureStateUtils.encodeFeatureStateKey(
      this.sourceLayer,
      feature.id,
    );
    let bindings = this._featureStateBindings.get(key);
    if (!bindings) {
      bindings = [];
      this._featureStateBindings.set(key, bindings);
    }
    bindings.push({
      primitive: record.primitive,
      role: record.role,
      instanceId,
      featureIndex,
      property: colorStyle.property,
      fallback: colorStyle.fallback,
    });
  }
};

VectorTilePrimitiveBucket.prototype._applyFeatureStateBinding = function (
  binding,
) {
  const attributes = binding.primitive.getGeometryInstanceAttributes?.(
    binding.instanceId,
  );
  if (!attributes) {
    return false;
  }
  const feature = this._featureTable[binding.featureIndex];
  const color = VectorTileBucketUtils.evaluateColorStyleValue(
    this.styleRule.paint?.[binding.property],
    feature,
    this.buildZoom,
    binding.fallback,
    {
      state: this._getFeatureStateForFeature(feature),
    },
  );
  attributes.color = ColorGeometryInstanceAttribute.toValue(
    color,
    attributes.color,
  );
  return true;
};

VectorTilePrimitiveBucket.prototype._getFeatureStateForFeature = function (
  feature,
) {
  if (!feature || !this._featureStateStore) {
    return {};
  }
  return this._featureStateStore.peek(this.sourceLayer, feature.id);
};

function hasTranslucentRecordColor(
  record,
  value,
  fallback,
  featureTable,
  zoom,
) {
  const featureIndices = record.instanceFeatureIndices;
  if (!featureIndices || featureIndices.length === 0) {
    return (
      VectorTileBucketUtils.evaluateColorStyleValue(
        value,
        undefined,
        zoom,
        fallback,
      ).alpha < 1
    );
  }
  for (const featureIndex of featureIndices) {
    if (
      VectorTileBucketUtils.evaluateColorStyleValue(
        value,
        featureTable[featureIndex],
        zoom,
        fallback,
      ).alpha < 1
    ) {
      return true;
    }
  }
  return false;
}
