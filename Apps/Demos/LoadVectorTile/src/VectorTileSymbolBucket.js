import * as CesiumModule from "../../../../Build/CesiumUnminified/index.js";
import { evaluateVectorStyleFilter } from "./VectorTileStyleExpression.js";
import { VectorTilePrimitiveBucket } from "./VectorTileBucketFactory.js";
import {
  evaluateColorStyleValue,
  evaluateFiniteStyleNumber,
  evaluateStyleValue,
  getStyleRuleHeightOffset,
  isDefined,
  parseCesiumColor,
} from "./VectorTileBucketUtils.js";

const Cesium = globalThis.Cesium ?? CesiumModule;

/**
 * Cesium-oriented render bucket for one symbol style rule on one vector tile.
 *
 * The bucket creates Cesium collections instead of geometry instances:
 * BillboardCollection for icons and LabelCollection for text.  It intentionally
 * keeps collision/declutter out of scope for this first symbol pass.
 */
export default class VectorTileSymbolBucket extends VectorTilePrimitiveBucket {
  constructor(styleRule, options = {}) {
    super(styleRule);
    this._scene = options.scene;
    this._iconResolver = options.iconResolver ?? createVectorTileIconResolver();
    this._allowPicking = options.allowPicking ?? false;
    this._diagnostics = options.diagnostics;
    this._ignoreZoomRange = options.ignoreZoomRange ?? false;
  }

