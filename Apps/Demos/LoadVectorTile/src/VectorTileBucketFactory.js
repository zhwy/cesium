import { getWebMercatorTileBounds } from "./VectorTileGeometryUtils.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";
import VectorTileFillBucket from "./VectorTileFillBucket.js";
import VectorTileLineBucket from "./VectorTileLineBucket.js";
import VectorTileSymbolBucket from "./VectorTileSymbolBucket.js";

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
  } else if (styleRule.type === "line") {
    bucket = new VectorTileLineBucket(styleRule, options).build(
      packedLayer.lines,
      zoom,
    );
  } else if (styleRule.type === "symbol") {
    bucket = new VectorTileSymbolBucket(styleRule, options).build(
      packedLayer.points,
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
