import Cartesian2 from "../../../../packages/engine/Source/Core/Cartesian2.js";
import Cartesian3 from "../../../../packages/engine/Source/Core/Cartesian3.js";
import defined from "../../../../packages/engine/Source/Core/defined.js";
import HeightReference from "../../../../packages/engine/Source/Scene/HeightReference.js";
import HorizontalOrigin from "../../../../packages/engine/Source/Scene/HorizontalOrigin.js";
import LabelStyle from "../../../../packages/engine/Source/Scene/LabelStyle.js";
import VerticalOrigin from "../../../../packages/engine/Source/Scene/VerticalOrigin.js";
import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";
import VectorTileBucketUtils from "./VectorTileBucketUtils.js";

const SYMBOL_ANCHOR_MAP = Object.freeze({
  center: {
    horizontalOrigin: "CENTER",
    verticalOrigin: "CENTER",
  },
  left: {
    horizontalOrigin: "LEFT",
    verticalOrigin: "CENTER",
  },
  right: {
    horizontalOrigin: "RIGHT",
    verticalOrigin: "CENTER",
  },
  top: {
    horizontalOrigin: "CENTER",
    verticalOrigin: "TOP",
  },
  bottom: {
    horizontalOrigin: "CENTER",
    verticalOrigin: "BOTTOM",
  },
  "top-left": {
    horizontalOrigin: "LEFT",
    verticalOrigin: "TOP",
  },
  "top-right": {
    horizontalOrigin: "RIGHT",
    verticalOrigin: "TOP",
  },
  "bottom-left": {
    horizontalOrigin: "LEFT",
    verticalOrigin: "BOTTOM",
  },
  "bottom-right": {
    horizontalOrigin: "RIGHT",
    verticalOrigin: "BOTTOM",
  },
});

/**
 * 面向 Cesium 的 `symbol` 渲染桶，对单条样式规则在单个矢量瓦片上的结果进行收集。
 *
 * 该桶不会生成几何实例，而是输出 Cesium 集合描述：
 * 图标走 `BillboardCollection`，文本走 `LabelCollection`。当前实现刻意不处理
 * 碰撞检测与避让逻辑。
 *
 * @param {object} styleRule 当前桶对应的样式规则。
 * @param {object} [options={}] 构造参数。
 * @param {Scene} [options.scene] Cesium 场景，用于解析图标尺寸等上下文。
 * @param {Function} [options.iconResolver] 图标解析函数，负责把样式中的图标引用映射到资源。
 * @param {boolean} [options.allowPicking=false] 是否为生成的图元启用拾取。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器，用于记录符号桶指标。
 * @param {boolean} [options.ignoreZoomRange=false] 是否忽略样式规则中的缩放级别限制。
 */
class VectorTileSymbolBucket extends VectorTilePrimitiveBucket {
  static createVectorTileIconResolver(...registries) {
    return createVectorTileIconResolver(...registries);
  }

  constructor(styleRule, options = {}) {
    super(styleRule, options);
    this._scene = options.scene;
    this._iconResolver = options.iconResolver ?? createVectorTileIconResolver();
    this._allowPicking = options.allowPicking ?? false;
    this._diagnostics = options.diagnostics;
    this._ignoreZoomRange = options.ignoreZoomRange ?? false;
  }

