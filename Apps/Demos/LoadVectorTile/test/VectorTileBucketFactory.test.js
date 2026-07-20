import assert from "node:assert/strict";

import VectorTileStyleUtils from "../src/VectorTileStyleUtils.js";

class FakePrimitive {
  constructor(options = {}) {
    Object.assign(this, options);
    this.ready = true;
  }

  isDestroyed() {
    return false;
  }

  destroy() {}
}

const { default: VectorTileBucketFactoryUtils } =
  await import("../src/VectorTileBucketFactory.js");

{
  const diagnostics = createDiagnostics();
  const buckets = VectorTileStyleUtils.normalizeStyleDocument({
    version: 1,
    sources: {
      demo: {
        type: "vector",
        url: "https://example.com/{z}/{x}/{y}.pbf",
      },
    },
    layers: [
      {
        id: "land-fill",
        type: "fill",
        source: "demo",
        sourceLayer: "land",
        paint: {
          "fill-color": "#00ff0077",
        },
      },
      {
        id: "road-line",
        type: "line",
        source: "demo",
        sourceLayer: "road",
        paint: {
          "line-color": "#3366ffff",
          "line-width": 2,
        },
      },
      {
        id: "place-symbol",
        type: "symbol",
        source: "demo",
        sourceLayer: "place",
        layout: {
          "icon-image": "city",
          "text-field": ["get", "name"],
        },
        paint: {
          "text-background-color": "#00000088",
        },
      },
      {
        id: "place-circle",
        type: "circle",
        source: "demo",
        sourceLayer: "place",
        filter: ["==", ["get", "kind"], "city"],
        paint: {
          "circle-radius": 8,
          "circle-color": "#ff6600cc",
          "circle-outline-color": "#ffffffff",
          "circle-outline-width": 1,
        },
      },
    ],
  }).layers.map((styleRule) =>
    VectorTileBucketFactoryUtils.createVectorTilePrimitiveBucket(
      {
        land: createDecodedLandLayer(),
        road: createDecodedRoadLayer(),
        place: createDecodedPlaceLayer(),
      }[styleRule.sourceLayer],
      styleRule,
      4,
      {
        scene: {},
        iconResolver: (name) => (name === "city" ? "city.png" : name),
        diagnostics,
      },
    ),
  );

  assert.equal(buckets[0].primitives.length, 1);
  assert.equal(buckets[0].primitives[0].constructor.name, "Primitive");
  assert.equal(buckets[1].primitives.length, 1);
  assert.equal(buckets[1].primitives[0].constructor.name, "Primitive");
  assert.equal(buckets[2].primitives.length, 0);
  assert.equal(buckets[2].pointDescriptors.billboards.length, 1);
  assert.equal(buckets[2].pointDescriptors.labels.length, 1);
  assert.equal(buckets[3].primitives.length, 0);
  assert.equal(buckets[3].pointDescriptors.billboards.length, 1);
  assert.equal(buckets[3].pointDescriptors.billboards[0].width, 16);
  assert.equal(buckets[3].pointDescriptors.billboards[0].height, 16);
  assert.equal(diagnostics.counts.primitiveBuckets, 4);
  console.log(
    "✓ route fill, line, symbol and circle style rules to geometry-specific buckets",
  );
}

{
  const diagnostics = createDiagnostics();
  const styleRule = VectorTileStyleUtils.normalizeStyleDocument({
    version: 1,
    sources: {
      demo: {
        type: "vector",
        url: "https://example.com/{z}/{x}/{y}.pbf",
      },
    },
    layers: [
      {
        id: "region-symbol",
        type: "symbol",
        source: "demo",
        sourceLayer: "region",
        layout: {
          "symbol-placement": "polygon-center",
          "icon-image": "capital",
          "text-field": ["get", "name"],
        },
      },
    ],
  }).layers[0];

  const bucket = VectorTileBucketFactoryUtils.createVectorTilePrimitiveBucket(
    createDecodedRegionLayer(),
    styleRule,
    4,
    {
      scene: {},
      iconResolver: (name) => (name === "capital" ? "capital.png" : name),
      diagnostics,
    },
  );

  assert.equal(bucket.primitives.length, 0);
  assert.equal(bucket.pointDescriptors.billboards.length, 1);
  assert.equal(bucket.pointDescriptors.labels.length, 1);
  assert.equal(
    typeof bucket.pointDescriptors.billboards[0].position.x,
    "number",
  );
  assert.equal(
    typeof bucket.pointDescriptors.billboards[0].position.y,
    "number",
  );
  assert.equal(
    typeof bucket.pointDescriptors.billboards[0].position.z,
    "number",
  );
  assert.equal(bucket.pointDescriptors.labels[0].text, "Center Label");
  console.log(
    "✓ route polygon-center symbol placement through polygon-derived points",
  );
}

