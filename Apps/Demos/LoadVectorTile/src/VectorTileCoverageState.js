/**
 * 矢量瓦片覆盖状态枚举，独立于 Cesium ImageryState，用于覆盖集合解析和父子替换判断。
 *
 * @alias VectorTileCoverageState
 * @private
 *
 * @property {string} PENDING       瓦片请求尚未完成，覆盖不完整，允许父级兜底。
 * @property {string} READY         瓦片已完成加载且包含可绘制要素，覆盖完整，不需父级兜底。
 * @property {string} READY_EMPTY   瓦片已完成加载但无可绘制要素（合法空瓦片），覆盖完整，不需父级兜底。
 * @property {string} FAILED        网络请求或解码失败，覆盖不完整，允许父级兜底。
 * @property {string} CANCELLED     任务被取消，覆盖不完整，允许父级兜底。
 * @property {string} UNAVAILABLE   瓦片超出图层可用层级范围，覆盖视为完整，父级兜底行为由图层层级规则决定。
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
