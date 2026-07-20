import assert from "node:assert/strict";
import {
  Color,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  VerticalOrigin,
} from "../../../../Build/CesiumUnminified/index.js";

const { default: VectorTileSymbolBucket } =
  await import("../src/VectorTileSymbolBucket.js");

{
  const image = { tagName: "IMG" };
  const canvas = { tagName: "CANVAS" };
  assert.equal(
    VectorTileSymbolBucket.resolveVectorTileIconResource("city", {
      city: image,
    }),
    image,
  );
  assert.equal(
    VectorTileSymbolBucket.resolveVectorTileIconResource(
      "https://example.com/a.png",
    ),
    "https://example.com/a.png",
  );
  assert.equal(
    VectorTileSymbolBucket.resolveVectorTileIconResource(image),
    image,
  );
  assert.equal(
    VectorTileSymbolBucket.resolveVectorTileIconResource(canvas),
    canvas,
  );
  console.log("✓ resolve icon registry, URL and image-like resources");
}

{
  assert.equal(
    VectorTileSymbolBucket.evaluateSymbolStyleValue(["get", "name"], {
      properties: { name: "Beijing" },
    }),
    "Beijing",
  );
  assert.equal(
    VectorTileSymbolBucket.evaluateSymbolStyleValue(
      undefined,
      undefined,
      0,
      16,
    ),
    16,
  );
  console.log("✓ evaluate symbol layout values");
}

