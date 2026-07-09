import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";
import {
  createCartesianRing,
  createGroundPolylinePrimitive,
  createOutlineCartesianLines,
  createPrimitive,
  doesStyleRuleMatchMetadata,
  evaluateColorStyleValue,
  evaluateFiniteStyleNumber,
  getStyleRuleHeightOffset,
  isVectorStyleExpression,
  parseCesiumColor,
  requiresGroundHeightOffsetFallback,
  shouldUseGroundPath,
} from "./VectorTileBucketUtils.js";

export default class VectorTileFillBucket extends VectorTilePrimitiveBucket {
  constructor(styleRule, options = {}) {
    super(styleRule);
    this._allowPicking = options.allowPicking ?? false;
    this._diagnostics = options.diagnostics;
    this._shadows = options.shadows;
    this._asynchronous = options.asynchronous ?? true;
  }

  build(polygons, zoom, tileContext = {}) {
    if (requiresGroundHeightOffsetFallback(this.styleRule)) {
      this._diagnostics?.increment("groundHeightOffsetFallbacks");
    }

    const useGroundPath = shouldUseGroundPath(this.styleRule);
    const polygonInstances = this._createPolygonGeometryInstances(
      polygons,
      zoom,
      useGroundPath,
    );
    if (polygonInstances.length > 0) {
      this.addPrimitive(
        createPrimitive(
          polygonInstances,
          "polygon",
          {
            fillColor: this.styleRule.paint?.["fill-color"] ?? "#ff000077",
            translucent: isFillStyleTranslucent(this.styleRule),
            groundPrimitive: useGroundPath,
          },
          {
            allowPicking: this._allowPicking,
            asynchronous: this._asynchronous,
            diagnostics: this._diagnostics,
            shadows: this._shadows,
          },
        ),
      );
    }

    const outlineInstances = this._createFillOutlineGeometryInstances(
      polygons,
      zoom,
      useGroundPath,
      tileContext.tileBounds,
    );
    if (outlineInstances.length > 0) {
      this.addPrimitive(
        useGroundPath
          ? createGroundPolylinePrimitive(outlineInstances, {
              allowPicking: this._allowPicking,
              diagnostics: this._diagnostics,
            })
          : createPrimitive(
              outlineInstances,
              "line",
              {},
              {
                allowPicking: this._allowPicking,
                asynchronous: this._asynchronous,
                diagnostics: this._diagnostics,
                shadows: this._shadows,
              },
            ),
      );
    }

    return this;
  }

  _createPolygonGeometryInstances(polygons, zoom, useGroundPath) {
    const instances = [];
    const height = useGroundPath
      ? 0.0
      : getStyleRuleHeightOffset(this.styleRule);

    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = polygons.metadata?.[i];
      if (
        !doesStyleRuleMatchMetadata(metadata, 3, this.styleRule, zoom, {
          ignoreZoomRange: true,
        })
      ) {
        continue;
      }

      const firstRing = polygons.polygonOffsets[i];
      const lastRing = polygons.polygonOffsets[i + 1];
      if (firstRing >= lastRing) {
        continue;
      }

      const outerRing = createCartesianRing(polygons, firstRing, height);
      if (outerRing.length < 3) {
        continue;
      }

      const holes = [];
      for (let ringIndex = firstRing + 1; ringIndex < lastRing; ++ringIndex) {
        const hole = createCartesianRing(polygons, ringIndex, height);
        if (hole.length >= 3) {
          holes.push(new Cesium.PolygonHierarchy(hole));
        }
      }

      const polygonOptions = {
        polygonHierarchy: new Cesium.PolygonHierarchy(outerRing, holes),
      };
      if (!useGroundPath) {
        polygonOptions.height = height;
      }

      instances.push(
        new Cesium.GeometryInstance({
          id: this._allowPicking ? metadata : undefined,
          geometry: new Cesium.PolygonGeometry(polygonOptions),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              evaluateColorStyleValue(
                this.styleRule.paint?.["fill-color"],
                metadata,
                zoom,
                "#ff000077",
              ),
            ),
          },
        }),
      );
    }

    return instances;
  }

  _createFillOutlineGeometryInstances(
    polygons,
    zoom,
    useGroundPath,
    tileBounds,
  ) {
    if (
      !this.styleRule.paint ||
      !("fill-outline-color" in this.styleRule.paint)
    ) {
      return [];
    }

    const lineInstances = [];
    const height = useGroundPath
      ? 0.0
      : getStyleRuleHeightOffset(this.styleRule);
    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = polygons.metadata?.[i];
      if (
        !doesStyleRuleMatchMetadata(metadata, 3, this.styleRule, zoom, {
          ignoreZoomRange: true,
        })
      ) {
        continue;
      }

      const firstRing = polygons.polygonOffsets[i];
      const lastRing = polygons.polygonOffsets[i + 1];
      for (let ringIndex = firstRing; ringIndex < lastRing; ++ringIndex) {
        const outlineLines = createOutlineCartesianLines(
          polygons,
          ringIndex,
          height,
          tileBounds,
        );
        for (let lineIndex = 0; lineIndex < outlineLines.length; ++lineIndex) {
          const ring = outlineLines[lineIndex];
          if (ring.length < 2) {
            continue;
          }

          const polylineOptions = {
            positions: ring,
            width: evaluateFiniteStyleNumber(
              this.styleRule.paint?.["fill-outline-width"],
              metadata,
              zoom,
              1,
            ),
            arcType: this.styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
          };
          const polyline = useGroundPath
            ? new Cesium.GroundPolylineGeometry(polylineOptions)
            : new Cesium.PolylineGeometry(polylineOptions);
          lineInstances.push(
            new Cesium.GeometryInstance({
              id: this._allowPicking ? metadata : undefined,
              geometry: polyline,
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  evaluateColorStyleValue(
                    this.styleRule.paint?.["fill-outline-color"],
                    metadata,
                    zoom,
                    "#ffffffff",
                  ),
                ),
              },
            }),
          );
        }
      }
    }

    return lineInstances;
  }
}

function isFillStyleTranslucent(styleRule) {
  const fillColor = styleRule.paint?.["fill-color"];
  if (isVectorStyleExpression(fillColor)) {
    return true;
  }
  return parseCesiumColor(fillColor ?? "#ff000077", "#ff000077").alpha < 1.0;
}
