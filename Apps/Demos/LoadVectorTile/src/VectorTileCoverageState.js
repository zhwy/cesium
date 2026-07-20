/**
 * 矢量瓦片覆盖状态枚举。
 *
 * @enum {string}
 */
const VectorTileCoverageState = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  READY_EMPTY: "ready-empty",
  FAILED: "failed",
  CANCELLED: "cancelled",
  UNAVAILABLE: "unavailable",
});

export default VectorTileCoverageState;
