import assert from "node:assert/strict";

import { normalizeStyleDocument } from "../src/VectorTileStyleUtils.js";

class FakePrimitive {
  constructor(options) {
    this.options = options;
    this.ready = true;
  }

  isDestroyed() {
    return false;
  }

  destroy() {}
}

class FakeGroundPrimitive extends FakePrimitive {}
class FakeGroundPolylinePrimitive extends FakePrimitive {}

class FakeGeometryInstance {
  constructor(options) {
    Object.assign(this, options);
  }
}

class FakeBillboardCollection {
  constructor() {
    this.items = [];
    this.ready = true;
  }

  add(options) {
    this.items.push(options);
  }

  isDestroyed() {
    return false;
  }

  destroy() {}
}

class FakeLabelCollection extends FakeBillboardCollection {}

class FakePolylineGeometry {
  constructor(options) {
    this.options = options;
  }

  static createGeometry(polyline) {
    return { polyline };
  }
}

class FakeGroundPolylineGeometry extends FakePolylineGeometry {}

class FakePolygonGeometry {
  constructor(options) {
    this.options = options;
  }
}

class FakePolygonHierarchy {
  constructor(positions, holes = []) {
    this.positions = positions;
    this.holes = holes;
  }
}

class FakePolylineColorAppearance {}

class FakePerInstanceColorAppearance {
  constructor(options) {
    this.options = options;
  }
}

class FakePolylineMaterialAppearance {
  constructor(options) {
    this.options = options;
  }
}
FakePolylineMaterialAppearance.VERTEX_FORMAT = "polyline-vertex-format";

class FakeCartesian2 {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const Cesium = {
  BillboardCollection: FakeBillboardCollection,
  LabelCollection: FakeLabelCollection,
  Cartesian2: FakeCartesian2,
  Cartesian3: {
    fromDegrees: (longitude, latitude, height) => ({
      longitude,
      latitude,
      height,
    }),
    equals: (left, right) =>
      left.longitude === right.longitude &&
      left.latitude === right.latitude &&
      left.height === right.height,
  },
  Primitive: FakePrimitive,
  GroundPrimitive: FakeGroundPrimitive,
  GroundPolylinePrimitive: FakeGroundPolylinePrimitive,
  GeometryInstance: FakeGeometryInstance,
  PolylineGeometry: FakePolylineGeometry,
  GroundPolylineGeometry: FakeGroundPolylineGeometry,
  PolygonGeometry: FakePolygonGeometry,
  PolygonHierarchy: FakePolygonHierarchy,
  PolylineColorAppearance: FakePolylineColorAppearance,
  PerInstanceColorAppearance: FakePerInstanceColorAppearance,
  PolylineMaterialAppearance: FakePolylineMaterialAppearance,
  GeometryPipeline: {
    combineInstances: (instances) =>
      instances.map((instance) => instance.geometry),
  },
  Material: {
    fromType: (type, options) => ({ type, options }),
  },
  ArcType: {
    GEODESIC: "geodesic",
  },
  LabelStyle: {
    FILL: "fill",
    FILL_AND_OUTLINE: "fill-and-outline",
  },
  HorizontalOrigin: {
    LEFT: "left",
    CENTER: "center",
    RIGHT: "right",
  },
  VerticalOrigin: {
    TOP: "top",
    CENTER: "center",
    BOTTOM: "bottom",
  },
  HeightReference: {
    NONE: "none",
    CLAMP_TO_GROUND: "clamp-to-ground",
    RELATIVE_TO_GROUND: "relative-to-ground",
  },
  Color: {
    fromCssColorString: (value) => ({
      css: value,
      alpha: extractAlpha(value),
    }),
  },
  ColorGeometryInstanceAttribute: {
    fromColor: (color) => ({ color }),
  },
};

globalThis.Cesium = Cesium;

const { createVectorTilePrimitiveBucket, storeVectorTileBucket } =
  await import("../src/VectorTileBucketFactory.js");

{
  const diagnostics = createDiagnostics();
  const buckets = normalizeStyleDocument({
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
    createVectorTilePrimitiveBucket(
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
  assert.ok(buckets[0].primitives[0] instanceof FakePrimitive);
  assert.equal(buckets[1].primitives.length, 1);
  assert.ok(buckets[1].primitives[0] instanceof FakePrimitive);
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
  const styleRule = normalizeStyleDocument({
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

  const bucket = createVectorTilePrimitiveBucket(
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
  assert.deepEqual(bucket.pointDescriptors.billboards[0].position, {
    longitude: 1,
    latitude: 1,
    height: 0,
  });
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

  assert.equal(storeVectorTileBucket(vectorTile, bucket, styleRule), true);
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

  assert.equal(storeVectorTileBucket(vectorTile, bucket, styleRule), true);
  assert.deepEqual(vectorTile.pointBuckets["place-symbol"].descriptors, {
    billboards: [{ image: "city.png" }],
    labels: [{ text: "Beijing" }],
  });
  assert.equal(vectorTile.pointBuckets["place-symbol"].styleRule, styleRule);
  console.log("✓ store point bucket descriptors for shared layer collections");
}

{
  const styleDocument = normalizeStyleDocument({
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
      createVectorTilePrimitiveBucket(
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
    points: {
      positions: new Float64Array(),
      metadata: [],
    },
    lines: {
      positions: new Float64Array(),
      offsets: new Uint32Array([0]),
      metadata: [],
    },
    polygons: {
      positions: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0]),
      ringOffsets: new Uint32Array([0, 5]),
      polygonOffsets: new Uint32Array([0, 1]),
      metadata: [{ properties: {} }],
    },
  };
}

function createDecodedRoadLayer() {
  return {
    points: {
      positions: new Float64Array(),
      metadata: [],
    },
    lines: {
      positions: new Float64Array([100, 20, 101, 21]),
      offsets: new Uint32Array([0, 2]),
      metadata: [{ properties: {} }],
    },
    polygons: {
      positions: new Float64Array(),
      ringOffsets: new Uint32Array([0]),
      polygonOffsets: new Uint32Array([0]),
      metadata: [],
    },
  };
}

function createDecodedPlaceLayer() {
  return {
    points: {
      positions: new Float64Array([116, 40]),
      metadata: [{ properties: { kind: "city", name: "Beijing" } }],
    },
    lines: {
      positions: new Float64Array(),
      offsets: new Uint32Array([0]),
      metadata: [],
    },
    polygons: {
      positions: new Float64Array(),
      ringOffsets: new Uint32Array([0]),
      polygonOffsets: new Uint32Array([0]),
      metadata: [],
    },
  };
}

function createDecodedRegionLayer() {
  return {
    points: {
      positions: new Float64Array(),
      metadata: [],
    },
    lines: {
      positions: new Float64Array(),
      offsets: new Uint32Array([0]),
      metadata: [],
    },
    polygons: {
      positions: new Float64Array([0, 0, 2, 0, 2, 2, 0, 2, 0, 0]),
      ringOffsets: new Uint32Array([0, 5]),
      polygonOffsets: new Uint32Array([0, 1]),
      metadata: [{ properties: { name: "Center Label" } }],
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

function extractAlpha(value) {
  if (typeof value !== "string") {
    return 1.0;
  }

  const match = /^#(?:[0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(value);
  if (!match) {
    return 1.0;
  }
  return parseInt(match[1], 16) / 255;
}
