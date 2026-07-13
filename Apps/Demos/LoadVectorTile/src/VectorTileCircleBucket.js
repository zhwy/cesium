import * as CesiumModule from "../../../../Build/CesiumUnminified/index.js";
import { VectorTilePrimitiveBucket } from "./VectorTileBucketFactory.js";
import {
  doesStyleRuleMatchMetadata,
  evaluateStyleValue,
  getStyleRuleHeightOffset,
  isDefined,
} from "./VectorTileBucketUtils.js";

const Cesium = globalThis.Cesium ?? CesiumModule;

const DEFAULT_CIRCLE_RADIUS = 5;
const DEFAULT_CIRCLE_COLOR = "#000000ff";

/**
 * 为 `circle` 类型样式规则构建点图元描述，输出可复用的公告牌配置。
 *
 * @param {object} styleRule 当前桶对应的样式规则。
 * @param {object} [options={}] 构造参数。
 * @param {Cesium.Scene} [options.scene] Cesium 场景，用于创建圆点贴图资源。
 * @param {boolean} [options.allowPicking=false] 是否为生成的图元启用拾取。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器，用于记录圆点桶指标。
 * @param {boolean} [options.ignoreZoomRange=false] 是否忽略样式规则中的缩放级别限制。
 */
export default class VectorTileCircleBucket extends VectorTilePrimitiveBucket {
  constructor(styleRule, options = {}) {
    super(styleRule);
    this._scene = options.scene;
    this._allowPicking = options.allowPicking ?? false;
    this._diagnostics = options.diagnostics;
    this._ignoreZoomRange = options.ignoreZoomRange ?? false;
    this._imageCache = new Map();
  }

  build(points, zoom) {
    const positions = points?.positions ?? [];
    const metadata = points?.metadata ?? [];
    let billboardCount = 0;

    for (let i = 0; i < positions.length / 2; ++i) {
      const pointMetadata = metadata[i];
      if (
        !doesStyleRuleMatchMetadata(pointMetadata, 1, this.styleRule, zoom, {
          ignoreZoomRange: this._ignoreZoomRange,
        })
      ) {
        continue;
      }

      const position = Cesium.Cartesian3.fromDegrees(
        positions[i * 2],
        positions[i * 2 + 1],
        getStyleRuleHeightOffset(this.styleRule),
      );

      const billboardOptions = createCircleBillboardOptions(
        this._scene,
        position,
        pointMetadata,
        this.styleRule,
        zoom,
        this._imageCache,
        this._allowPicking,
      );
      if (!billboardOptions) {
        continue;
      }

      this.addBillboardDescriptor(billboardOptions);
      billboardCount++;
    }

    this._diagnostics?.increment("circleBillboards", billboardCount);
    return this;
  }
}

export function evaluateCircleStyleValue(
  primaryValue,
  aliasValue,
  metadata,
  zoom,
) {
  return evaluateStyleValue(
    isDefined(primaryValue) ? primaryValue : aliasValue,
    metadata,
    zoom,
  );
}

export function evaluateCircleColorValue(
  primaryValue,
  aliasValue,
  metadata,
  zoom,
  fallback,
) {
  const color = evaluateCircleStyleValue(
    primaryValue,
    aliasValue,
    metadata,
    zoom,
  );
  return typeof color === "string" && color.length > 0 ? color : fallback;
}

export function resolveCircleRadius(
  styleRule,
  metadata,
  zoom,
  fallback = DEFAULT_CIRCLE_RADIUS,
) {
  const paint = styleRule?.paint ?? {};
  if (isDefined(paint["circle-radius"])) {
    return normalizeCircleRadius(
      Number(
        evaluateStyleValue(paint["circle-radius"], metadata, zoom, fallback),
      ),
      fallback,
    );
  }

  if (isDefined(paint.pixelSize)) {
    const pixelSize = Number(
      evaluateStyleValue(paint.pixelSize, metadata, zoom, fallback * 2),
    );
    if (!Number.isFinite(pixelSize)) {
      return fallback;
    }
    return Math.max(0, pixelSize / 2);
  }

  return fallback;
}

export function resolveCirclePixelSize(
  styleRule,
  metadata,
  zoom,
  fallback = DEFAULT_CIRCLE_RADIUS,
) {
  return resolveCircleRadius(styleRule, metadata, zoom, fallback) * 2;
}

