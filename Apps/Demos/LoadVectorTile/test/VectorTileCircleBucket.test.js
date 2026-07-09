import assert from "node:assert/strict";

class FakeBillboardCollection {
  constructor() {
    this.items = [];
  }

  add(options) {
    this.items.push(options);
  }

  isDestroyed() {
    return false;
  }

  destroy() {}
}

class FakeCartesian2 {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const Cesium = {
  BillboardCollection: FakeBillboardCollection,
  Cartesian2: FakeCartesian2,
  Cartesian3: {
    fromDegrees: (longitude, latitude, height) => ({
      longitude,
      latitude,
      height,
    }),
  },
  HeightReference: {
    NONE: "none",
    CLAMP_TO_GROUND: "clamp-to-ground",
    RELATIVE_TO_GROUND: "relative-to-ground",
  },
};

globalThis.Cesium = Cesium;

const {
  default: VectorTileCircleBucket,
  createCircleCanvas,
  createCirclePixelOffset,
  evaluateCircleColorValue,
  evaluateCircleStyleValue,
  getCircleHeightReference,
  resolveCirclePixelSize,
  resolveCircleRadius,
} = await import("../src/VectorTileCircleBucket.js");

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

  assert.equal(resolveCircleRadius(styleRule, metadata, 4), 8);
  assert.equal(resolveCirclePixelSize(styleRule, metadata, 4), 16);
  assert.equal(
    resolveCircleRadius(
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
    resolveCirclePixelSize(
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
    resolveCircleRadius(
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
    evaluateCircleStyleValue(["get", "radius"], undefined, {
      properties: { radius: 6 },
    }),
    6,
  );
  assert.equal(
    evaluateCircleColorValue(
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
  assert.equal(createCirclePixelOffset([4, -2]).x, 4);
  assert.equal(createCirclePixelOffset([4, -2]).y, -2);
  assert.equal(createCirclePixelOffset(undefined, [3, 1]).x, 3);
  assert.equal(createCirclePixelOffset(undefined, [3, 1]).y, 1);
  assert.equal(createCirclePixelOffset([1, "bad"]), undefined);
  console.log("✓ evaluate circle style values and pixel offsets");
}

{
  const canvas = createCircleCanvas(16, "#ff6600cc", "#ffffffff", 2);
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
  }).build(
    {
      positions: new Float64Array([116, 40, 117, 41, 120, 30]),
      metadata: [
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
        {
          id: 3,
          properties: {
            kind: "village",
            radius: 4,
            fill: "#00ff00ff",
            outlineWidth: 1,
            offset: [0, 0],
          },
        },
      ],
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
    "relative-to-ground",
  );
  assert.equal(
    bucket.pointDescriptors.billboards[0].disableDepthTestDistance,
    1000,
  );
  assert.equal(bucket.pointDescriptors.billboards[0].pixelOffset.x, 5);
  assert.equal(bucket.pointDescriptors.billboards[0].pixelOffset.y, 7);
  assert.deepEqual(bucket.pointDescriptors.billboards[0].position, {
    longitude: 116,
    latitude: 40,
    height: 3,
  });
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
  assert.equal(
    bucket.pointDescriptors.billboards[0].id.properties.kind,
    "city",
  );
  console.log(
    "✓ build circle billboards with terrain, picking, alias precedence and cache reuse",
  );
}

{
  assert.equal(getCircleHeightReference({}, { terrain: {} }), "none");
  assert.equal(
    getCircleHeightReference(
      {},
      {
        terrain: {
          clampToGround: true,
          heightOffset: 0,
        },
      },
    ),
    "clamp-to-ground",
  );
  assert.equal(
    getCircleHeightReference(
      {},
      {
        terrain: {
          clampToGround: true,
          heightOffset: 2,
        },
      },
    ),
    "relative-to-ground",
  );
  console.log("✓ map circle terrain settings to billboard height references");
}

console.log("VectorTileCircleBucket tests passed.");