  build(points, zoom) {
    const positions = points?.positions ?? [];
    const metadata = points?.metadata ?? [];
    let billboardCount = 0;
    let labelCount = 0;

    for (let i = 0; i < positions.length / 2; ++i) {
      const pointMetadata = metadata[i];
      if (
        !doesSymbolStyleRuleMatchMetadata(pointMetadata, this.styleRule, zoom, {
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

      const billboardOptions = createBillboardOptions(
        this._scene,
        position,
        pointMetadata,
        this.styleRule,
        zoom,
        this._iconResolver,
        this._allowPicking,
      );
      if (billboardOptions) {
        this.addBillboardDescriptor(billboardOptions);
        billboardCount++;
      }

      const labelOptions = createLabelOptions(
        this._scene,
        position,
        pointMetadata,
        this.styleRule,
        zoom,
        this._allowPicking,
      );
      if (labelOptions) {
        this.addLabelDescriptor(labelOptions);
        labelCount++;
      }
    }

    this._diagnostics?.increment("symbolBillboards", billboardCount);
    this._diagnostics?.increment("symbolLabels", labelCount);
    return this;
  }
}

export function createVectorTileIconResolver(...registries) {
  const mergedRegistry = Object.assign({}, ...registries.filter(Boolean));
  return (iconImage) =>
    resolveVectorTileIconResource(iconImage, mergedRegistry);
}

export function resolveVectorTileIconResource(iconImage, registry = {}) {
  if (!isDefined(iconImage)) {
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

export function evaluateSymbolStyleValue(value, metadata, zoom, fallback) {
  return evaluateStyleValue(value, metadata, zoom, fallback);
}

export function translateSymbolAnchor(anchorValue, fallback = "center") {
  const anchor =
    typeof anchorValue === "string" &&
    Object.prototype.hasOwnProperty.call(SYMBOL_ANCHOR_MAP, anchorValue)
      ? anchorValue
      : fallback;
  const origins = SYMBOL_ANCHOR_MAP[anchor] ?? SYMBOL_ANCHOR_MAP.center;
  return {
    horizontalOrigin: Cesium.HorizontalOrigin[origins.horizontalOrigin],
    verticalOrigin: Cesium.VerticalOrigin[origins.verticalOrigin],
  };
}

export function createSymbolPixelOffset(value, metadata, zoom) {
  const offset = evaluateSymbolStyleValue(value, metadata, zoom);
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

export function createSymbolBackgroundPadding(value, metadata, zoom) {
  const padding = evaluateSymbolStyleValue(value, metadata, zoom);
  if (!isDefined(padding)) {
    return undefined;
  }

  if (Array.isArray(padding)) {
    const x = Number(padding[0]);
    const y = Number(padding[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return undefined;
    }
    return new Cesium.Cartesian2(x, y);
  }

  const uniform = Number(padding);
  if (!Number.isFinite(uniform)) {
    return undefined;
  }
  return new Cesium.Cartesian2(uniform, uniform);
}

function createBillboardOptions(
  scene,
  position,
  metadata,
  styleRule,
  zoom,
  resolveIcon,
  allowPicking,
) {
  const iconImageValue = evaluateSymbolStyleValue(
    styleRule.layout?.["icon-image"],
    metadata,
    zoom,
  );
  const image = resolveIcon(iconImageValue);
  if (!isDefined(image) || image === "") {
    return undefined;
  }

  return {
    position,
    image,
    heightReference: getSymbolHeightReference(scene, styleRule),
    disableDepthTestDistance: getSymbolDisableDepthTestDistance(styleRule),
    scale: evaluateFiniteStyleNumber(
      styleRule.layout?.["icon-size"],
      metadata,
      zoom,
      1,
    ),
    width: evaluateFiniteStyleNumber(
      styleRule.layout?.["icon-width"],
      metadata,
      zoom,
      undefined,
    ),
    height: evaluateFiniteStyleNumber(
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
    id: allowPicking ? metadata : undefined,
  };
}

function createLabelOptions(
  scene,
  position,
  metadata,
  styleRule,
  zoom,
  allowPicking,
) {
  const textValue = evaluateSymbolStyleValue(
    styleRule.layout?.["text-field"],
    metadata,
    zoom,
  );
  if (!isDefined(textValue) || textValue === "") {
    return undefined;
  }

  const textSize = evaluateFiniteStyleNumber(
    styleRule.layout?.["text-size"],
    metadata,
    zoom,
    16,
  );
  const outlineWidth = evaluateFiniteStyleNumber(
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
    fillColor: evaluateColorStyleValue(
      styleRule.paint?.["text-color"],
      metadata,
      zoom,
      "#ffffffff",
    ),
    outlineColor: evaluateColorStyleValue(
      styleRule.paint?.["text-halo-color"],
      metadata,
      zoom,
      "#000000ff",
    ),
    outlineWidth,
    style:
      outlineWidth > 0
        ? Cesium.LabelStyle.FILL_AND_OUTLINE
        : Cesium.LabelStyle.FILL,
    heightReference: getSymbolHeightReference(scene, styleRule),
    disableDepthTestDistance: getSymbolDisableDepthTestDistance(styleRule),
    pixelOffset: createSymbolPixelOffset(
      styleRule.layout?.["text-offset"],
      metadata,
      zoom,
    ),
    showBackground:
      isDefined(backgroundColorValue) && backgroundColorValue !== "",
    backgroundColor:
      isDefined(backgroundColorValue) && backgroundColorValue !== ""
        ? parseCesiumColor(backgroundColorValue, "#00000000")
        : undefined,
    backgroundPadding: createSymbolBackgroundPadding(
      styleRule.paint?.["text-background-padding"],
      metadata,
      zoom,
    ),
    ...translateSymbolAnchor(anchorValue),
    id: allowPicking ? metadata : undefined,
  };
}

function doesSymbolStyleRuleMatchMetadata(
  metadata,
  styleRule,
  zoom,
  options = {},
) {
  return (
    (options.ignoreZoomRange || isZoomInRange(zoom, styleRule)) &&
    evaluateVectorStyleFilter(styleRule.filter, metadata, { zoom, level: zoom })
  );
}

function isZoomInRange(zoom, styleRule) {
  return (
    (styleRule.minzoom === undefined || zoom >= styleRule.minzoom) &&
    (styleRule.maxzoom === undefined || zoom < styleRule.maxzoom)
  );
}

function getSymbolHeightReference(scene, styleRule) {
  if (styleRule.terrain?.clampToGround !== true || !isDefined(scene)) {
    return Cesium.HeightReference.NONE;
  }
  return getStyleRuleHeightOffset(styleRule) === 0.0
    ? Cesium.HeightReference.CLAMP_TO_GROUND
    : Cesium.HeightReference.RELATIVE_TO_GROUND;
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