export function createCirclePixelOffset(
  primaryValue,
  aliasValue,
  metadata,
  zoom,
) {
  const offset = evaluateCircleStyleValue(
    primaryValue,
    aliasValue,
    metadata,
    zoom,
  );
  if (!Array.isArray(offset) || offset.length < 2) {
    return undefined;
  }

  const x = Number(offset[0]);
  const y = Number(offset[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }

  return new Cesium.Cartesian2(x, y);
}

export function getCircleHeightReference(scene, styleRule) {
  if (styleRule.terrain?.clampToGround !== true || !isDefined(scene)) {
    return Cesium.HeightReference.NONE;
  }
  return getStyleRuleHeightOffset(styleRule) === 0.0
    ? Cesium.HeightReference.CLAMP_TO_GROUND
    : Cesium.HeightReference.RELATIVE_TO_GROUND;
}

export function createCircleCanvas(
  pixelSize,
  fillColor,
  outlineColor,
  outlineWidth,
) {
  const drawSize = Math.max(1, Math.ceil(pixelSize));
  const canvas = createCanvasElement(drawSize, drawSize);
  canvas.width = drawSize;
  canvas.height = drawSize;
  canvas._vectorTileCircle = {
    pixelSize,
    fillColor,
    outlineColor,
    outlineWidth,
  };

  const context = canvas.getContext?.("2d");
  if (!context) {
    return canvas;
  }

  const center = drawSize / 2;
  const outerRadius = pixelSize / 2;
  const normalizedOutlineWidth = normalizeOutlineWidth(outlineWidth);
  const hasOutline =
    normalizedOutlineWidth > 0 &&
    typeof outlineColor === "string" &&
    outlineColor.length > 0;

  context.clearRect(0, 0, drawSize, drawSize);

  if (hasOutline) {
    fillCircle(context, center, outerRadius, outlineColor);
    const innerRadius = Math.max(0, outerRadius - normalizedOutlineWidth);
    if (innerRadius > 0) {
      fillCircle(context, center, innerRadius, fillColor);
    }
  } else {
    fillCircle(context, center, outerRadius, fillColor);
  }

  return canvas;
}

function createCircleBillboardOptions(
  scene,
  position,
  metadata,
  styleRule,
  zoom,
  imageCache,
  allowPicking,
) {
  const pixelSize = resolveCirclePixelSize(styleRule, metadata, zoom);
  if (!Number.isFinite(pixelSize) || pixelSize <= 0) {
    return undefined;
  }

  const fillColor = evaluateCircleColorValue(
    styleRule.paint?.["circle-color"],
    styleRule.paint?.color,
    metadata,
    zoom,
    DEFAULT_CIRCLE_COLOR,
  );
  const outlineColor = evaluateCircleColorValue(
    styleRule.paint?.["circle-outline-color"],
    styleRule.paint?.outlineColor,
    metadata,
    zoom,
    "",
  );
  const outlineWidth = normalizeOutlineWidth(
    Number(
      evaluateCircleStyleValue(
        styleRule.paint?.["circle-outline-width"],
        styleRule.paint?.outlineWidth,
        metadata,
        zoom,
      ),
    ),
  );
  const image = getCachedCircleImage(
    imageCache,
    pixelSize,
    fillColor,
    outlineColor,
    outlineWidth,
  );

  return {
    position,
    image,
    width: pixelSize,
    height: pixelSize,
    heightReference: getCircleHeightReference(scene, styleRule),
    disableDepthTestDistance: getCircleDisableDepthTestDistance(styleRule),
    pixelOffset: createCirclePixelOffset(
      styleRule.paint?.["circle-offset"],
      styleRule.paint?.offset,
      metadata,
      zoom,
    ),
    id: allowPicking ? { ...metadata, layerId: styleRule.id } : undefined,
  };
}

function getCachedCircleImage(
  imageCache,
  pixelSize,
  fillColor,
  outlineColor,
  outlineWidth,
) {
  const cacheKey = [pixelSize, fillColor, outlineColor, outlineWidth].join("|");
  let image = imageCache.get(cacheKey);
  if (!image) {
    image = createCircleCanvas(
      pixelSize,
      fillColor,
      outlineColor,
      outlineWidth,
    );
    imageCache.set(cacheKey, image);
  }
  return image;
}

function getCircleDisableDepthTestDistance(styleRule) {
  return Number.isNaN(Number(styleRule.terrain?.disableDepthTestDistance))
    ? undefined
    : Number(styleRule.terrain.disableDepthTestDistance);
}

function createCanvasElement(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined" && document.createElement) {
    return document.createElement("canvas");
  }
  return {
    width,
    height,
  };
}

function fillCircle(context, center, radius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.closePath();
  context.fill();
}

function normalizeCircleRadius(radius, fallback) {
  if (!Number.isFinite(radius)) {
    return fallback;
  }
  return Math.max(0, radius);
}

function normalizeOutlineWidth(outlineWidth) {
  return Number.isFinite(outlineWidth) ? Math.max(0, outlineWidth) : 0;
}
