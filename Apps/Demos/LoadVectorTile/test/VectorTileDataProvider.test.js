/**
 * Unit tests for VectorTileDataProvider.js and VectorTileStyleRule.js
 *
 * Run with:
 *   node Apps/Demos/LoadVectorTile/src_test/VectorTileDataProvider.test.js
 */
import assert from "node:assert/strict";
import VectorTileDataProvider from "../src/VectorTileDataProvider.js";
import VectorTileStyleRule from "../src/VectorTileStyleRule.js";

function createFakeProvider() {
  return {
    _options: {
      url: "https://example.com/{z}/{x}/{y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
    },
    minimumLevel: 0,
    maximumLevel: 10,
    tilingScheme: { name: "fake" },
    resource: { url: "https://example.com/{z}/{x}/{y}.pbf" },
    requestCount: 0,
    isTileAvailable(level) {
      return level >= this.minimumLevel && level <= this.maximumLevel;
    },
    requestTile(tile) {
      this.requestCount++;
      return { tile };
    },
    getTileResource(tile) {
      return { tile };
    },
  };
}

{
  const rule = new VectorTileStyleRule({
    id: "org-fill",
    type: "fill",
    source: "org",
    sourceLayer: "res_org_gr",
    paint: {
      "fill-color": "#00ff0022",
    },
    terrain: {
      heightOffset: 1.0,
    },
  });

  const json = rule.toJSON();
  assert.equal(json.id, "org-fill");
  assert.equal(json.type, "fill");
  assert.equal(json.source, "org");
  assert.equal(json.sourceLayer, "res_org_gr");
  assert.equal(json.paint["fill-color"], "#00ff0022");
  assert.equal(json.terrain.heightOffset, 1.0);
  console.log("✓ VectorTileStyleRule normalizes one style layer");
}

{
  const provider = createFakeProvider();
  const dataProvider = new VectorTileDataProvider({
    sourceId: "org",
    source: {
      type: "vector",
      url: "https://example.com/{z}/{x}/{y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
    },
    provider,
    styleRules: [
      new VectorTileStyleRule({
        id: "org-fill",
        type: "fill",
        source: "org",
        sourceLayer: "res_org_gr",
        paint: {
          "fill-color": "#00ff0022",
        },
      }),
      new VectorTileStyleRule({
        id: "org-line",
        type: "line",
        source: "org",
        sourceLayer: "res_org_gr",
        paint: {
          "line-color": "#ffffffaa",
          "line-width": 2,
        },
      }),
    ],
  });

  assert.equal(dataProvider.minimumLevel, 0);
  assert.equal(dataProvider.maximumLevel, 10);
  assert.equal(dataProvider.isTileAvailable(5), true);
  assert.equal(dataProvider.isTileAvailable(11), false);

  dataProvider.requestTile({ x: 0, y: 0, level: 0 });
  assert.equal(provider.requestCount, 1);

  assert.equal(dataProvider._options.sourceId, "org");
  assert.equal(dataProvider._options.styles.res_org_gr.fill, true);
  assert.equal(dataProvider._options.styles.res_org_gr.fillColor, "#00ff0022");
  assert.equal(dataProvider._options.styles.res_org_gr.lineColor, "#ffffffaa");
  assert.equal(dataProvider._options.styles.res_org_gr.lineWidth, 2);
  console.log("✓ VectorTileDataProvider shares one source across style rules");
}

console.log("\nAll tests passed.");
