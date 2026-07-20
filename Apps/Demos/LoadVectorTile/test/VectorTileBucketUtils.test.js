import assert from "node:assert/strict";

class FakePrimitive {
  constructor(options) {
    this.options = options;
  }
}

class FakeGroundPrimitive extends FakePrimitive {}
class FakeGroundPolylinePrimitive extends FakePrimitive {}

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
  PolylineColorAppearance: FakePolylineColorAppearance,
  PerInstanceColorAppearance: FakePerInstanceColorAppearance,
  Color: {
    fromCssColorString: (value) => {
      if (typeof value !== "string") {
        throw new Error("color must be a string");
      }
      return {
        css: value,
        alpha: value === "#112233ff" ? 1.0 : 0.5,
      };
    },
  },
};

globalThis.Cesium = Cesium;

const {
  createGroundPolylinePrimitive,
  createOutlineCartesianLines,
  createPrimitive,
  shouldUseGroundPath,
  requiresGroundHeightOffsetFallback,
} = await import("../src/VectorTileBucketUtils.js");

{
  const diagnostics = createDiagnostics();
  const primitive = createPrimitive(
    [{ geometry: "polygon" }],
    "polygon",
    {
      fillColor: "#112233ff",
      groundPrimitive: true,
    },
    {
      diagnostics,
    },
  );

  assert.ok(primitive instanceof FakeGroundPrimitive);
  assert.equal(diagnostics.counts.createdGeometryInstances, 1);
  assert.equal(diagnostics.counts.createdGroundPrimitives, 1);
  assert.equal(diagnostics.counts.createdPrimitives, 1);
  console.log("✓ create shared polygon primitives with diagnostics accounting");
}

{
  const primitive = createPrimitive([{ geometry: "polygon" }], "polygon", {
    fillColor: ["case", true, "#ffffffff", "#000000ff"],
  });

  assert.equal(primitive.options.appearance.options.translucent, true);
  console.log("✓ create primitive appearance falls back for expression colors");
}

{
  const diagnostics = createDiagnostics();
  const primitive = createGroundPolylinePrimitive([{ geometry: "line" }], {
    diagnostics,
  });

  assert.ok(primitive instanceof FakeGroundPolylinePrimitive);
  assert.equal(diagnostics.counts.createdGroundPolylinePrimitives, 1);
  assert.equal(diagnostics.counts.createdPrimitives, 1);
  console.log(
    "✓ create shared ground polyline primitives with diagnostics accounting",
  );
}

{
  const polygons = {
    positions: new Float64Array([0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5, 0, 0]),
    ringOffsets: new Uint32Array([0, 5]),
  };
  const closedOutline = createOutlineCartesianLines(polygons, 0);
  assert.equal(closedOutline.length, 1);
  assert.equal(closedOutline[0].length, 5);

  const tileBoundLines = createOutlineCartesianLines(
    {
      positions: new Float64Array([
        0, 0, 1, 0, 1, 1, 0.5, 1, 0.5, 0.5, 0, 0.5, 0, 0,
      ]),
      ringOffsets: new Uint32Array([0, 7]),
    },
    0,
    0.0,
    {
      west: 0,
      east: 1,
      south: 0,
      north: 1,
    },
  );
  assert.equal(tileBoundLines.length, 1);
  assert.equal(tileBoundLines[0].length, 3);
  console.log(
    "✓ extract outline lines while skipping segments on tile boundaries",
  );
}

{
  assert.equal(
    shouldUseGroundPath({
      terrain: {
        clampToGround: true,
        heightOffset: 0,
      },
    }),
    true,
  );
  assert.equal(
    requiresGroundHeightOffsetFallback({
      terrain: {
        clampToGround: true,
        heightOffset: 5,
      },
    }),
    true,
  );
  console.log("✓ detect ground-path and terrain fallback decisions");
}

console.log("VectorTileBucketUtils tests passed.");

function createDiagnostics() {
  return {
    counts: {},
    increment(name, value = 1) {
      this.counts[name] = (this.counts[name] ?? 0) + value;
    },
  };
}
