import { VectorTile } from "https://cdn.jsdelivr.net/npm/@mapbox/vector-tile/+esm";
import { PbfReader } from "https://cdn.jsdelivr.net/npm/pbf/+esm";
import {
  classifyRings,
  clipLineString,
  clipRingToRectangle,
  countOutOfBoundsPoints,
  isPointInRectangle,
  projectPoint,
} from "./VectorTileGeometryUtils.js";
import { doesFeatureMatchAnyStyleRule as matchFeatureAgainstStyleRules } from "./VectorTileGeometryPlacement.js";

function createPackedLayer() {
  return {
    featureCount: 0,
    positionCount: 0,
    pointPositions: [],
    pointMetadata: [],
    linePositions: [],
    lineOffsets: [],
    lineMetadata: [],
    polygonPositions: [],
    ringOffsets: [],
    polygonOffsets: [],
    polygonMetadata: [],
    clippedFeatureCount: 0,
    discardedFeatureCount: 0,
    outOfBoundsPositionCount: 0,
  };
}

function getMetadata(feature, includeProperties) {
  if (!includeProperties) {
    return undefined;
  }
  return {
    id: feature.id,
    properties: feature.properties,
  };
}

function addPoints(
  feature,
  geometry,
  tile,
  packedLayer,
  includeProperties,
  clipToTile,
) {
  const metadata = getMetadata(feature, includeProperties);
  for (let i = 0; i < geometry.length; ++i) {
    const points = geometry[i];
    for (let j = 0; j < points.length; ++j) {
      if (clipToTile && !isPointInRectangle(points[j], 0, feature.extent)) {
        continue;
      }
      projectPoint(points[j], tile, feature.extent, packedLayer.pointPositions);
      if (includeProperties) {
        packedLayer.pointMetadata.push(metadata);
      }
      packedLayer.positionCount++;
    }
  }
}

function addLines(
  feature,
  geometry,
  tile,
  packedLayer,
  includeProperties,
  clipToTile,
) {
  const metadata = getMetadata(feature, includeProperties);
  for (let i = 0; i < geometry.length; ++i) {
    const lines = clipToTile
      ? clipLineString(geometry[i], 0, feature.extent)
      : [geometry[i]];
    for (let lineIndex = 0; lineIndex < lines.length; ++lineIndex) {
      const line = lines[lineIndex];
      if (line.length < 2) {
        continue;
      }

      packedLayer.lineOffsets.push(packedLayer.linePositions.length / 2);
      for (let j = 0; j < line.length; ++j) {
        projectPoint(line[j], tile, feature.extent, packedLayer.linePositions);
        packedLayer.positionCount++;
      }
      if (includeProperties) {
        packedLayer.lineMetadata.push(metadata);
      }
    }
  }
}

function addPolygons(
  feature,
  geometry,
  tile,
  packedLayer,
  includeProperties,
  clipToTile,
) {
  const metadata = getMetadata(feature, includeProperties);
  const rings = clipToTile
    ? geometry
        .map((ring) => clipRingToRectangle(ring, 0, feature.extent))
        .filter((ring) => ring.length >= 4)
    : geometry;
  const polygons = classifyRings(rings);
  for (let i = 0; i < polygons.length; ++i) {
    const polygon = polygons[i];
    const polygonStart = packedLayer.ringOffsets.length;
    for (let j = 0; j < polygon.length; ++j) {
      const ring = polygon[j];
      if (ring.length < 4) {
        continue;
      }

      packedLayer.ringOffsets.push(packedLayer.polygonPositions.length / 2);
      for (let k = 0; k < ring.length; ++k) {
        projectPoint(
          ring[k],
          tile,
          feature.extent,
          packedLayer.polygonPositions,
        );
        packedLayer.positionCount++;
      }
    }

    if (packedLayer.ringOffsets.length > polygonStart) {
      packedLayer.polygonOffsets.push(polygonStart);
      if (includeProperties) {
        packedLayer.polygonMetadata.push(metadata);
      }
    }
  }
}

