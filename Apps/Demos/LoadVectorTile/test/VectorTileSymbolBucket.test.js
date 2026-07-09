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
  },
  Color: {
    fromCssColorString: (value) => ({
      css: value,
      alpha: extractAlpha(value),
    }),
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
};

globalThis.Cesium = Cesium;

const {
  default: VectorTileSymbolBucket,
  createSymbolBackgroundPadding,
  createSymbolPixelOffset,
  createVectorTileIconResolver,
  evaluateSymbolStyleValue,
  resolveVectorTileIconResource,
  translateSymbolAnchor,
} = await import("../src/VectorTileSymbolBucket.js");

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
  assert.deepEqual(translateSymbolAnchor("top-left"), {
    horizontalOrigin: "left",
    verticalOrigin: "top",
  });
  assert.deepEqual(translateSymbolAnchor("bottom"), {
    horizontalOrigin: "center",
    verticalOrigin: "bottom",
  });
  assert.deepEqual(translateSymbolAnchor("nope"), {
    horizontalOrigin: "center",
    verticalOrigin: "center",
  });
  assert.ok(createSymbolPixelOffset([12, -4]) instanceof FakeCartesian2);
  assert.equal(createSymbolPixelOffset([12, -4]).x, 12);
  assert.equal(createSymbolPixelOffset([12, -4]).y, -4);
  assert.equal(createSymbolPixelOffset([undefined, 4]), undefined);
  assert.ok(createSymbolBackgroundPadding([6, 2]) instanceof FakeCartesian2);
  assert.equal(createSymbolBackgroundPadding([6, 2]).x, 6);
  assert.equal(createSymbolBackgroundPadding([6, 2]).y, 2);
  assert.equal(createSymbolBackgroundPadding(3).x, 3);
  assert.equal(createSymbolBackgroundPadding(3).y, 3);
  assert.equal(createSymbolBackgroundPadding([4, "bad"]), undefined);
  console.log("✓ translate anchors and pixel-based symbol offsets");
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
        "icon-anchor": "bottom-right",
        "icon-offset": ["get", "iconOffset"],
        "icon-width": ["get", "iconWidth"],
        "icon-height": ["get", "iconHeight"],
        "text-field": ["get", "name"],
        "text-size": ["get", "size"],
        "text-font": ["get", "font"],
        "text-anchor": "top-left",
        "text-offset": ["get", "textOffset"],
      },
      paint: {
        "text-color": "#ff0000ff",
        "text-halo-color": "#000000ff",
        "text-halo-width": 2,
        "text-background-color": "#11223344",
        "text-background-padding": [6, 4],
      },
      terrain: {
        clampToGround: true,
        heightOffset: 3,
      },
    },
    {
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
            iconOffset: [8, 10],
            iconWidth: 32,
            iconHeight: 24,
            name: "Beijing",
            size: 18,
            font: '600 18px "Fira Sans"',
            textOffset: [4, -6],
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
  assert.equal(bucket.primitives[0].items[0].width, 32);
  assert.equal(bucket.primitives[0].items[0].height, 24);
  assert.equal(bucket.primitives[0].items[0].pixelOffset.x, 8);
  assert.equal(bucket.primitives[0].items[0].pixelOffset.y, 10);
  assert.equal(bucket.primitives[0].items[0].horizontalOrigin, "right");
  assert.equal(bucket.primitives[0].items[0].verticalOrigin, "bottom");
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
  assert.equal(bucket.primitives[1].items[0].font, '600 18px "Fira Sans"');
  assert.equal(bucket.primitives[1].items[0].style, "fill-and-outline");
  assert.equal(bucket.primitives[1].items[0].showBackground, true);
  assert.equal(bucket.primitives[1].items[0].backgroundColor.css, "#11223344");
  assert.equal(bucket.primitives[1].items[0].backgroundPadding.x, 6);
  assert.equal(bucket.primitives[1].items[0].backgroundPadding.y, 4);
  assert.equal(bucket.primitives[1].items[0].pixelOffset.x, 4);
  assert.equal(bucket.primitives[1].items[0].pixelOffset.y, -6);
  assert.equal(bucket.primitives[1].items[0].horizontalOrigin, "left");
  assert.equal(bucket.primitives[1].items[0].verticalOrigin, "top");
  assert.equal(
    bucket.primitives[1].items[0].heightReference,
    "relative-to-ground",
  );
  console.log(
    "✓ build icon+text symbol bucket with anchors, background and expressions",
  );
}

{
  const bucket = new VectorTileSymbolBucket(
    {
      id: "labels",
      type: "symbol",
      sourceLayer: "poi",
      layout: {
        "text-field": ["get", "name"],
        "text-size": "bad-size",
        "text-font-family": "serif",
        "text-offset": [undefined, 2],
      },
      paint: {
        "text-background-padding": [4, "bad"],
        "text-halo-width": "bad-outline",
      },
      terrain: {},
    },
    {},
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
  assert.equal(bucket.primitives[0].items[0].font, "16px serif");
  assert.equal(bucket.primitives[0].items[0].pixelOffset, undefined);
  assert.equal(bucket.primitives[0].items[0].backgroundPadding, undefined);
  assert.equal(bucket.primitives[0].items[0].horizontalOrigin, "center");
  assert.equal(bucket.primitives[0].items[0].verticalOrigin, "center");
  console.log(
    "✓ fallback invalid symbol numbers and preserve stable default anchor",
  );
}

{
  const bucket = new VectorTileSymbolBucket(
    {
      id: "icons",
      type: "symbol",
      sourceLayer: "poi",
      layout: {
        "icon-image": "https://example.com/poi.png",
        "icon-width": "bad-width",
        "icon-height": ["get", "missingHeight"],
      },
      paint: {},
      terrain: {
        clampToGround: true,
      },
    },
    { scene: {} },
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
  assert.equal(bucket.primitives[0].items[0].width, undefined);
  assert.equal(bucket.primitives[0].items[0].height, undefined);
  console.log(
    "✓ omit invalid explicit icon sizes and keep source image dimensions",
  );
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

  const hiddenBucket = new VectorTileSymbolBucket(styleRule, {}).build(
    points,
    4,
  );
  assert.equal(hiddenBucket.length, 0);

  const buildBucket = new VectorTileSymbolBucket(styleRule, {
    ignoreZoomRange: true,
  }).build(points, 4);
  assert.equal(buildBucket.length, 1);
  assert.equal(buildBucket.primitives[0].items[0].text, "HiddenAtMaxZoom");
  console.log("✓ maxzoom is exclusive and can be ignored while building");
}

console.log("VectorTileSymbolBucket tests passed.");

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
