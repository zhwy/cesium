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

class FakeGroundPolylinePrimitive extends FakePrimitive {}

class FakePolylineGeometry {
  constructor(options) {
    this.options = options;
  }

  static createGeometry(polyline) {
    return { polyline };
  }
}

class FakeGroundPolylineGeometry extends FakePolylineGeometry {}

class FakeGeometryInstance {
  constructor(options) {
    Object.assign(this, options);
  }
}

class FakePolylineColorAppearance {}

class FakePolylineMaterialAppearance {
  constructor(options) {
    this.options = options;
  }
}
FakePolylineMaterialAppearance.VERTEX_FORMAT = "polyline-vertex-format";

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
  PolylineGeometry: FakePolylineGeometry,
  GroundPolylineGeometry: FakeGroundPolylineGeometry,
  GroundPolylinePrimitive: FakeGroundPolylinePrimitive,
  GeometryInstance: FakeGeometryInstance,
  Primitive: FakePrimitive,
  PolylineColorAppearance: FakePolylineColorAppearance,
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

const { default: VectorTileLineBucket } =
  await import("../src/VectorTileLineBucket.js");

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileLineBucket(
    {
      id: "roads",
      type: "line",
      sourceLayer: "roads",
      filter: ["==", ["get", "kind"], "main"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["get", "width"],
      },
      terrain: {
        heightOffset: 5,
      },
    },
    {
      allowPicking: true,
      asynchronous: false,
      diagnostics,
    },
  ).build(
    {
      positions: new Float64Array([100, 20, 101, 21, 120, 30, 121, 31]),
      offsets: new Uint32Array([0, 2, 4]),
      metadata: [
        {
          id: 1,
          properties: {
            kind: "main",
            color: "#3366ffff",
            width: 4,
          },
        },
        {
          id: 2,
          properties: {
            kind: "minor",
            color: "#999999ff",
            width: 1,
          },
        },
      ],
    },
    6,
  );

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakePrimitive);
  assert.equal(bucket.primitives[0].options.geometryInstances.length, 1);
  assert.equal(
    bucket.primitives[0].options.geometryInstances[0].geometry.options.width,
    4,
  );
  assert.equal(
    bucket.primitives[0].options.geometryInstances[0].attributes.color.color
      .css,
    "#3366ffff",
  );
  assert.deepEqual(
    bucket.primitives[0].options.geometryInstances[0].geometry.options
      .positions[0],
    {
      longitude: 100,
      latitude: 20,
      height: 5,
    },
  );
  assert.equal(diagnostics.counts.createdGeometryInstances, 1);
  assert.equal(diagnostics.counts.createdPrimitives, 1);
  console.log(
    "✓ build filtered line primitives with expression-driven style values",
  );
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileLineBucket(
    {
      id: "roads-ground",
      type: "line",
      sourceLayer: "roads",
      paint: {
        "line-color": "#ff0000ff",
        "line-width": 2,
      },
      terrain: {
        clampToGround: true,
      },
    },
    {
      diagnostics,
    },
  ).build(
    {
      positions: new Float64Array([100, 20, 101, 21]),
      offsets: new Uint32Array([0, 2]),
      metadata: [{ properties: {} }],
    },
    4,
  );

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakeGroundPolylinePrimitive);
  assert.ok(
    bucket.primitives[0].options.geometryInstances[0].geometry instanceof
      FakeGroundPolylineGeometry,
  );
  assert.equal(diagnostics.counts.createdGroundPolylinePrimitives, 1);
  assert.equal(diagnostics.counts.createdPrimitives, 1);
  console.log(
    "✓ build ground polyline primitives when terrain clamp is enabled",
  );
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileLineBucket(
    {
      id: "roads-packed",
      type: "line",
      sourceLayer: "roads",
      filter: ["==", ["get", "kind"], "main"],
      paint: {
        "line-color": "#00ff00aa",
        "line-width": 3,
      },
    },
    {
      diagnostics,
      renderBackend: "packed",
      packedMinimumInstances: 2,
    },
  ).build(
    {
      positions: new Float64Array([
        100, 20, 101, 21, 110, 22, 111, 23, 120, 24, 121, 25,
      ]),
      offsets: new Uint32Array([0, 2, 4, 6]),
      metadata: [
        { properties: { kind: "main" } },
        { properties: { kind: "main" } },
        { properties: { kind: "minor" } },
      ],
    },
    5,
  );

  assert.equal(bucket.length, 2);
  assert.deepEqual(
    bucket.primitiveRecords.map((record) => record.role),
    ["packed-line", "packed-line"],
  );
  assert.equal(bucket.primitiveRecords[0].instanceFeatureIndices, undefined);
  assert.equal(diagnostics.counts.packedLineBuckets, 1);
  assert.equal(diagnostics.counts.packedSourceGeometries, 2);
  assert.equal(diagnostics.counts.packedCombinedGeometries, 2);
  assert.equal(diagnostics.counts.createdPrimitives, 2);
  console.log(
    "✓ build packed line primitives only for filtered matching features",
  );
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileLineBucket(
    {
      id: "roads-fallback",
      type: "line",
      sourceLayer: "roads",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3,
      },
      terrain: {
        clampToGround: true,
        heightOffset: 2,
      },
    },
    {
      diagnostics,
      renderBackend: "packed",
      packedMinimumInstances: 1,
    },
  ).build(
    {
      positions: new Float64Array([100, 20, 101, 21]),
      offsets: new Uint32Array([0, 2]),
      metadata: [{ properties: { color: "#ff00ffff" } }],
    },
    5,
  );

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakePrimitive);
  assert.equal(diagnostics.counts.groundHeightOffsetFallbacks, 1);
  assert.equal(diagnostics.counts.packedLineBuckets ?? 0, 0);
  console.log(
    "✓ skip packed path and record fallback when ground offset is unsupported",
  );
}

