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
    metadata: [
      { properties: { name: "square" } },
      { properties: { name: "degenerate" } },
    ],
  });

  assert.equal(points.positions.length, 2);
  assert.equal(points.positions[0], 1);
  assert.equal(points.positions[1], 1);
  assert.equal(points.metadata.length, 1);
  assert.equal(points.metadata[0].properties.name, "square");
  console.log("✓ derive polygon-center points and skip degenerate polygons");
}

{
  const diagnostics = createDiagnostics();
  const packedLayer = {
    featureCount: 5,
    styleFilteredFeatureCount: 0,
    points: {
      positions: new Float64Array([10, 20, 30, 40]),
      metadata: [
        { properties: { kind: "poi", name: "point-hit" } },
        { properties: { kind: "other", name: "point-miss" } },
      ],
    },
    lines: {
      positions: new Float64Array([100, 20, 101, 21, 110, 30, 111, 31]),
      offsets: new Uint32Array([0, 2, 4]),
      metadata: [
        { properties: { kind: "main" } },
        { properties: { kind: "minor" } },
      ],
    },
    polygons: {
      positions: new Float64Array([
        0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 2, 2, 3, 2, 3, 3, 2, 3, 2, 2,
      ]),
      ringOffsets: new Uint32Array([0, 5, 10]),
      polygonOffsets: new Uint32Array([0, 1, 2]),
      metadata: [
        { properties: { label: true, kind: "region" } },
        { properties: { label: false, kind: "main" } },
      ],
    },
  };
  const styleRules = [
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

  assert.equal(filtered.points.metadata.length, 1);
  assert.equal(filtered.lines.metadata.length, 1);
  assert.equal(filtered.polygons.metadata.length, 2);
  assert.equal(filtered.featureCount, 4);
  assert.equal(diagnostics.counts.mainThreadStyleFilteredFeatures, 1);
  console.log(
    "✓ preserve required point, line and polygon source geometries while filtering",
  );
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
