import assert from "node:assert/strict";

import {
  createPolygonCenterPoints,
  doesStyleRuleUseGeometryType,
  filterPackedLayerByStyleRules,
  getStyleRuleGeometryTypes,
  getStyleRuleSymbolPlacement,
  normalizeSymbolPlacement,
} from "../src/VectorTileGeometryPlacement.js";

{
  assert.equal(normalizeSymbolPlacement(undefined), "point");
  assert.equal(normalizeSymbolPlacement("point"), "point");
  assert.equal(normalizeSymbolPlacement("polygon-center"), "polygon-center");
  assert.equal(normalizeSymbolPlacement("polygon-visual-center"), "point");

  assert.equal(
    getStyleRuleSymbolPlacement({
      type: "symbol",
      layout: { "symbol-placement": "polygon-center" },
    }),
    "polygon-center",
  );
  assert.deepEqual(
    getStyleRuleGeometryTypes({
      type: "symbol",
      layout: { "symbol-placement": "polygon-center" },
    }),
    [3],
  );
  assert.deepEqual(getStyleRuleGeometryTypes({ type: "circle" }), [1]);
  assert.equal(doesStyleRuleUseGeometryType({ type: "circle" }, 1), true);
  assert.equal(doesStyleRuleUseGeometryType({ type: "circle" }, 2), false);
  assert.deepEqual(getStyleRuleGeometryTypes({ type: "fill" }), [2, 3]);
  assert.equal(doesStyleRuleUseGeometryType({ type: "fill" }, 2), true);
  assert.equal(doesStyleRuleUseGeometryType({ type: "fill" }, 3), true);
  assert.deepEqual(getStyleRuleGeometryTypes({ type: "line" }), [2, 3]);
  assert.equal(doesStyleRuleUseGeometryType({ type: "line" }, 3), true);
  assert.equal(
    doesStyleRuleUseGeometryType(
      {
        type: "symbol",
        layout: { "symbol-placement": "point" },
      },
      3,
    ),
    false,
  );
  console.log("✓ map style rules to normalized placement and source geometry");
}

{
  const points = createPolygonCenterPoints({
    positions: new Float64Array([
      0, 0, 2, 0, 2, 2, 0, 2, 0, 0, 5, 5, 6, 5, 7, 5,
    ]),
    ringOffsets: new Uint32Array([0, 5, 8]),
    polygonOffsets: new Uint32Array([0, 1, 2]),
    featureIndices: new Uint32Array([7, 9]),
  });

  assert.equal(points.positions.length, 2);
  assert.equal(points.positions[0], 1);
  assert.equal(points.positions[1], 1);
  assert.deepEqual([...points.featureIndices], [7]);
  console.log("✓ derive polygon-center points and skip degenerate polygons");
}

{
  const diagnostics = createDiagnostics();
  const packedLayer = {
    featureCount: 6,
    styleFilteredFeatureCount: 0,
    features: [
      { properties: { kind: "poi", name: "point-hit" } },
      { properties: { kind: "other", name: "point-miss" } },
      { properties: { kind: "main" } },
      { properties: { kind: "poi" } },
      { properties: { label: true, kind: "region" } },
      { properties: { label: false, kind: "poi" } },
    ],
    points: {
      positions: new Float64Array([10, 20, 30, 40]),
      featureIndices: new Uint32Array([0, 1]),
    },
    lines: {
      positions: new Float64Array([100, 20, 101, 21, 110, 30, 111, 31]),
      offsets: new Uint32Array([0, 2, 4]),
      featureIndices: new Uint32Array([2, 3]),
    },
    polygons: {
      positions: new Float64Array([
        0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 2, 2, 3, 2, 3, 3, 2, 3, 2, 2,
      ]),
      ringOffsets: new Uint32Array([0, 5, 10]),
      polygonOffsets: new Uint32Array([0, 1, 2]),
      featureIndices: new Uint32Array([4, 5]),
    },
  };
  const styleRules = [
    {
      id: "poi-circle",
      type: "circle",
      sourceLayer: "demo",
      filter: ["==", ["get", "kind"], "poi"],
    },
    {
      id: "point-symbol",
      type: "symbol",
      sourceLayer: "demo",
      filter: ["==", ["get", "kind"], "poi"],
      layout: { "symbol-placement": "point" },
    },
    {
      id: "polygon-symbol",
      type: "symbol",
      sourceLayer: "demo",
      filter: ["==", ["get", "label"], true],
      layout: { "symbol-placement": "polygon-center" },
    },
    {
      id: "mixed-line",
      type: "line",
      sourceLayer: "demo",
      filter: ["==", ["get", "kind"], "main"],
    },
  ];

  const filtered = filterPackedLayerByStyleRules(
    packedLayer,
    styleRules,
    5,
    diagnostics,
  );

  assert.equal(filtered.points.featureIndices.length, 1);
  assert.equal(filtered.lines.featureIndices.length, 1);
  assert.equal(filtered.polygons.featureIndices.length, 1);
  assert.equal(filtered.featureCount, 3);
  assert.equal(
    filtered.features[filtered.lines.featureIndices[0]].properties.kind,
    "main",
  );
  assert.equal(
    filtered.features[filtered.polygons.featureIndices[0]].properties.kind,
    "region",
  );
  assert.equal(diagnostics.counts.mainThreadStyleFilteredFeatures, 1);
  console.log(
    "✓ preserve required point, line and polygon source geometries while filtering",
  );
}

{
  const highFeatureIndex = 65536;
  const features = [];
  features[highFeatureIndex] = {
    id: 1,
    properties: { kind: "main" },
  };
  const filtered = filterPackedLayerByStyleRules(
    {
      featureCount: 1,
      features,
      points: {
        positions: new Float64Array(),
        featureIndices: new Uint32Array(),
      },
      lines: {
        positions: new Float64Array([0, 0, 1, 1, 2, 2, 3, 3]),
        offsets: new Uint32Array([0, 2, 4]),
        featureIndices: new Uint32Array([highFeatureIndex, highFeatureIndex]),
      },
      polygons: {
        positions: new Float64Array(),
        ringOffsets: new Uint32Array([0]),
        polygonOffsets: new Uint32Array([0]),
        featureIndices: new Uint32Array(),
      },
    },
    [
      {
        type: "line",
        filter: ["==", ["get", "kind"], "main"],
      },
    ],
    5,
  );
  assert.equal(filtered.features.length, 1);
  assert.deepEqual([...filtered.lines.featureIndices], [0, 0]);
  console.log("✓ keep clipped geometry fragments on one feature table row");
}

console.log("VectorTileGeometryPlacement tests passed.");

function createDiagnostics() {
  return {
    counts: {},
    increment(name, value = 1) {
      this.counts[name] = (this.counts[name] ?? 0) + value;
    },
  };
}
