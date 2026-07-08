import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";
import { evaluateVectorStyleFilter } from "./VectorStyleFilter.js";
import { evaluateVectorStyleExpression } from "./VectorStyleExpression.js";

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
    this._Cesium = options.Cesium;
    this._scene = options.scene;
    this._iconResolver = options.iconResolver ?? createVectorTileIconResolver();
    this._allowPicking = options.allowPicking ?? false;
    this._diagnostics = options.diagnostics;
    this._ignoreZoomRange = options.ignoreZoomRange ?? false;
  }

  build(points, zoom) {
    if (!this._Cesium) {
      throw new Error("VectorTileSymbolBucket requires a Cesium namespace.");
    }

    const Cesium = this._Cesium;
    const positions = points?.positions ?? [];
    const metadata = points?.metadata ?? [];
    let billboards;
    let labels;
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
        Cesium,
        this._scene,
        position,
        pointMetadata,
        this.styleRule,
        zoom,
        this._iconResolver,
        this._allowPicking,
      );
      if (billboardOptions) {
        billboards ??= markCollectionReady(
          new Cesium.BillboardCollection({ scene: this._scene }),
        );
        billboards.add(billboardOptions);
        billboardCount++;
      }

      const labelOptions = createLabelOptions(
        Cesium,
        this._scene,
        position,
        pointMetadata,
        this.styleRule,
        zoom,
        this._allowPicking,
      );
      if (labelOptions) {
        labels ??= markCollectionReady(
          new Cesium.LabelCollection({ scene: this._scene }),
        );
        labels.add(labelOptions);
        labelCount++;
      }
    }

    this.addPrimitive(billboards);
    this.addPrimitive(labels);
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
  if (!isDefined(value)) {
    return fallback;
  }
  const result = isVectorStyleExpression(value)
    ? evaluateVectorStyleExpression(value, {
        properties: metadata?.properties ?? {},
        id: metadata?.id,
        zoom,
        level: zoom,
      })
    : value;
  return isDefined(result) ? result : fallback;
}

function createBillboardOptions(
  Cesium,
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
    heightReference: getSymbolHeightReference(Cesium, scene, styleRule),
    disableDepthTestDistance: getSymbolDisableDepthTestDistance(styleRule),
    scale: Number(
      evaluateSymbolStyleValue(
        styleRule.layout?.["icon-size"],
        metadata,
        zoom,
        1,
      ),
    ),
    id: allowPicking ? metadata : undefined,
  };
}

function createLabelOptions(
  Cesium,
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

  const textSize = Number(
    evaluateSymbolStyleValue(
      styleRule.layout?.["text-size"],
      metadata,
      zoom,
      16,
    ),
  );
  const outlineWidth = Number(
    evaluateSymbolStyleValue(
      styleRule.paint?.["text-halo-width"],
      metadata,
      zoom,
      0,
    ),
  );

  return {
    position,
    text: String(textValue),
    font: `${Number.isFinite(textSize) ? textSize : 16}px sans-serif`,
    fillColor: parseCesiumColor(
      Cesium,
      evaluateSymbolStyleValue(
        styleRule.paint?.["text-color"],
        metadata,
        zoom,
        "#ffffffff",
      ),
      "#ffffffff",
    ),
    outlineColor: parseCesiumColor(
      Cesium,
      evaluateSymbolStyleValue(
        styleRule.paint?.["text-halo-color"],
        metadata,
        zoom,
        "#000000ff",
      ),
      "#000000ff",
    ),
    outlineWidth: Number.isFinite(outlineWidth) ? outlineWidth : 0,
    style:
      outlineWidth > 0
        ? Cesium.LabelStyle.FILL_AND_OUTLINE
        : Cesium.LabelStyle.FILL,
    heightReference: getSymbolHeightReference(Cesium, scene, styleRule),
    disableDepthTestDistance: getSymbolDisableDepthTestDistance(styleRule),
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    id: allowPicking ? metadata : undefined,
  };
}

function parseCesiumColor(Cesium, value, fallback) {
  return (
    Cesium.Color.fromCssColorString(value) ??
    Cesium.Color.fromCssColorString(fallback)
  );
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

function getStyleRuleHeightOffset(styleRule) {
  const heightOffset = Number(styleRule.terrain?.heightOffset ?? 0.0);
  return Number.isFinite(heightOffset) ? heightOffset : 0.0;
}

function getSymbolHeightReference(Cesium, scene, styleRule) {
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

function markCollectionReady(collection) {
  if (collection.ready === undefined) {
    collection.ready = true;
  }
  return collection;
}

function isVectorStyleExpression(value) {
  return Array.isArray(value) && typeof value[0] === "string";
}

function isDefined(value) {
  return value !== undefined && value !== null;
}
