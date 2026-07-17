import assert from "node:assert/strict";

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

class FakePolygonGeometry {
  constructor(options) {
    this.options = options;
  }
}

class FakeGroundPolylineGeometry {
  constructor(options) {
    this.options = options;
  }
}

class FakePolylineGeometry extends FakeGroundPolylineGeometry {}

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

const Cesium = {
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
  PolygonGeometry: FakePolygonGeometry,
  PolylineGeometry: FakePolylineGeometry,
  GroundPolylineGeometry: FakeGroundPolylineGeometry,
  PolygonHierarchy: FakePolygonHierarchy,
  PolylineColorAppearance: FakePolylineColorAppearance,
  PerInstanceColorAppearance: FakePerInstanceColorAppearance,
  ArcType: {
    GEODESIC: "geodesic",
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

const { default: VectorTileFillBucket } =
  await import("../src/VectorTileFillBucket.js");

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileFillBucket(
    {
      id: "land",
      type: "fill",
      sourceLayer: "land",
      filter: ["==", ["get", "kind"], "park"],
      paint: {
        "fill-color": ["get", "color"],
      },
      terrain: {
        heightOffset: 4,
      },
    },
    {
      allowPicking: true,
      asynchronous: false,
      diagnostics,
    },
  ).build(createPolygons(), 6);

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakePrimitive);
  assert.equal(bucket.primitives[0].options.geometryInstances.length, 1);
  assert.equal(bucket.primitiveRecords[0].role, "fill");
  assert.deepEqual([...bucket.primitiveRecords[0].instanceFeatureIndices], [0]);
  assert.equal(bucket.primitives[0].options.geometryInstances[0].id, 0);
  assert.equal(
    bucket.primitives[0].options.geometryInstances[0].geometry.options.height,
    4,
  );
  assert.equal(
    bucket.primitives[0].options.geometryInstances[0].attributes.color.color
      .css,
    "#00ff0077",
  );
  assert.equal(diagnostics.counts.createdGroundPrimitives ?? 0, 0);
  assert.equal(diagnostics.counts.createdPrimitives, 1);
  console.log("✓ build filtered fill primitives with evaluated paint values");
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileFillBucket(
    {
      id: "land-ground",
      type: "fill",
      sourceLayer: "land",
      paint: {
        "fill-color": "#3366ffaa",
        "fill-outline-color": "#112233ff",
        "fill-outline-width": 2,
      },
      terrain: {
        clampToGround: true,
      },
    },
    {
      diagnostics,
    },
  ).build(createPolygons(), 4);

  assert.equal(bucket.length, 2);
  assert.ok(bucket.primitives[0] instanceof FakeGroundPrimitive);
  assert.ok(bucket.primitives[1] instanceof FakeGroundPolylinePrimitive);
  assert.deepEqual(
    bucket.primitiveRecords.map((record) => record.role),
    ["fill", "fill-outline"],
  );
  assert.equal(diagnostics.counts.createdGroundPrimitives, 1);
  assert.equal(diagnostics.counts.createdGroundPolylinePrimitives, 1);
  console.log(
    "✓ build ground fill and outline primitives when terrain clamp is enabled",
  );
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileFillBucket(
    {
      id: "tile-edge-outline",
      type: "fill",
      sourceLayer: "land",
      paint: {
        "fill-color": "#ff000077",
        "fill-outline-color": "#ffffffff",
      },
    },
    {
      diagnostics,
    },
  ).build(createPolygonsOnTileBoundary(), 4, {
    tileBounds: {
      west: 0,
      east: 1,
      south: 0,
      north: 1,
    },
  });

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakePrimitive);
  console.log(
    "✓ skip fill outline segments that lie on the clipped tile boundary",
  );
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileFillBucket(
    {
      id: "land-fallback",
      type: "fill",
      sourceLayer: "land",
      paint: {
        "fill-color": "#ff000077",
      },
      terrain: {
        clampToGround: true,
        heightOffset: 3,
      },
    },
    {
      diagnostics,
    },
  ).build(createPolygons(), 4);

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakePrimitive);
  assert.equal(diagnostics.counts.groundHeightOffsetFallbacks, 1);
  assert.equal(diagnostics.counts.createdGroundPrimitives ?? 0, 0);
  console.log(
    "✓ record terrain fallback when ground fill also requests height offset",
  );
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileFillBucket(
    {
      id: "closed-line-fill",
      type: "fill",
      sourceLayer: "line_regions",
      paint: {
        "fill-color": "#00ffff77",
      },
    },
    {
      diagnostics,
    },
  ).build(createEmptyPolygons(), 4, {
    lines: createLineRings(),
  });

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakePrimitive);
  assert.equal(bucket.primitives[0].options.geometryInstances.length, 2);
  assert.equal(
    bucket.primitives[0].options.geometryInstances[0].geometry.options
      .polygonHierarchy.positions.length,
    5,
  );
  assert.deepEqual(
    bucket.primitives[0].options.geometryInstances[0].geometry.options
      .polygonHierarchy.positions[0],
    {
      longitude: 0,
      latitude: 0,
      height: 0,
    },
  );
  const openLinePositions =
    bucket.primitives[0].options.geometryInstances[1].geometry.options
      .polygonHierarchy.positions;
  assert.equal(openLinePositions.length, 4);
  assert.deepEqual(openLinePositions[3], openLinePositions[0]);
  console.log(
    "✓ build fill primitives from line rings and force open rings closed",
  );
}

console.log("VectorTileFillBucket tests passed.");

function createPolygons() {
  return {
    positions: new Float64Array([
      0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 2, 2, 3, 2, 3, 3, 2, 3, 2, 2,
    ]),
    ringOffsets: new Uint32Array([0, 5, 10]),
    polygonOffsets: new Uint32Array([0, 1, 2]),
    metadata: [
      {
        id: 1,
        properties: {
          kind: "park",
          color: "#00ff0077",
        },
      },
      {
        id: 2,
        properties: {
          kind: "lake",
          color: "#0000ff77",
        },
      },
    ],
  };
}

function createPolygonsOnTileBoundary() {
  return {
    positions: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0]),
    ringOffsets: new Uint32Array([0, 5]),
    polygonOffsets: new Uint32Array([0, 1]),
    metadata: [{ properties: {} }],
  };
}

function createEmptyPolygons() {
  return {
    positions: new Float64Array(),
    ringOffsets: new Uint32Array([0]),
    polygonOffsets: new Uint32Array([0]),
    metadata: [],
  };
}

function createLineRings() {
  return {
    positions: new Float64Array([
      0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 10, 10, 11, 10, 11, 11,
    ]),
    offsets: new Uint32Array([0, 5, 8]),
    metadata: [
      { id: 1, properties: { kind: "closed" } },
      { id: 2, properties: { kind: "open" } },
    ],
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