  build(points, zoom) {
    const positions = points?.positions ?? [];
    let billboardCount = 0;
    let labelCount = 0;

    for (let i = 0; i < positions.length / 2; ++i) {
      const pointMetadata = VectorTileBucketUtils.getGeometryFeature(
        this._featureTable,
        points,
        i,
      );
      const featureIndex = VectorTileBucketUtils.getGeometryFeatureIndex(
        points,
        i,
      );
      if (
        !doesSymbolStyleRuleMatchMetadata(pointMetadata, this.styleRule, zoom, {
          ignoreZoomRange: this._ignoreZoomRange,
        })
      ) {
        continue;
      }

      const position = Cartesian3.fromDegrees(
        positions[i * 2],
        positions[i * 2 + 1],
        VectorTileBucketUtils.getStyleRuleHeightOffset(this.styleRule),
      );

      const billboardOptions = createBillboardOptions(
        this._scene,
        position,
        pointMetadata,
        this.styleRule,
        zoom,
        this._iconResolver,
        this._allowPicking,
        featureIndex,
      );
      if (billboardOptions) {
        this.addBillboardDescriptor(billboardOptions, featureIndex);
        billboardCount++;
      }

      const labelOptions = createLabelOptions(
        this._scene,
        position,
        pointMetadata,
        this.styleRule,
        zoom,
        this._allowPicking,
        featureIndex,
      );
      if (labelOptions) {
        this.addLabelDescriptor(labelOptions, featureIndex);
        labelCount++;
      }
    }

    this._diagnostics?.increment("symbolBillboards", billboardCount);
    this._diagnostics?.increment("symbolLabels", labelCount);
    return this;
  }

  getPointStyleValues(styleRule, plan) {
    const values = [];
    for (const propertyName of [
      "text-color",
      "text-halo-color",
      "text-background-color",
    ]) {
      if (doesPlanChangeProperty(plan, `paint.${propertyName}`)) {
        values.push(styleRule.paint?.[propertyName]);
      }
    }
    return values;
  }

  getPointUpdateProperties(plan) {
    const properties = [];
    if (doesPlanChangeProperty(plan, "paint.text-color")) {
      properties.push("fillColor");
    }
    if (doesPlanChangeProperty(plan, "paint.text-halo-color")) {
      properties.push("outlineColor");
    }
    if (doesPlanChangeProperty(plan, "paint.text-background-color")) {
      properties.push("showBackground", "backgroundColor");
    }
    if (doesPlanChangeProperty(plan, "visibility")) {
      properties.push("show");
    }
    return properties;
  }

  updatePointDescriptors(styleRule, _styleRevision, plan) {
    const updateFill = doesPlanChangeProperty(plan, "paint.text-color");
    const updateOutline = doesPlanChangeProperty(plan, "paint.text-halo-color");
    const updateBackground = doesPlanChangeProperty(
      plan,
      "paint.text-background-color",
    );
    const updateVisibility = doesPlanChangeProperty(plan, "visibility");
    if (
      !updateFill &&
      !updateOutline &&
      !updateBackground &&
      !updateVisibility
    ) {
      return 0;
    }

    const visible = styleRule.visibility !== false;
    for (const descriptor of this.pointDescriptors.billboards) {
      descriptor.show = visible;
    }
    for (const descriptor of this.pointDescriptors.labels) {
      const feature = this._featureTable[descriptor._vectorTileFeatureIndex];
      if (updateFill) {
        descriptor.fillColor = VectorTileBucketUtils.evaluateColorStyleValue(
          styleRule.paint?.["text-color"],
          feature,
          this.buildZoom,
          "#ffffffff",
        );
      }
      if (updateOutline) {
        descriptor.outlineColor = VectorTileBucketUtils.evaluateColorStyleValue(
          styleRule.paint?.["text-halo-color"],
          feature,
          this.buildZoom,
          "#000000ff",
        );
      }
      if (updateBackground) {
        const backgroundColorValue = evaluateSymbolStyleValue(
          styleRule.paint?.["text-background-color"],
          feature,
          this.buildZoom,
        );
        descriptor.showBackground =
          defined(backgroundColorValue) && backgroundColorValue !== "";
        descriptor.backgroundColor = VectorTileBucketUtils.parseCesiumColor(
          backgroundColorValue,
          "#00000000",
        );
      }
      descriptor.show = visible;
    }
    return (
      this.pointDescriptors.billboards.length +
      this.pointDescriptors.labels.length
    );
  }
}

function createVectorTileIconResolver(...registries) {
  const mergedRegistry = Object.assign({}, ...registries.filter(Boolean));
  return (iconImage) =>
    resolveVectorTileIconResource(iconImage, mergedRegistry);
}