{
  assert.deepEqual(VectorTileSymbolBucket.translateSymbolAnchor("top-left"), {
    horizontalOrigin: HorizontalOrigin.LEFT,
    verticalOrigin: VerticalOrigin.TOP,
  });
  assert.deepEqual(VectorTileSymbolBucket.translateSymbolAnchor("bottom"), {
    horizontalOrigin: HorizontalOrigin.CENTER,
    verticalOrigin: VerticalOrigin.BOTTOM,
  });
  assert.deepEqual(VectorTileSymbolBucket.translateSymbolAnchor("nope"), {
    horizontalOrigin: HorizontalOrigin.CENTER,
    verticalOrigin: VerticalOrigin.CENTER,
  });
  assert.equal(VectorTileSymbolBucket.createSymbolPixelOffset([12, -4]).x, 12);
  assert.equal(VectorTileSymbolBucket.createSymbolPixelOffset([12, -4]).y, -4);
  const fallbackOffset = VectorTileSymbolBucket.createSymbolPixelOffset([
    undefined,
    4,
  ]);
  assert.equal(fallbackOffset.x, 0);
  assert.equal(fallbackOffset.y, 0);
  assert.equal(
    VectorTileSymbolBucket.createSymbolBackgroundPadding([6, 2]).x,
    6,
  );
  assert.equal(
    VectorTileSymbolBucket.createSymbolBackgroundPadding([6, 2]).y,
    2,
  );
  assert.equal(VectorTileSymbolBucket.createSymbolBackgroundPadding(3).x, 3);
  assert.equal(VectorTileSymbolBucket.createSymbolBackgroundPadding(3).y, 3);
  const fallbackPadding = VectorTileSymbolBucket.createSymbolBackgroundPadding([
    4,
    "bad",
  ]);
  assert.equal(fallbackPadding.x, 0);
  assert.equal(fallbackPadding.y, 0);
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
      iconResolver: VectorTileSymbolBucket.createVectorTileIconResolver({
        city: "city.png",
      }),
      allowPicking: true,
      featureTable: [
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
  ).build(
    {
      positions: new Float64Array([116, 40, 121, 31]),
      featureIndices: new Uint32Array([0, 1]),
    },
    4,
  );

  assert.equal(bucket.length, 2);
  assert.equal(bucket.primitives.length, 0);
  assert.equal(bucket.pointDescriptors.billboards.length, 1);
  assert.equal(bucket.pointDescriptors.billboards[0].id, 0);
  assert.equal(bucket.pointDescriptors.billboards[0].image, "city.png");
  assert.equal(bucket.pointDescriptors.billboards[0].scale, 1.5);
  assert.equal(bucket.pointDescriptors.billboards[0].width, 32);
  assert.equal(bucket.pointDescriptors.billboards[0].height, 24);
  assert.equal(bucket.pointDescriptors.billboards[0].pixelOffset.x, 8);
  assert.equal(bucket.pointDescriptors.billboards[0].pixelOffset.y, 10);
  assert.equal(
    bucket.pointDescriptors.billboards[0].horizontalOrigin,
    HorizontalOrigin.RIGHT,
  );
  assert.equal(
    bucket.pointDescriptors.billboards[0].verticalOrigin,
    VerticalOrigin.BOTTOM,
  );
  assert.equal(
    bucket.pointDescriptors.billboards[0].heightReference,
    HeightReference.RELATIVE_TO_GROUND,
  );
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

  assert.equal(bucket.pointDescriptors.labels.length, 1);
  assert.equal(bucket.pointDescriptors.labels[0].id, 0);
  assert.equal(bucket.pointDescriptors.labels[0].text, "Beijing");
  assert.equal(bucket.pointDescriptors.labels[0].font, '600 18px "Fira Sans"');
  assert.equal(
    bucket.pointDescriptors.labels[0].style,
    LabelStyle.FILL_AND_OUTLINE,
  );
  assert.equal(bucket.pointDescriptors.labels[0].showBackground, true);
  assert.ok(
    Color.equals(
      bucket.pointDescriptors.labels[0].backgroundColor,
      Color.fromCssColorString("#11223344"),
    ),
  );
  assert.notEqual(
    bucket.pointDescriptors.labels[0].backgroundColor.css,
    "#11223344",
  );
  assert.equal(bucket.pointDescriptors.labels[0].backgroundPadding.x, 6);
  assert.equal(bucket.pointDescriptors.labels[0].backgroundPadding.y, 4);
  assert.equal(bucket.pointDescriptors.labels[0].pixelOffset.x, 4);
  assert.equal(bucket.pointDescriptors.labels[0].pixelOffset.y, -6);
  assert.equal(
    bucket.pointDescriptors.labels[0].horizontalOrigin,
    HorizontalOrigin.LEFT,
  );
  assert.equal(
    bucket.pointDescriptors.labels[0].verticalOrigin,
    VerticalOrigin.TOP,
  );
  assert.equal(
    bucket.pointDescriptors.labels[0].heightReference,
    HeightReference.RELATIVE_TO_GROUND,
  );
  const update = bucket.applyStyle(
    {
      ...bucket.styleRule,
      visibility: false,
      paint: {
        ...bucket.styleRule.paint,
        "text-color": "#00ff00ff",
        "text-halo-color": "#ff00ffff",
        "text-background-color": "",
      },
    },
    1,
    {
      changedPaths: [
        "paint.text-color",
        "paint.text-halo-color",
        "paint.text-background-color",
        "visibility",
      ],
    },
  );
  assert.equal(update.pointUpdates, 2);
  assert.ok(
    Color.equals(
      bucket.pointDescriptors.labels[0].fillColor,
      Color.fromCssColorString("#00ff00ff"),
    ),
  );
  assert.ok(
    Color.equals(
      bucket.pointDescriptors.labels[0].outlineColor,
      Color.fromCssColorString("#ff00ffff"),
    ),
  );
  assert.equal(bucket.pointDescriptors.labels[0].showBackground, false);
  assert.equal(bucket.pointDescriptors.labels[0].show, false);
  assert.equal(bucket.pointDescriptors.billboards[0].show, false);
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
  assert.equal(bucket.pointDescriptors.labels.length, 1);
  assert.equal(bucket.pointDescriptors.labels[0].style, LabelStyle.FILL);
  assert.equal(
    bucket.pointDescriptors.labels[0].heightReference,
    HeightReference.NONE,
  );
  assert.equal(bucket.pointDescriptors.labels[0].font, "16px serif");
  assert.equal(bucket.pointDescriptors.labels[0].pixelOffset.x, 0);
  assert.equal(bucket.pointDescriptors.labels[0].pixelOffset.y, 0);
  assert.equal(bucket.pointDescriptors.labels[0].backgroundPadding.x, 0);
  assert.equal(bucket.pointDescriptors.labels[0].backgroundPadding.y, 0);
  assert.equal(
    bucket.pointDescriptors.labels[0].horizontalOrigin,
    HorizontalOrigin.CENTER,
  );
  assert.equal(
    bucket.pointDescriptors.labels[0].verticalOrigin,
    VerticalOrigin.CENTER,
  );
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
  assert.equal(bucket.pointDescriptors.billboards.length, 1);
  assert.equal(
    bucket.pointDescriptors.billboards[0].image,
    "https://example.com/poi.png",
  );
  assert.equal(
    bucket.pointDescriptors.billboards[0].heightReference,
    HeightReference.CLAMP_TO_GROUND,
  );
  assert.equal(bucket.pointDescriptors.billboards[0].width, undefined);
  assert.equal(bucket.pointDescriptors.billboards[0].height, undefined);
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
  assert.equal(buildBucket.pointDescriptors.labels[0].text, "HiddenAtMaxZoom");
  console.log("✓ maxzoom is exclusive and can be ignored while building");
}

console.log("VectorTileSymbolBucket tests passed.");
