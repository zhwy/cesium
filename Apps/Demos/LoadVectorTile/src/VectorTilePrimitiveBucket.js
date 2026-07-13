/**
 * 单条样式规则在单个矢量瓦片上的基础渲染桶，负责收集图元与共享点描述。
 *
 * @param {VectorTileStyleRule} styleRule 当前渲染桶对应的样式规则。
 */
export default function VectorTilePrimitiveBucket(styleRule) {
  this.id = styleRule.id;
  this.type = styleRule.type;
  this.sourceLayer = styleRule.sourceLayer;
  this.styleRule = styleRule;
  this.primitives = [];
  this.pointDescriptors = {
    billboards: [],
    labels: [],
  };
}

VectorTilePrimitiveBucket.prototype.addPrimitive = function (primitive) {
  if (primitive) {
    this.primitives.push(primitive);
  }
};

VectorTilePrimitiveBucket.prototype.addPrimitives = function (primitives) {
  primitives.forEach((primitive) => this.addPrimitive(primitive));
};

VectorTilePrimitiveBucket.prototype.addBillboardDescriptor = function (
  descriptor,
) {
  if (descriptor) {
    this.pointDescriptors.billboards.push(descriptor);
  }
};

VectorTilePrimitiveBucket.prototype.addLabelDescriptor = function (descriptor) {
  if (descriptor) {
    this.pointDescriptors.labels.push(descriptor);
  }
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

VectorTilePrimitiveBucket.prototype.destroy = function () {
  this.primitives.forEach((primitive) => {
    if (!primitive.isDestroyed()) {
      primitive.destroy();
    }
  });
  this.primitives.length = 0;
  this.pointDescriptors.billboards.length = 0;
  this.pointDescriptors.labels.length = 0;
};

VectorTilePrimitiveBucket.storeVectorTileBucket = function (
  vectorTile,
  bucket,
  styleRule,
) {
  if (bucket.length === 0) {
    return false;
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
    };
  }
  return true;
};
