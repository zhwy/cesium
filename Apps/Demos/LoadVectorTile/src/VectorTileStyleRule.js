import CommonUtils from "./CommonUtils.js";

/**
 * 一条外部样式文档图层在运行时的 Cesium 侧表示。
 * 外部文档继续沿用类似 Mapbox 的 `layers` 结构，运行时则将每一项视作可挂接到
 * `VectorTileProvider` 上的样式规则。
 *
 * @param {object} layer 图层定义对象。
 * @param {string} layer.id 图层唯一标识。
 * @param {string} layer.type 图层类型，如 `fill`、`line`、`symbol`、`circle`。
 * @param {string} layer.source 源数据标识。
 * @param {string} layer.sourceLayer 源中的图层名。
 * @param {number} [layer.minzoom] 最小显示缩放级别。
 * @param {number} [layer.maxzoom] 最大显示缩放级别。
 * @param {*} [layer.filter] 过滤表达式。
 * @param {object} [layer.layout] 布局样式。
 * @param {object} [layer.paint] 绘制样式。
 * @param {object} [layer.terrain] 地形相关配置。
 * @param {boolean} [layer.visibility=true] 是否可见。
 * @param {object} [layer.metadata] 自定义元数据。
 */
class VectorTileStyleRule {
  constructor(layer) {
    this.id = layer.id;
    this.type = layer.type;
    this.source = layer.source;
    this.sourceLayer = layer.sourceLayer;
    this.minzoom = layer.minzoom;
    this.maxzoom = layer.maxzoom;
    this.filter = CommonUtils.cloneValue(layer.filter);
    this.layout = CommonUtils.cloneValue(layer.layout ?? {});
    this.paint = CommonUtils.cloneValue(layer.paint ?? {});
    this.terrain = CommonUtils.cloneValue(layer.terrain ?? {});
    this.visibility = layer.visibility ?? true;
    this.metadata = CommonUtils.cloneValue(layer.metadata ?? {});
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      source: this.source,
      sourceLayer: this.sourceLayer,
      minzoom: this.minzoom,
      maxzoom: this.maxzoom,
      filter: CommonUtils.cloneValue(this.filter),
      layout: CommonUtils.cloneValue(this.layout),
      paint: CommonUtils.cloneValue(this.paint),
      terrain: CommonUtils.cloneValue(this.terrain),
      visibility: this.visibility,
      metadata: CommonUtils.cloneValue(this.metadata),
    };
  }
}

export default VectorTileStyleRule;
