import assert from "node:assert/strict";
import VectorTileProvider from "../src/VectorTileProvider.js";
import VectorTilePbfCache from "../src/VectorTilePbfCache.js";
import VectorTileStyleRule from "../src/VectorTileStyleRule.js";

class FakeVectorTileProvider extends VectorTileProvider {
  getTileResource(tile) {
    return { tile };
  }
}

class FetchingVectorTileProvider extends VectorTileProvider {
  constructor(options) {
    super(options);
    this.dataUrl = options.source.url
      .replace("{z}", "0")
      .replace("{x}", "0")
      .replace("{y}", "0");
    this.fetchCount = 0;
  }

  getTileResource() {
    return {
      url: this.dataUrl,
      request: { cancel() {} },
      fetchArrayBuffer: () => {
        this.fetchCount++;
        return Promise.resolve(Uint8Array.from([1, 2, 3]).buffer);
      },
    };
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

{
  const diagnostics = createDiagnostics();
  const pbfCache = new VectorTilePbfCache({
    maximumBytes: 16,
    diagnostics,
  });
  const provider = new FetchingVectorTileProvider({
    sourceId: "land",
    source: { type: "vector", url: "https://example.com/a/{z}/{x}/{y}.pbf" },
    pbfCache,
    diagnostics,
    tilingScheme: { name: "fake" },
  });
  const tile = { x: 1, y: 2, level: 3, priority: 4, contentRevision: 0 };

  const first = await provider.requestTile(tile).promise;
  structuredClone(first, { transfer: [first] });
  tile.contentRevision = 1;
  const second = await provider.requestTile(tile).promise;

  assert.equal(provider.fetchCount, 1);
  assert.equal(first.byteLength, 0);
  assert.deepEqual([...new Uint8Array(second)], [1, 2, 3]);
  assert.equal(diagnostics.counters.downloadedBytes, 3);
  assert.equal(diagnostics.counters.pbfCacheHits, 1);
  pbfCache.clear();
  await provider.requestTile(tile).promise;
  assert.equal(provider.fetchCount, 2);
  assert.equal(diagnostics.counters.downloadedBytes, 6);
  console.log(
    "✓ requestTile reuses a worker-safe PBF copy and clear restores a cold fetch",
  );
}

{
  const pbfCache = new VectorTilePbfCache({ maximumBytes: 32 });
  const tile = { x: 0, y: 0, level: 0, priority: 0 };
  const first = new FetchingVectorTileProvider({
    sourceId: "first",
    source: { type: "vector", url: "https://example.com/{z}/{x}/{y}.pbf" },
    pbfCache,
    tilingScheme: { name: "fake" },
  });
  const second = new FetchingVectorTileProvider({
    sourceId: "second",
    source: { type: "vector", url: "https://example.com/{z}/{x}/{y}.pbf" },
    pbfCache,
    tilingScheme: { name: "fake" },
  });

  await first.requestTile(tile).promise;
  await second.requestTile(tile).promise;
  assert.equal(first.fetchCount, 1);
  assert.equal(second.fetchCount, 1);
  assert.notEqual(
    first.getPbfCacheKey(tile, first.getTileResource(tile)),
    second.getPbfCacheKey(tile, second.getTileResource(tile)),
  );
  console.log("✓ PBF keys isolate source namespaces");
}

{
  const pbfCache = new VectorTilePbfCache({ maximumBytes: 32 });
  const provider = new FetchingVectorTileProvider({
    sourceId: "land",
    source: { type: "vector", url: "https://example.com/a/{z}/{x}/{y}.pbf" },
    pbfCache,
    tilingScheme: { name: "fake" },
  });
  const tile = { x: 0, y: 0, level: 0, priority: 0 };
  await provider.requestTile(tile).promise;
  provider.dataUrl = "https://example.com/b/0/0/0.pbf";
  await provider.requestTile(tile).promise;
  assert.equal(provider.fetchCount, 2);
  console.log("✓ resolved resource identity changes produce a PBF miss");
}

console.log("\nAll tests passed.");

function createDiagnostics() {
  return {
    counters: {},
    gauges: {},
    increment(name, amount = 1) {
      this.counters[name] = (this.counters[name] ?? 0) + amount;
    },
    setGauge(name, value) {
      this.gauges[name] = value;
    },
  };
}