{
  const vectorTile = {
    primitives: {},
    primitiveStyleRules: {},
  };
  const styleRule = {
    id: "road-line",
    type: "line",
  };
  const bucket = {
    id: "road-line",
    primitives: [new FakePrimitive({})],
    length: 1,
  };

  assert.equal(
    VectorTileBucketFactoryUtils.storeVectorTileBucket(
      vectorTile,
      bucket,
      styleRule,
    ),
    true,
  );
  assert.equal(vectorTile.primitives["road-line"], bucket.primitives);
  assert.equal(vectorTile.primitiveStyleRules["road-line"], styleRule);
  console.log(
    "✓ store bucket primitives in the existing vectorTile.primitives shape",
  );
}

{
  const vectorTile = {
    primitives: {},
    primitiveStyleRules: {},
    pointBuckets: {},
  };
  const styleRule = {
    id: "place-symbol",
    type: "symbol",
  };
  const bucket = {
    id: "place-symbol",
    primitives: [],
    pointDescriptors: {
      billboards: [{ image: "city.png" }],
      labels: [{ text: "Beijing" }],
    },
    pointCount: 2,
    length: 2,
  };

  assert.equal(
    VectorTileBucketFactoryUtils.storeVectorTileBucket(
      vectorTile,
      bucket,
      styleRule,
    ),
    true,
  );
  assert.deepEqual(vectorTile.pointBuckets["place-symbol"].descriptors, {
    billboards: [{ image: "city.png" }],
    labels: [{ text: "Beijing" }],
  });
  assert.equal(vectorTile.pointBuckets["place-symbol"].styleRule, styleRule);
  console.log("✓ store point bucket descriptors for shared layer collections");
}

{
  const styleDocument = VectorTileStyleUtils.normalizeStyleDocument({
    version: 1,
    sources: {
      demo: {
        type: "vector",
        url: "https://example.com/{z}/{x}/{y}.pbf",
      },
    },
    layers: [
      {
        id: "demo-land-fill",
        type: "fill",
        source: "demo",
        sourceLayer: "land",
        paint: {
          "fill-color": "#00ff0077",
        },
      },
      {
        id: "demo-road-line",
        type: "line",
        source: "demo",
        sourceLayer: "road",
        paint: {
          "line-color": "#ff0000ff",
          "line-width": 2,
        },
      },
    ],
  });

  const bucketIds = styleDocument.layers.map(
    (styleRule) =>
      VectorTileBucketFactoryUtils.createVectorTilePrimitiveBucket(
        {
          land: createDecodedLandLayer(),
          road: createDecodedRoadLayer(),
        }[styleRule.sourceLayer],
        styleRule,
        4,
        {},
      ).id,
  );

  assert.deepEqual(bucketIds.sort(), ["demo-land-fill", "demo-road-line"]);
  console.log("✓ keep bucket ids stable for source-backed style documents");
}

console.log("VectorTileBucketFactory tests passed.");

function createDecodedLandLayer() {
  return {
    features: [{ id: 1, properties: {} }],
    points: {
      positions: new Float64Array(),
      featureIndices: new Uint32Array(),
    },
    lines: {
      positions: new Float64Array(),
      offsets: new Uint32Array([0]),
      featureIndices: new Uint32Array(),
    },
    polygons: {
      positions: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0]),
      ringOffsets: new Uint32Array([0, 5]),
      polygonOffsets: new Uint32Array([0, 1]),
      featureIndices: new Uint32Array([0]),
    },
  };
}

function createDecodedRoadLayer() {
  return {
    features: [{ id: 1, properties: {} }],
    points: {
      positions: new Float64Array(),
      featureIndices: new Uint32Array(),
    },
    lines: {
      positions: new Float64Array([100, 20, 101, 21]),
      offsets: new Uint32Array([0, 2]),
      featureIndices: new Uint32Array([0]),
    },
    polygons: {
      positions: new Float64Array(),
      ringOffsets: new Uint32Array([0]),
      polygonOffsets: new Uint32Array([0]),
      featureIndices: new Uint32Array(),
    },
  };
}

function createDecodedPlaceLayer() {
  return {
    features: [{ id: 1, properties: { kind: "city", name: "Beijing" } }],
    points: {
      positions: new Float64Array([116, 40]),
      featureIndices: new Uint32Array([0]),
    },
    lines: {
      positions: new Float64Array(),
      offsets: new Uint32Array([0]),
      featureIndices: new Uint32Array(),
    },
    polygons: {
      positions: new Float64Array(),
      ringOffsets: new Uint32Array([0]),
      polygonOffsets: new Uint32Array([0]),
      featureIndices: new Uint32Array(),
    },
  };
}

function createDecodedRegionLayer() {
  return {
    features: [{ id: 1, properties: { name: "Center Label" } }],
    points: {
      positions: new Float64Array(),
      featureIndices: new Uint32Array(),
    },
    lines: {
      positions: new Float64Array(),
      offsets: new Uint32Array([0]),
      featureIndices: new Uint32Array(),
    },
    polygons: {
      positions: new Float64Array([0, 0, 2, 0, 2, 2, 0, 2, 0, 0]),
      ringOffsets: new Uint32Array([0, 5]),
      polygonOffsets: new Uint32Array([0, 1]),
      featureIndices: new Uint32Array([0]),
    },
  };
}

function createDiagnostics() {
  return {
    counts: {},
    increment(name, value = 1) {
      this.counts[name] = (this.counts[name] ?? 0) + value;
    },
  };
}
