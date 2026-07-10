import assert from "node:assert/strict";
import VectorTileProvider from "../src/VectorTileProvider.js";
import VectorTileStyleRule from "../src/VectorTileStyleRule.js";

class FakeVectorTileProvider extends VectorTileProvider {
  getTileResource(tile) {
    return { tile };
  }
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
  const provider = new FakeVectorTileProvider({
    sourceId: "org",
    source: {
      type: "vector",
      url: "https://example.com/{z}/{x}/{y}.pbf",
      minimumLevel: 0,
      maximumLevel: 10,
    },
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
    tilingScheme: { name: "fake" },
  });

  assert.equal(provider.minimumLevel, 0);
  assert.equal(provider.maximumLevel, 10);
  assert.equal(provider.isTileAvailable(5), true);
  assert.equal(provider.isTileAvailable(11), false);

  assert.equal(provider.sourceId, "org");
  assert.equal(provider.source.url, "https://example.com/{z}/{x}/{y}.pbf");

  const styleDocument = provider._options.styleDocument;
  assert.equal(
    styleDocument.sources.org.url,
    "https://example.com/{z}/{x}/{y}.pbf",
  );
  assert.equal(styleDocument.layers.length, 2);
  assert.equal(styleDocument.layers[0].source, "org");
  assert.equal(styleDocument.layers[0].id, "org-fill");
  assert.equal(styleDocument.layers[1].paint["line-width"], 2);
  console.log(
    "✓ VectorTileProvider owns one source and bootstraps its style document",
  );
}

{
  const provider = new FakeVectorTileProvider({
    styleDocument: {
      version: 1,
      sources: {
        land: {
          type: "vector",
          url: "https://example.com/{z}/{x}/{y}.pbf",
          minimumLevel: 1,
          maximumLevel: 5,
        },
      },
      layers: [
        {
          id: "land-fill",
          type: "fill",
          source: "land",
          sourceLayer: "countries",
          paint: {
            "fill-color": "#00ff0022",
          },
        },
      ],
    },
  });

  assert.equal(provider.sourceId, "land");
  assert.equal(provider.source.url, "https://example.com/{z}/{x}/{y}.pbf");
  assert.equal(provider.minimumLevel, 1);
  assert.equal(provider.maximumLevel, 5);
  assert.equal(provider._options.styleDocument.layers[0].id, "land-fill");
  assert.equal(provider._options.url, "https://example.com/{z}/{x}/{y}.pbf");
  console.log(
    "✓ VectorTileProvider derives source state directly from styleDocument",
  );
}

console.log("\nAll tests passed.");
