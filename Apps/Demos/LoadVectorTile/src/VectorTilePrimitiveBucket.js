import * as CesiumModule from "../../../../Build/CesiumUnminified/index.js";
import {
  evaluateColorStyleValue,
  isVectorStyleExpression,
} from "./VectorTileBucketUtils.js";
import { collectVectorStylePropertyDependencies } from "./VectorTileStyleExpression.js";

const Cesium = globalThis.Cesium ?? CesiumModule;

export const VectorTileBucketFallbackReason = Object.freeze({
  MISSING_PROPERTIES: "MISSING_PROPERTIES",
  RENDER_STATE: "RENDER_STATE",
  MISSING_BUCKET: "MISSING_BUCKET",
});

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
  const dependencies = collectVectorStylePropertyDependencies(...values);
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
    if (record.role === "packed-line" && isVectorStyleExpression(value)) {
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
      const color = evaluateColorStyleValue(
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
      const color = evaluateColorStyleValue(
        value,
        feature,
        this.buildZoom,
        colorStyle.fallback,
      );
      attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(
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

function hasTranslucentRecordColor(
  record,
  value,
  fallback,
  featureTable,
  zoom,
) {
  const featureIndices = record.instanceFeatureIndices;
  if (!featureIndices || featureIndices.length === 0) {
    return evaluateColorStyleValue(value, undefined, zoom, fallback).alpha < 1;
  }
  for (const featureIndex of featureIndices) {
    if (
      evaluateColorStyleValue(value, featureTable[featureIndex], zoom, fallback)
        .alpha < 1
    ) {
      return true;
    }
  }
  return false;
}
