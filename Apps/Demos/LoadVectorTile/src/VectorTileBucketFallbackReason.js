/**
 * 样式增量更新回退到重建渲染桶的原因枚举。
 *
 * @enum {string}
 */
const VectorTileBucketFallbackReason = Object.freeze({
  MISSING_PROPERTIES: "MISSING_PROPERTIES",
  RENDER_STATE: "RENDER_STATE",
  MISSING_BUCKET: "MISSING_BUCKET",
});

export default VectorTileBucketFallbackReason;
