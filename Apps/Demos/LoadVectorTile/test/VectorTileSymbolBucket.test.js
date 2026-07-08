import assert from "node:assert/strict";

import VectorTileSymbolBucket, {
  createVectorTileIconResolver,
  evaluateSymbolStyleValue,
  resolveVectorTileIconResource,
} from "../src/VectorTileSymbolBucket.js";

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

class FakeLabelCollection {
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

const Cesium = {
  BillboardCollection: FakeBillboardCollection,
  LabelCollection: FakeLabelCollection,
  Cartesian3: {
    fromDegrees: (longitude, latitude, height) => ({
      longitude,
      latitude,
      height,
    }),
  },
  Color: {
    fromCssColorString: (value) => ({ css: value }),
  },
  LabelStyle: {
    FILL: "fill",
    FILL_AND_OUTLINE: "fill-and-outline",
  },
  VerticalOrigin: {
    CENTER: "center",
  },
  HeightReference: {
    NONE: "none",
    CLAMP_TO_GROUND: "clamp-to-ground",
    RELATIVE_TO_GROUND: "relative-to-ground",
  },
};

{
  const image = { tagName: "IMG" };
  const canvas = { tagName: "CANVAS" };
  assert.equal(resolveVectorTileIconResource("city", { city: image }), image);
  assert.equal(
    resolveVectorTileIconResource("https://example.com/a.png"),
    "https://example.com/a.png",
  );
  assert.equal(resolveVectorTileIconResource(image), image);
  assert.equal(resolveVectorTileIconResource(canvas), canvas);
  console.log("✓ resolve icon registry, URL and image-like resources");
}

{
  assert.equal(
    evaluateSymbolStyleValue(["get", "name"], {
      properties: { name: "Beijing" },
    }),
    "Beijing",
  );
  assert.equal(evaluateSymbolStyleValue(undefined, undefined, 0, 16), 16);
  console.log("✓ evaluate symbol layout values");
}

{
  const bucket = new VectorTileSymbolBucket(
    {
      id: "poi-symbol",
      type: "symbol",
      sourceLayer: "poi",
      filter: ["==", ["get", "kind"], "city"],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1.5,
        "text-field": ["get", "name"],
        "text-size": ["get", "size"],
      },
      paint: {
        "text-color": "#ff0000ff",
        "text-halo-color": "#000000ff",
        "text-halo-width": 2,
      },
      terrain: {
        clampToGround: true,
        heightOffset: 3,
      },
    },
    {
      Cesium,
      scene: {},
      iconResolver: createVectorTileIconResolver({ city: "city.png" }),
      allowPicking: true,
    },
  ).build(
    {
      positions: new Float64Array([116, 40, 121, 31]),
      metadata: [
        {
          id: 1,
          properties: {
            kind: "city",
            icon: "city",
            name: "Beijing",
            size: 18,
          },
        },
        {
          id: 2,
          properties: {
            kind: "village",
            icon: "city",
            name: "Filtered",
            size: 12,
          },
        },
      ],
    },
    4,
  );

  assert.equal(bucket.length, 2);
  assert.equal(bucket.primitives[0].ready, true);
  assert.equal(bucket.primitives[0].items.length, 1);
  assert.equal(bucket.primitives[0].items[0].image, "city.png");
  assert.equal(bucket.primitives[0].items[0].scale, 1.5);
  assert.equal(
    bucket.primitives[0].items[0].heightReference,
    "relative-to-ground",
  );
  assert.deepEqual(bucket.primitives[0].items[0].position, {
    longitude: 116,
    latitude: 40,
    height: 3,
  });

  assert.equal(bucket.primitives[1].ready, true);
  assert.equal(bucket.primitives[1].items.length, 1);
  assert.equal(bucket.primitives[1].items[0].text, "Beijing");
  assert.equal(bucket.primitives[1].items[0].font, "18px sans-serif");
  assert.equal(bucket.primitives[1].items[0].style, "fill-and-outline");
  assert.equal(
    bucket.primitives[1].items[0].heightReference,
    "relative-to-ground",
  );
  console.log("✓ build icon+text symbol bucket with filter and properties");
}

{
  const bucket = new VectorTileSymbolBucket(
    {
      id: "icons",
      type: "symbol",
      sourceLayer: "poi",
      layout: {
        "icon-image": "https://example.com/poi.png",
      },
      paint: {},
      terrain: {
        clampToGround: true,
      },
    },
    { Cesium, scene: {} },
  ).build(
    {
      positions: new Float64Array([30, 40]),
      metadata: [{ properties: {} }],
    },
    1,
  );

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakeBillboardCollection);
  assert.equal(
    bucket.primitives[0].items[0].image,
    "https://example.com/poi.png",
  );
  assert.equal(
    bucket.primitives[0].items[0].heightReference,
    "clamp-to-ground",
  );
  console.log("✓ build icon-only symbol bucket");
}

{
  const bucket = new VectorTileSymbolBucket(
    {
      id: "labels",
      type: "symbol",
      sourceLayer: "poi",
      layout: {
        "text-field": ["get", "name"],
      },
      paint: {},
      terrain: {},
    },
    { Cesium },
  ).build(
    {
      positions: new Float64Array([10, 20]),
      metadata: [{ properties: { name: "Text only" } }],
    },
    1,
  );

  assert.equal(bucket.length, 1);
  assert.ok(bucket.primitives[0] instanceof FakeLabelCollection);
  assert.equal(bucket.primitives[0].items[0].style, "fill");
  assert.equal(bucket.primitives[0].items[0].heightReference, "none");
  console.log("✓ build text-only symbol bucket");
}

{
  const styleRule = {
    id: "labels-zoom",
    type: "symbol",
    sourceLayer: "poi",
    minzoom: 2,
    maxzoom: 4,
    layout: {
      "text-field": ["get", "name"],
    },
    paint: {},
  };
  const points = {
    positions: new Float64Array([30, 40]),
    metadata: [{ properties: { name: "HiddenAtMaxZoom" } }],
  };

  const hiddenBucket = new VectorTileSymbolBucket(styleRule, {
    Cesium,
  }).build(points, 4);
  assert.equal(hiddenBucket.length, 0);

  const buildBucket = new VectorTileSymbolBucket(styleRule, {
    Cesium,
    ignoreZoomRange: true,
  }).build(points, 4);
  assert.equal(buildBucket.length, 1);
  assert.equal(buildBucket.primitives[0].items[0].text, "HiddenAtMaxZoom");
  console.log("✓ maxzoom is exclusive and can be ignored while building");
}

console.log("VectorTileSymbolBucket tests passed.");