function resolveVectorTileIconResource(iconImage, registry = {}) {
  if (!defined(iconImage)) {
    return undefined;
  }
  if (
    typeof iconImage === "string" &&
    Object.prototype.hasOwnProperty.call(registry, iconImage)
  ) {
    return registry[iconImage];
  }
  return iconImage;
}

function evaluateSymbolStyleValue(value, metadata, zoom, fallback) {
  return VectorTileBucketUtils.evaluateStyleValue(
    value,
    metadata,
    zoom,
    fallback,
  );
}

function translateSymbolAnchor(anchorValue, fallback = "center") {
  const anchor =
    typeof anchorValue === "string" &&
    Object.prototype.hasOwnProperty.call(SYMBOL_ANCHOR_MAP, anchorValue)
      ? anchorValue
      : fallback;
  const origins = SYMBOL_ANCHOR_MAP[anchor] ?? SYMBOL_ANCHOR_MAP.center;
  return {
    horizontalOrigin: HorizontalOrigin[origins.horizontalOrigin],
    verticalOrigin: VerticalOrigin[origins.verticalOrigin],
  };
}

function createSymbolPixelOffset(value, metadata, zoom) {
  const offset = evaluateSymbolStyleValue(value, metadata, zoom);
  if (!Array.isArray(offset) || offset.length < 2) {
    return new Cartesian2(0, 0);
  }

  const x = Number(offset[0]);
  const y = Number(offset[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return new Cartesian2(0, 0);
  }
  return new Cartesian2(x, y);
}

function createSymbolBackgroundPadding(value, metadata, zoom) {
  const padding = evaluateSymbolStyleValue(value, metadata, zoom);
  if (!defined(padding)) {
    return new Cartesian2(0, 0);
  }

  if (Array.isArray(padding)) {
    const x = Number(padding[0]);
    const y = Number(padding[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return new Cartesian2(0, 0);
    }
    return new Cartesian2(x, y);
  }

  const uniform = Number(padding);
  if (!Number.isFinite(uniform)) {
    return new Cartesian2(0, 0);
  }
  return new Cartesian2(uniform, uniform);
}

function createBillboardOptions(
  scene,
  position,
  metadata,
  styleRule,
  zoom,
  resolveIcon,
  allowPicking,
  featureIndex,
) {
  const iconImageValue = evaluateSymbolStyleValue(
    styleRule.layout?.["icon-image"],
    metadata,
    zoom,
  );
  const image = resolveIcon(iconImageValue);
  if (!defined(image) || image === "") {
    return undefined;
  }

  return {
    position,
    image,
    heightReference: getSymbolHeightReference(scene, styleRule),
    disableDepthTestDistance: getSymbolDisableDepthTestDistance(styleRule),
    scale: VectorTileBucketUtils.evaluateFiniteStyleNumber(
      styleRule.layout?.["icon-size"],
      metadata,
      zoom,
      1,
    ),
    width: VectorTileBucketUtils.evaluateFiniteStyleNumber(
      styleRule.layout?.["icon-width"],
      metadata,
      zoom,
      undefined,
    ),
    height: VectorTileBucketUtils.evaluateFiniteStyleNumber(
      styleRule.layout?.["icon-height"],
      metadata,
      zoom,
      undefined,
    ),
    pixelOffset: createSymbolPixelOffset(
      styleRule.layout?.["icon-offset"],
      metadata,
      zoom,
    ),
    ...translateSymbolAnchor(
      evaluateSymbolStyleValue(
        styleRule.layout?.["icon-anchor"],
        metadata,
        zoom,
        "center",
      ),
    ),
    id: allowPicking ? featureIndex : undefined,
  };
}

function createLabelOptions(
  scene,
  position,
  metadata,
  styleRule,
  zoom,
  allowPicking,
  featureIndex,
) {
  const textValue = evaluateSymbolStyleValue(
    styleRule.layout?.["text-field"],
    metadata,
    zoom,
  );
  if (!defined(textValue) || textValue === "") {
    return undefined;
  }

  const textSize = VectorTileBucketUtils.evaluateFiniteStyleNumber(
    styleRule.layout?.["text-size"],
    metadata,
    zoom,
    16,
  );
  const outlineWidth = VectorTileBucketUtils.evaluateFiniteStyleNumber(
    styleRule.paint?.["text-halo-width"],
    metadata,
    zoom,
    0,
  );
  const backgroundColorValue = evaluateSymbolStyleValue(
    styleRule.paint?.["text-background-color"],
    metadata,
    zoom,
  );
  const anchorValue = evaluateSymbolStyleValue(
    styleRule.layout?.["text-anchor"],
    metadata,
    zoom,
    "center",
  );

  return {
    position,
    text: String(textValue),
    font: createLabelFont(styleRule, metadata, zoom, textSize),
    fillColor: VectorTileBucketUtils.evaluateColorStyleValue(
      styleRule.paint?.["text-color"],
      metadata,
      zoom,
      "#ffffffff",
    ),
    outlineColor: VectorTileBucketUtils.evaluateColorStyleValue(
      styleRule.paint?.["text-halo-color"],
      metadata,
      zoom,
      "#000000ff",
    ),
    outlineWidth,
    style: outlineWidth > 0 ? LabelStyle.FILL_AND_OUTLINE : LabelStyle.FILL,
    heightReference: getSymbolHeightReference(scene, styleRule),
    disableDepthTestDistance: getSymbolDisableDepthTestDistance(styleRule),
    pixelOffset: createSymbolPixelOffset(
      styleRule.layout?.["text-offset"],
      metadata,
      zoom,
    ),
    showBackground:
      defined(backgroundColorValue) && backgroundColorValue !== "",
    backgroundColor: VectorTileBucketUtils.parseCesiumColor(
      backgroundColorValue,
      "#00000000",
    ),
    backgroundPadding: createSymbolBackgroundPadding(
      styleRule.paint?.["text-background-padding"],
      metadata,
      zoom,
    ),
    ...translateSymbolAnchor(anchorValue),
    id: allowPicking ? featureIndex : undefined,
  };
}

function doesSymbolStyleRuleMatchMetadata(
  metadata,
  styleRule,
  zoom,
  options = {},
) {
  return (
    (options.ignoreZoomRange ||
      VectorTileBucketUtils.isZoomInRange(zoom, styleRule)) &&
    VectorTileStyleExpressionUtils.evaluateVectorStyleFilter(
      styleRule.filter,
      metadata,
      { zoom, level: zoom },
    )
  );
}

function getSymbolHeightReference(scene, styleRule) {
  if (styleRule.terrain?.clampToGround !== true || !defined(scene)) {
    return HeightReference.NONE;
  }
  return VectorTileBucketUtils.getStyleRuleHeightOffset(styleRule) === 0.0
    ? HeightReference.CLAMP_TO_GROUND
    : HeightReference.RELATIVE_TO_GROUND;
}

function getSymbolDisableDepthTestDistance(styleRule) {
  return Number.isNaN(Number(styleRule.terrain?.disableDepthTestDistance))
    ? undefined
    : Number(styleRule.terrain.disableDepthTestDistance);
}

function createLabelFont(styleRule, metadata, zoom, textSize) {
  const explicitFont = evaluateSymbolStyleValue(
    styleRule.layout?.["text-font"],
    metadata,
    zoom,
  );
  if (typeof explicitFont === "string" && explicitFont.trim().length > 0) {
    return explicitFont;
  }

  const fontFamily = evaluateSymbolStyleValue(
    styleRule.layout?.["text-font-family"],
    metadata,
    zoom,
    "sans-serif",
  );
  return `${textSize}px ${
    typeof fontFamily === "string" && fontFamily.trim().length > 0
      ? fontFamily
      : "sans-serif"
  }`;
}

function doesPlanChangeProperty(plan, path) {
  return !plan?.changedPaths || plan.changedPaths.includes(path);
}

export default VectorTileSymbolBucket;
