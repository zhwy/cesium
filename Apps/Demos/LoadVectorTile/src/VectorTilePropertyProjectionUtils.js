import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";

export default class VectorTilePropertyProjectionUtils {
  /**
   * 为 Worker 生成按 source-layer 分组的长期属性投影配置。
   * `style` 与 `pick` 保持分离，`retainAll/properties` 是两者的驻留并集。
   *
   * @param {object} styleDocument 已规范化样式文档。
   * @param {object} [options={}] source 运行时选项。
   * @param {boolean} [options.allowPicking=false] 是否启用拾取。
   * @param {string[]} [options.pickProperties] 公开拾取字段。
   * @returns {object}
   */
  static createVectorTilePropertyProjections(styleDocument, options = {}) {
    const layersBySourceLayer = new Map();
    for (const layer of styleDocument?.layers ?? []) {
      let layers = layersBySourceLayer.get(layer.sourceLayer);
      if (!layers) {
        layers = [];
        layersBySourceLayer.set(layer.sourceLayer, layers);
      }
      layers.push(layer);
    }

    const allowPicking = options.allowPicking === true;
    const pickProperties = options.pickProperties;
    const pickAll = allowPicking && pickProperties === undefined;
    const pickFields = allowPicking ? (pickProperties ?? []) : [];
    const result = {};

    for (const [sourceLayer, layers] of layersBySourceLayer) {
      const style =
        VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies(
          ...layers.flatMap((layer) => [
            layer.filter,
            ...Object.values(layer.paint ?? {}),
            ...Object.values(layer.layout ?? {}),
          ]),
        );
      const retainAll = style.all || pickAll;
      const retainedProperties = new Set(style.properties);
      if (!retainAll) {
        pickFields.forEach((propertyName) =>
          retainedProperties.add(propertyName),
        );
      }

      result[sourceLayer] = {
        retainAll,
        properties: retainAll ? [] : [...retainedProperties].sort(),
        style,
        pick: {
          enabled: allowPicking,
          all: pickAll,
          properties: pickAll ? [] : [...pickFields],
        },
      };
    }
    return result;
  }

  static projectVectorTileProperties(properties, projection) {
    if (projection?.retainAll) {
      return { ...(properties ?? {}) };
    }

    const result = {};
    const source = properties ?? {};
    for (const propertyName of projection?.properties ?? []) {
      if (Object.prototype.hasOwnProperty.call(source, propertyName)) {
        result[propertyName] = source[propertyName];
      }
    }
    return result;
  }

  static getPublicPickProperties(properties, pickProperties) {
    if (pickProperties === undefined) {
      return { ...(properties ?? {}) };
    }

    const result = {};
    const source = properties ?? {};
    for (const propertyName of pickProperties) {
      if (Object.prototype.hasOwnProperty.call(source, propertyName)) {
        result[propertyName] = source[propertyName];
      }
    }
    return result;
  }
}
