/**
 * Unit tests for VectorTileStyleUtils.js
 *
 * Run with:
 *   node Apps/Demos/LoadVectorTile/src_test/VectorTileStyle.test.js
 */
import assert from "node:assert/strict";
import {
  CESIUM_STYLE_IMPLEMENTATION_TERMS,
  createLegacyLayerOptionsFromStyleDocument,
  createStyleDocumentFromLegacyOptions,
  normalizeStyleDocument,
} from "../src/VectorTileStyleUtils.js";

{
  const style = normalizeStyleDocument({
    sources: {
      org: {
        type: "vector",
        url: "https://example.com/{z}/{x}/{y}.pbf",
        minimumLevel: 0,
        maximumLevel: 10,
      },
    },
    layers: [
      {
        id: "org-fill",
        type: "fill",
        source: "org",
        sourceLayer: "res_org_gr",
        paint: {
          "fill-color": "#00ff0044",
        },
      },
      {
        id: "org-line",
        type: "line",
        source: "org",
        sourceLayer: "res_org_gr",
        paint: {
          "line-color": "#ffffffaa",
          "line-width": 2,
        },
      },
    ],
  });

  assert.equal(style.version, 1);
  assert.equal(style.sources.org.type, "vector");
  assert.equal(style.layers.length, 2);
  assert.equal(style.layers[0].terrain.clampToGround, false);
  assert.equal(style.layers[0].terrain.heightOffset, 0.0);
  assert.equal(style.layers[0].visibility, true);
  console.log("✓ normalize valid style document");
}

{
  assert.throws(
    () =>
      normalizeStyleDocument({
        sources: {
          org: { type: "vector", url: "https://example.com/{z}/{x}/{y}.pbf" },
        },
        layers: [
          {
            id: "duplicate",
            type: "fill",
            source: "org",
            sourceLayer: "res_org_gr",
          },
          {
            id: "duplicate",
            type: "line",
            source: "org",
            sourceLayer: "res_org_gr",
          },
        ],
      }),
    /must be unique/,
  );
  console.log("✓ reject duplicate layer id");
}

{
  assert.throws(
    () =>
      normalizeStyleDocument({
        sources: {
          org: { type: "vector", url: "https://example.com/{z}/{x}/{y}.pbf" },
        },
        layers: [
          {
            id: "missing-source",
            type: "fill",
            source: "missing",
            sourceLayer: "res_org_gr",
          },
        ],
      }),
    /references missing source/,
  );
  console.log("✓ reject missing source");
}

{
  const style = createStyleDocumentFromLegacyOptions({
    sourceId: "org",
    url: "https://example.com/{z}/{x}/{y}.pbf",
    minimumLevel: 0,
    maximumLevel: 10,
    styles: {
      res_org_gr: {
        fill: true,
        fillColor: "#00ff0022",
        fillOutlineColor: "#00ff00",
        fillOutlineWidth: 1,
        lineColor: "#ffffffaa",
        lineWidth: 2,
      },
    },
  });

  assert.equal(style.sources.org.url, "https://example.com/{z}/{x}/{y}.pbf");
  assert.equal(style.layers.length, 2);
  assert.equal(style.layers[0].type, "fill");
  assert.equal(style.layers[1].type, "line");
  assert.equal(style.layers[0].paint["fill-color"], "#00ff0022");
  assert.equal(style.layers[1].paint["line-width"], 2);
  console.log("✓ convert legacy styles to style document");
}

{
  const legacyOptions = createLegacyLayerOptionsFromStyleDocument({
    sources: {
      org: {
        type: "vector",
        url: "https://example.com/{z}/{x}/{y}.pbf",
        minimumLevel: 0,
      },
    },
    layers: [
      {
        id: "org-fill",
        type: "fill",
        source: "org",
        sourceLayer: "res_org_gr",
        paint: {
          "fill-color": "#00ff0022",
          "fill-outline-color": "#00ff00",
          "fill-outline-width": 1,
        },
      },
      {
        id: "org-line",
        type: "line",
        source: "org",
        sourceLayer: "res_org_gr",
        paint: {
          "line-color": "#ffffffaa",
          "line-width": 2,
        },
      },
      {
        id: "org-symbol",
        type: "symbol",
        source: "org",
        sourceLayer: "res_org_gr",
        layout: {
          "text-field": ["get", "name"],
        },
      },
    ],
  });

  assert.equal(legacyOptions.length, 1);
  assert.equal(legacyOptions[0].sourceId, "org");
  assert.equal(legacyOptions[0].styleSourceId, "org");
  assert.equal(legacyOptions[0].styles.res_org_gr.fill, true);
  assert.equal(legacyOptions[0].styles.res_org_gr.fillColor, "#00ff0022");
  assert.equal(legacyOptions[0].styles.res_org_gr.lineColor, "#ffffffaa");
  assert.equal(legacyOptions[0].styles.res_org_gr.lineWidth, 2);
  console.log("✓ convert style document to legacy layer options");
}

{
  const style = normalizeStyleDocument({
    sources: {
      org: {
        type: "vector",
        url: "https://example.com/{z}/{x}/{y}.pbf",
      },
    },
    layers: [
      {
        id: "org-symbol-default",
        type: "symbol",
        source: "org",
        sourceLayer: "res_org_gr",
        layout: {
          "text-field": ["get", "name"],
        },
      },
      {
        id: "org-symbol-polygon",
        type: "symbol",
        source: "org",
        sourceLayer: "res_org_gr",
        layout: {
          "symbol-placement": "polygon-center",
          "text-field": ["get", "name"],
        },
      },
      {
        id: "org-symbol-invalid",
        type: "symbol",
        source: "org",
        sourceLayer: "res_org_gr",
        layout: {
          "symbol-placement": "polygon-visual-center",
          "text-field": ["get", "name"],
        },
      },
    ],
  });

  assert.equal(style.layers[0].layout["symbol-placement"], "point");
  assert.equal(style.layers[1].layout["symbol-placement"], "polygon-center");
  assert.equal(style.layers[2].layout["symbol-placement"], "point");
  console.log("✓ normalize symbol-placement values with default point");
}

{
  assert.deepEqual(CESIUM_STYLE_IMPLEMENTATION_TERMS, [
    "VectorTileDataProvider",
    "VectorTileStyleRule",
    "VectorTilePrimitiveBucket",
    "VectorTileSymbolBucket",
  ]);
  console.log("✓ Cesium-oriented implementation terms");
}

console.log("\nAll tests passed.");
