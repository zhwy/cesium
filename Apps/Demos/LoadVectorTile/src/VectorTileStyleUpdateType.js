/**
 * 样式更新计划的类型枚举。
 *
 * @enum {string}
 */
const VectorTileStyleUpdateType = Object.freeze({
  NO_OP: "NO_OP",
  IN_PLACE_APPEARANCE: "IN_PLACE_APPEARANCE",
  REBUILD_BUCKET: "REBUILD_BUCKET",
  REBUILD_SOURCE: "REBUILD_SOURCE",
});

export default VectorTileStyleUpdateType;