{
  const diagnostics = createDiagnostics();
  const bucket = new VectorTileLineBucket(
    {
      id: "regions-outline",
      type: "line",
      sourceLayer: "regions",
      paint: {
        "line-color": "#ffcc00ff",
        "line-width": 5,
      },
      terrain: {
        heightOffset: 10,
      },
    },
    {
      allowPicking: true,
      asynchronous: false,
      diagnostics,
    },
  ).build(
    {
      positions: new Float64Array([100, 20, 101, 21]),
      offsets: new Uint32Array([0, 2]),
      metadata: [{ id: 1, properties: {} }],
    },
    5,
    {
      polygons: {
        positions: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0]),
        ringOffsets: new Uint32Array([0, 5]),
        polygonOffsets: new Uint32Array([0, 1]),
        metadata: [{ id: 2, properties: {} }],
      },
    },
  );

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakePrimitive);
  assert.equal(bucket.primitives[0].options.geometryInstances.length, 2);
  assert.equal(bucket.primitiveRecords[0].role, "line");
  assert.deepEqual(
    [...bucket.primitiveRecords[0].instanceFeatureIndices],
    [0, 0],
  );
  assert.deepEqual(
    bucket.primitives[0].options.geometryInstances.map(
      (instance) => instance.id,
    ),
    [0, 1],
  );
  assert.equal(
    bucket.primitives[0].options.geometryInstances[1].geometry.options.width,
    5,
  );
  assert.deepEqual(
    bucket.primitives[0].options.geometryInstances[1].geometry.options
      .positions[0],
    {
      longitude: 0,
      latitude: 0,
      height: 10,
    },
  );
  assert.equal(
    bucket.primitives[0].options.geometryInstances[1].attributes.color.color
      .css,
    "#ffcc00ff",
  );
  console.log(
    "✓ render polygon outline instances alongside ordinary line geometry",
  );
}

console.log("VectorTileLineBucket tests passed.");

function createDiagnostics() {
  return {
    counts: {},
    increment(name, value = 1) {
      this.counts[name] = (this.counts[name] ?? 0) + value;
    },
    startTimer() {
      return 0;
    },
    recordDuration() {},
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
