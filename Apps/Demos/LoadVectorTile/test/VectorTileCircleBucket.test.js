import assert from "node:assert/strict";
import { HeightReference } from "../../../../Build/CesiumUnminified/index.js";

const { default: VectorTileCircleBucket } =
  await import("../src/VectorTileCircleBucket.js");

{
  const styleRule = {
    paint: {
      "circle-radius": ["get", "radius"],
      pixelSize: 30,
    },
  };
  const metadata = {
    properties: {
      radius: 8,
      size: 18,
    },
  };

  assert.equal(
    VectorTileCircleBucket.resolveCircleRadius(styleRule, metadata, 4),
    8,
  );
  assert.equal(
    VectorTileCircleBucket.resolveCirclePixelSize(styleRule, metadata, 4),
    16,
  );
  assert.equal(
    VectorTileCircleBucket.resolveCircleRadius(
      {
        paint: {
          pixelSize: ["get", "size"],
        },
      },
      metadata,
      4,
    ),
    9,
  );
  assert.equal(
    VectorTileCircleBucket.resolveCirclePixelSize(
      {
        paint: {
          pixelSize: ["get", "size"],
        },
      },
      metadata,
      4,
    ),
    18,
  );
  assert.equal(
    VectorTileCircleBucket.resolveCircleRadius(
      {
        paint: {
          "circle-radius": "bad",
        },
      },
      metadata,
      4,
    ),
    5,
  );
  console.log("✓ resolve circle radius and pixel size with alias precedence");
}

{
  assert.equal(
    VectorTileCircleBucket.evaluateCircleStyleValue(
      ["get", "radius"],
      undefined,
      {
        properties: { radius: 6 },
      },
    ),
    6,
  );
  assert.equal(
    VectorTileCircleBucket.evaluateCircleColorValue(
      undefined,
      ["get", "color"],
      {
        properties: { color: "#ff0000ff" },
      },
      0,
      "#000000ff",
    ),
    "#ff0000ff",
  );
  assert.equal(VectorTileCircleBucket.createCirclePixelOffset([4, -2]).x, 4);
  assert.equal(VectorTileCircleBucket.createCirclePixelOffset([4, -2]).y, -2);
  assert.equal(
    VectorTileCircleBucket.createCirclePixelOffset(undefined, [3, 1]).x,
    3,
  );
  assert.equal(
    VectorTileCircleBucket.createCirclePixelOffset(undefined, [3, 1]).y,
    1,
  );
  const fallbackOffset = VectorTileCircleBucket.createCirclePixelOffset([
    1,
    "bad",
  ]);
  assert.equal(fallbackOffset.x, 0);
  assert.equal(fallbackOffset.y, 0);
  console.log("✓ evaluate circle style values and pixel offsets");
}

{
  const canvas = VectorTileCircleBucket.createCircleCanvas(
    16,
    "#ff6600cc",
    "#ffffffff",
    2,
  );
  assert.equal(canvas.width, 16);
  assert.equal(canvas.height, 16);
  assert.equal(canvas._vectorTileCircle.pixelSize, 16);
  assert.equal(canvas._vectorTileCircle.outlineWidth, 2);
  console.log("✓ create circle canvases with pixel-size metadata");
}

{
  const styleRule = {
    id: "city-circle",
    type: "circle",
    sourceLayer: "places",
    filter: ["==", ["get", "kind"], "city"],
    paint: {
      "circle-radius": ["get", "radius"],
      pixelSize: 30,
      "circle-color": ["get", "fill"],
      color: "#00ff00ff",
      "circle-outline-color": "#ffffffff",
      outlineColor: "#000000ff",
      "circle-outline-width": ["get", "outlineWidth"],
      outlineWidth: 9,
      "circle-offset": ["get", "offset"],
      offset: [0, 0],
    },
    terrain: {
      clampToGround: true,
      heightOffset: 3,
      disableDepthTestDistance: 1000,
    },
  };

  const bucket = new VectorTileCircleBucket(styleRule, {
    scene: {},
    allowPicking: true,
    featureTable: [
      {
        id: 1,
        properties: {
          kind: "city",
          radius: 8,
          fill: "#ff6600cc",
          outlineWidth: 2,
          offset: [5, 7],
        },
      },
      {
        id: 2,
        properties: {
          kind: "city",
          radius: 8,
          fill: "#ff6600cc",
          outlineWidth: 2,
          offset: [5, 7],
        },
      },
      { id: 3, properties: { kind: "village" } },
    ],
  }).build(
    {
      positions: new Float64Array([116, 40, 117, 41, 120, 30]),
      featureIndices: new Uint32Array([0, 1, 2]),
    },
    4,
  );

  assert.equal(bucket.length, 2);
  assert.equal(bucket.primitives.length, 0);
  assert.equal(bucket.pointDescriptors.billboards.length, 2);
  assert.equal(bucket.pointDescriptors.billboards[0].width, 16);
  assert.equal(bucket.pointDescriptors.billboards[0].height, 16);
  assert.equal(
    bucket.pointDescriptors.billboards[0].heightReference,
    HeightReference.RELATIVE_TO_GROUND,
  );
  assert.equal(
    bucket.pointDescriptors.billboards[0].disableDepthTestDistance,
    1000,
  );
  assert.equal(bucket.pointDescriptors.billboards[0].pixelOffset.x, 5);
  assert.equal(bucket.pointDescriptors.billboards[0].pixelOffset.y, 7);
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
  assert.equal(
    bucket.pointDescriptors.billboards[0].image._vectorTileCircle.fillColor,
    "#ff6600cc",
  );
  assert.equal(
    bucket.pointDescriptors.billboards[0].image._vectorTileCircle.outlineWidth,
    2,
  );
  assert.equal(
    bucket.pointDescriptors.billboards[0].image,
    bucket.pointDescriptors.billboards[1].image,
  );
  assert.equal(bucket.pointDescriptors.billboards[0].id, 0);
  assert.equal(
    bucket.pointDescriptors.billboards[0]._vectorTileFeatureIndex,
    0,
  );
  const updatedStyleRule = {
    ...styleRule,
    visibility: false,
    paint: {
      ...styleRule.paint,
      "circle-color": "#00ffffff",
    },
  };
  const update = bucket.applyStyle(updatedStyleRule, 1, {
    changedPaths: ["paint.circle-color", "visibility"],
  });
  assert.equal(update.pointUpdates, 2);
  assert.equal(
    bucket.pointDescriptors.billboards[0].image._vectorTileCircle.fillColor,
    "#00ffffff",
  );
  assert.equal(bucket.pointDescriptors.billboards[0].show, false);
  console.log(
    "✓ build circle billboards with terrain, picking, alias precedence and cache reuse",
  );
}

{
  assert.equal(
    VectorTileCircleBucket.getCircleHeightReference({}, { terrain: {} }),
    HeightReference.NONE,
  );
  assert.equal(
    VectorTileCircleBucket.getCircleHeightReference(
      {},
      {
        terrain: {
          clampToGround: true,
          heightOffset: 0,
        },
      },
    ),
    HeightReference.CLAMP_TO_GROUND,
  );
  assert.equal(
    VectorTileCircleBucket.getCircleHeightReference(
      {},
      {
        terrain: {
          clampToGround: true,
          heightOffset: 2,
        },
      },
    ),
    HeightReference.RELATIVE_TO_GROUND,
  );
  console.log("✓ map circle terrain settings to billboard height references");
}

console.log("VectorTileCircleBucket tests passed.");
