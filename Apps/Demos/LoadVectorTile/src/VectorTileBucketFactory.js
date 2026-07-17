import createPrimitiveBucket from "./createVectorTilePrimitiveBucket.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";

function createVectorTilePrimitiveBucket(
  packedLayer,
  styleRule,
  zoom,
  options = {},
) {
  return createPrimitiveBucket(packedLayer, styleRule, zoom, {
    ...options,
    featureTable: options.featureTable ?? packedLayer?.features,
  });
}

function storeVectorTileBucket(vectorTile, bucket, styleRule) {
  if (typeof bucket?.createPickContext === "function") {
    return VectorTilePrimitiveBucket.storeVectorTileBucket(
      vectorTile,
      bucket,
      styleRule,
    );
  }
  if (!bucket || bucket.length === 0) {
    bucket?.destroy?.();
    return false;
  }
  vectorTile.primitives ??= {};
  vectorTile.primitiveStyleRules ??= {};
  if ((bucket.primitives?.length ?? 0) > 0) {
    vectorTile.primitives[bucket.id] = bucket.primitives;
    vectorTile.primitiveStyleRules[bucket.id] = styleRule;
  }
  const pointCount =
    bucket.pointCount ??
    (bucket.pointDescriptors?.billboards?.length ?? 0) +
      (bucket.pointDescriptors?.labels?.length ?? 0);
  if (pointCount > 0) {
    vectorTile.pointBuckets ??= {};
    vectorTile.pointBuckets[bucket.id] = {
      styleRule,
      descriptors: bucket.pointDescriptors,
      styleRevision: bucket.appliedStyleRevision ?? 0,
    };
  }
  return true;
}

export {
  createVectorTilePrimitiveBucket,
  storeVectorTileBucket,
  VectorTilePrimitiveBucket,
};

export default createVectorTilePrimitiveBucket;