function finalizePackedLayer(layer) {
  layer.lineOffsets.push(layer.linePositions.length / 2);
  layer.ringOffsets.push(layer.polygonPositions.length / 2);
  layer.polygonOffsets.push(layer.ringOffsets.length - 1);
  return {
    featureCount: layer.featureCount,
    positionCount: layer.positionCount,
    clippedFeatureCount: layer.clippedFeatureCount,
    discardedFeatureCount: layer.discardedFeatureCount,
    outOfBoundsPositionCount: layer.outOfBoundsPositionCount,
    points: {
      positions: new Float64Array(layer.pointPositions),
      metadata: layer.pointMetadata,
    },
    lines: {
      positions: new Float64Array(layer.linePositions),
      offsets: new Uint32Array(layer.lineOffsets),
      metadata: layer.lineMetadata,
    },
    polygons: {
      positions: new Float64Array(layer.polygonPositions),
      ringOffsets: new Uint32Array(layer.ringOffsets),
      polygonOffsets: new Uint32Array(layer.polygonOffsets),
      metadata: layer.polygonMetadata,
    },
  };
}

function groupStyleRulesBySourceLayer(styleRules) {
  const result = new Map();
  if (!Array.isArray(styleRules) || styleRules.length === 0) {
    return result;
  }
  styleRules.forEach((styleRule) => {
    if (!styleRule?.sourceLayer || styleRule.visibility === false) {
      return;
    }
    let rules = result.get(styleRule.sourceLayer);
    if (!rules) {
      rules = [];
      result.set(styleRule.sourceLayer, rules);
    }
    rules.push(styleRule);
  });
  return result;
}

function doesFeatureMatchAnyStyleRule(feature, styleRules, tile) {
  const zoom = tile.styleZoom ?? tile.level;
  return matchFeatureAgainstStyleRules(feature, feature.type, styleRules, {
    zoom,
    level: zoom,
    sourceLevel: tile.sourceLevel ?? tile.level,
  });
}

export default function decodeVectorTile(
  arrayBuffer,
  tile,
  styledLayerNames,
  includeProperties = false,
  clipToTile = true,
  styleRules = undefined,
) {
  const vectorTile = new VectorTile(new PbfReader(arrayBuffer));
  const layers = {};
  const styleRulesBySourceLayer = groupStyleRulesBySourceLayer(styleRules);
  for (let i = 0; i < styledLayerNames.length; ++i) {
    const layerName = styledLayerNames[i];
    const vectorTileLayer = vectorTile.layers[layerName];
    if (!vectorTileLayer) {
      continue;
    }

    const packedLayer = createPackedLayer();
    const layerStyleRules = styleRulesBySourceLayer.get(layerName);
    for (
      let featureIndex = 0;
      featureIndex < vectorTileLayer.length;
      ++featureIndex
    ) {
      const feature = vectorTileLayer.feature(featureIndex);
      if (
        layerStyleRules &&
        !doesFeatureMatchAnyStyleRule(feature, layerStyleRules, tile)
      ) {
        packedLayer.styleFilteredFeatureCount++;
        continue;
      }
      const geometry = feature.loadGeometry();
      packedLayer.featureCount++;
      const positionCountBefore = packedLayer.positionCount;
      if (clipToTile) {
        const outOfBoundsPositionCount = countOutOfBoundsPoints(
          geometry,
          0,
          feature.extent,
        );
        packedLayer.outOfBoundsPositionCount += outOfBoundsPositionCount;
        if (outOfBoundsPositionCount > 0) {
          packedLayer.clippedFeatureCount++;
        }
      }
      if (feature.type === 1) {
        addPoints(
          feature,
          geometry,
          tile,
          packedLayer,
          includeProperties,
          clipToTile,
        );
      } else if (feature.type === 2) {
        addLines(
          feature,
          geometry,
          tile,
          packedLayer,
          includeProperties,
          clipToTile,
        );
      } else if (feature.type === 3) {
        addPolygons(
          feature,
          geometry,
          tile,
          packedLayer,
          includeProperties,
          clipToTile,
        );
      }
      if (packedLayer.positionCount === positionCountBefore) {
        packedLayer.discardedFeatureCount++;
      }
    }
    layers[layerName] = finalizePackedLayer(packedLayer);
  }
  return { layers };
}
