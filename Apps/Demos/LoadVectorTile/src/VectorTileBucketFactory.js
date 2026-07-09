import { getWebMercatorTileBounds } from "./VectorTileGeometryUtils.js";
import {
  createPolygonCenterPoints,
  getStyleRuleSymbolPlacement,
} from "./VectorTileGeometryPlacement.js";
import VectorTileCircleBucket from "./VectorTileCircleBucket.js";
import VectorTileFillBucket from "./VectorTileFillBucket.js";
import VectorTileLineBucket from "./VectorTileLineBucket.js";
import VectorTileSymbolBucket from "./VectorTileSymbolBucket.js";

export function VectorTilePrimitiveBucket(styleRule) {
  this.id = styleRule.id;
  this.type = styleRule.type;
  this.sourceLayer = styleRule.sourceLayer;
  this.styleRule = styleRule;
  this.primitives = [];
}

VectorTilePrimitiveBucket.prototype.addPrimitive = function (primitive) {
  if (primitive) {
    this.primitives.push(primitive);
  }
};

VectorTilePrimitiveBucket.prototype.addPrimitives = function (primitives) {
  primitives.forEach((primitive) => this.addPrimitive(primitive));
};

Object.defineProperty(VectorTilePrimitiveBucket.prototype, "length", {
  get: function () {
    return this.primitives.length;
  },
});

VectorTilePrimitiveBucket.prototype.destroy = function () {
  this.primitives.forEach((primitive) => {
    if (!primitive.isDestroyed()) {
      primitive.destroy();
    }
  });
  this.primitives.length = 0;
};

export function createVectorTilePrimitiveBucket(
  packedLayer,
  styleRule,
  zoom,
  options = {},
) {
  const tileBounds =
    options.clipToTile && options.vectorTile
      ? getWebMercatorTileBounds(options.vectorTile)
      : undefined;
  let bucket = new VectorTilePrimitiveBucket(styleRule);

  if (styleRule.type === "fill") {
    bucket = new VectorTileFillBucket(styleRule, options).build(
      packedLayer.polygons,
      zoom,
      { tileBounds },
    );
  } else if (styleRule.type === "circle") {
    bucket = new VectorTileCircleBucket(styleRule, options).build(
      packedLayer.points,
      zoom,
    );
  } else if (styleRule.type === "line") {
    bucket = new VectorTileLineBucket(styleRule, options).build(
      packedLayer.lines,
      zoom,
      {
        polygons: packedLayer.polygons,
        tileBounds,
      },
    );
  } else if (styleRule.type === "symbol") {
    const symbolPlacement = getStyleRuleSymbolPlacement(styleRule);
    bucket = new VectorTileSymbolBucket(styleRule, options).build(
      symbolPlacement === "polygon-center"
        ? createPolygonCenterPoints(packedLayer.polygons)
        : packedLayer.points,
      zoom,
    );
  }

  if (bucket.length > 0) {
    options.diagnostics?.increment("primitiveBuckets");
  }
  return bucket;
}

export function storeVectorTileBucket(vectorTile, bucket, styleRule) {
  if (bucket.length === 0) {
    return false;
  }

  vectorTile.primitives[bucket.id] = bucket.primitives;
  vectorTile.primitiveStyleRules[bucket.id] = styleRule;
  return true;
}
