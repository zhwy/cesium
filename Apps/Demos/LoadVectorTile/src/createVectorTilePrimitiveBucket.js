import { getWebMercatorTileBounds } from "./VectorTileGeometryUtils.js";
import {
  createPolygonCenterPoints,
  getStyleRuleSymbolPlacement,
} from "./VectorTileGeometryPlacement.js";
import VectorTileCircleBucket from "./VectorTileCircleBucket.js";
import VectorTileFillBucket from "./VectorTileFillBucket.js";
import VectorTileLineBucket from "./VectorTileLineBucket.js";
import VectorTileSymbolBucket from "./VectorTileSymbolBucket.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";

export default function createVectorTilePrimitiveBucket(
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
      { lines: packedLayer.lines, tileBounds },
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
