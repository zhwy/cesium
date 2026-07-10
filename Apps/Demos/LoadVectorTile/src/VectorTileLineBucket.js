import * as CesiumModule from "../../../../Build/CesiumUnminified/index.js";
const Cesium = globalThis.Cesium ?? CesiumModule;
import { VectorTilePrimitiveBucket } from "./VectorTileBucketFactory.js";
import {
  createCartesianLine,
  createOutlineCartesianLines,
  createGroundPolylinePrimitive,
  createPrimitive,
  doesStyleRuleMatchMetadata,
  evaluateColorStyleValue,
  evaluateFiniteStyleNumber,
  getStyleRuleHeightOffset,
  isDefined,
  isVectorStyleExpression,
  parseCesiumColor,
  requiresGroundHeightOffsetFallback,
  shouldUseGroundPath,
} from "./VectorTileBucketUtils.js";

export default class VectorTileLineBucket extends VectorTilePrimitiveBucket {
  constructor(styleRule, options = {}) {
    super(styleRule);
    this._allowPicking = options.allowPicking ?? false;
    this._diagnostics = options.diagnostics;
    this._renderBackend = options.renderBackend ?? "instances";
    this._packedMinimumInstances = options.packedMinimumInstances ?? 200;
    this._shadows = options.shadows;
    this._asynchronous = options.asynchronous ?? true;
  }

  build(lines, zoom, options = {}) {
    const polygons = options.polygons;
    const tileBounds = options.tileBounds;
    if (requiresGroundHeightOffsetFallback(this.styleRule)) {
      this._diagnostics?.increment("groundHeightOffsetFallbacks");
    }

    if (this._shouldUsePackedLines(lines, polygons)) {
      this.addPrimitives(this._createPackedLinePrimitives(lines, zoom));
      return this;
    }

    const useGroundPath = shouldUseGroundPath(this.styleRule);
    const lineInstances = useGroundPath
      ? this._createGroundLineGeometryInstances(
          lines,
          polygons,
          zoom,
          tileBounds,
        )
      : this._createLineGeometryInstances(lines, polygons, zoom, tileBounds);
    if (lineInstances.length === 0) {
      return this;
    }

    this.addPrimitive(
      useGroundPath
        ? createGroundPolylinePrimitive(lineInstances, {
            allowPicking: this._allowPicking,
            diagnostics: this._diagnostics,
          })
        : createPrimitive(
            lineInstances,
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
    return this;
  }

  _shouldUsePackedLines(lines, polygons) {
    const lineCount = Math.max(0, (lines?.offsets?.length ?? 0) - 1);
    return (
      (polygons?.polygonOffsets?.length ?? 0) <= 1 &&
      !shouldUseGroundPath(this.styleRule) &&
      this._renderBackend === "packed" &&
      !this._allowPicking &&
      lineCount >= this._packedMinimumInstances &&
      !isVectorStyleExpression(this.styleRule.paint?.["line-color"]) &&
      !isVectorStyleExpression(this.styleRule.paint?.["line-width"])
    );
  }

  _createPackedLinePrimitives(lines, zoom) {
    const startTime = this._diagnostics?.startTimer();
    const filteredLines = filterLinesForStyleRule(lines, this.styleRule, zoom);
    const geometryInstances = [];

    for (let i = 0; i + 1 < filteredLines.offsets.length; ++i) {
      const positions = createCartesianLine(filteredLines, i);
      if (positions.length < 2) {
        continue;
      }

      const geometry = Cesium.PolylineGeometry.createGeometry(
        new Cesium.PolylineGeometry({
          positions,
          width: evaluateFiniteStyleNumber(
            this.styleRule.paint?.["line-width"],
            undefined,
            zoom,
            2,
          ),
          arcType: this.styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
          vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        }),
      );
      if (geometry) {
        geometryInstances.push(new Cesium.GeometryInstance({ geometry }));
      }
    }

    if (geometryInstances.length === 0) {
      return [];
    }

    const combinedGeometries =
      Cesium.GeometryPipeline.combineInstances(geometryInstances);
    const color = parseCesiumColor(
      this.styleRule.paint?.["line-color"] ?? "#ffff00ff",
      "#ffff00ff",
    );
    const appearance = new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType("Color", { color }),
      translucent: color.alpha < 1.0,
    });

    const primitives = combinedGeometries.map(
      (geometry) =>
        new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({ geometry }),
          appearance,
          shadows: this._shadows,
          allowPicking: false,
          asynchronous: false,
          releaseGeometryInstances: true,
          compressVertices: true,
        }),
    );

    this._diagnostics?.increment("packedLineBuckets");
    this._diagnostics?.increment(
      "packedSourceGeometries",
      geometryInstances.length,
    );
    this._diagnostics?.increment(
      "packedCombinedGeometries",
      combinedGeometries.length,
    );
    this._diagnostics?.increment("createdPrimitives", primitives.length);
    this._diagnostics?.recordDuration("packedGeometryBuild", startTime);
    return primitives;
  }

  _createLineGeometryInstances(lines, polygons, zoom, tileBounds) {
    const instances = [];
    const height = getStyleRuleHeightOffset(this.styleRule);

    for (let i = 0; i + 1 < lines.offsets.length; ++i) {
      const start = lines.offsets[i];
      const end = lines.offsets[i + 1];
      if (end - start < 2) {
        continue;
      }

      const metadata = lines.metadata?.[i];
      if (
        !doesStyleRuleMatchMetadata(metadata, 2, this.styleRule, zoom, {
          ignoreZoomRange: true,
        })
      ) {
        continue;
      }

      const polyline = new Cesium.PolylineGeometry({
        positions: createCartesianLine(lines, i, height),
        width: evaluateFiniteStyleNumber(
          this.styleRule.paint?.["line-width"],
          metadata,
          zoom,
          2,
        ),
        arcType: this.styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
      });
      instances.push(
        new Cesium.GeometryInstance({
          id: this._allowPicking
            ? { ...metadata, layerId: this.styleRule.id }
            : undefined,
          geometry: polyline,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              evaluateColorStyleValue(
                this.styleRule.paint?.["line-color"],
                metadata,
                zoom,
                "#ffff00ff",
              ),
            ),
          },
        }),
      );
    }

    this._appendPolygonOutlineGeometryInstances(
      instances,
      polygons,
      zoom,
      false,
      tileBounds,
    );
    return instances;
  }

  _createGroundLineGeometryInstances(lines, polygons, zoom, tileBounds) {
    const instances = [];

    for (let i = 0; i + 1 < lines.offsets.length; ++i) {
      const start = lines.offsets[i];
      const end = lines.offsets[i + 1];
      if (end - start < 2) {
        continue;
      }

      const metadata = lines.metadata?.[i];
      if (
        !doesStyleRuleMatchMetadata(metadata, 2, this.styleRule, zoom, {
          ignoreZoomRange: true,
        })
      ) {
        continue;
      }

      const polyline = new Cesium.GroundPolylineGeometry({
        positions: createCartesianLine(lines, i),
        width: evaluateFiniteStyleNumber(
          this.styleRule.paint?.["line-width"],
          metadata,
          zoom,
          2,
        ),
        arcType: this.styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
      });
      instances.push(
        new Cesium.GeometryInstance({
          id: this._allowPicking
            ? { ...metadata, layerId: this.styleRule.id }
            : undefined,
          geometry: polyline,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              evaluateColorStyleValue(
                this.styleRule.paint?.["line-color"],
                metadata,
                zoom,
                "#ffff00ff",
              ),
            ),
          },
        }),
      );
    }

    this._appendPolygonOutlineGeometryInstances(
      instances,
      polygons,
      zoom,
      true,
      tileBounds,
    );
    return instances;
  }

  _appendPolygonOutlineGeometryInstances(
    instances,
    polygons,
    zoom,
    useGroundPath,
    tileBounds,
  ) {
    if (!polygons || (polygons.polygonOffsets?.length ?? 0) <= 1) {
      return;
    }

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

          instances.push(
            new Cesium.GeometryInstance({
              id: this._allowPicking
                ? { ...metadata, layerId: this.styleRule.id }
                : undefined,
              geometry: useGroundPath
                ? new Cesium.GroundPolylineGeometry({
                    positions: ring,
                    width: evaluateFiniteStyleNumber(
                      this.styleRule.paint?.["line-width"],
                      metadata,
                      zoom,
                      2,
                    ),
                    arcType:
                      this.styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
                  })
                : new Cesium.PolylineGeometry({
                    positions: ring,
                    width: evaluateFiniteStyleNumber(
                      this.styleRule.paint?.["line-width"],
                      metadata,
                      zoom,
                      2,
                    ),
                    arcType:
                      this.styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
                  }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  evaluateColorStyleValue(
                    this.styleRule.paint?.["line-color"],
                    metadata,
                    zoom,
                    "#ffff00ff",
                  ),
                ),
              },
            }),
          );
        }
      }
    }
  }
}

function filterLinesForStyleRule(lines, styleRule, zoom) {
  if ((lines.metadata?.length ?? 0) === 0 && lines.positions.length > 0) {
    return lines;
  }

  const positions = [];
  const offsets = [0];
  const metadata = [];
  for (let i = 0; i + 1 < lines.offsets.length; ++i) {
    if (
      !doesStyleRuleMatchMetadata(lines.metadata?.[i], 2, styleRule, zoom, {
        ignoreZoomRange: true,
      })
    ) {
      continue;
    }

    const start = lines.offsets[i];
    const end = lines.offsets[i + 1];
    for (let j = start * 2; j < end * 2; ++j) {
      positions.push(lines.positions[j]);
    }
    offsets.push(positions.length / 2);
    if (isDefined(lines.metadata?.[i])) {
      metadata.push(lines.metadata[i]);
    }
  }

  return {
    positions: new Float64Array(positions),
    offsets: new Uint32Array(offsets),
    metadata,
  };
}
