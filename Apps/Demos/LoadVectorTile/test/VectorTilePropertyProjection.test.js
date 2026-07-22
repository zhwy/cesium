import assert from "node:assert/strict";

import VectorTilePropertyProjectionUtils from "../src/VectorTilePropertyProjectionUtils.js";
import VectorTileStyleUtils from "../src/VectorTileStyleUtils.js";

function createStyle(source = {}) {
  return VectorTileStyleUtils.normalizeStyleDocument({
    sources: { demo: { type: "vector", ...source } },
    layers: [
      {
        id: "roads",
        type: "line",
        source: "demo",
        sourceLayer: "transport",
        filter: ["has", "kind"],
        paint: {
          "line-color": ["match", ["get", "class"], "a", "red", "blue"],
        },
        layout: { custom: ["literal", ["get", "ignored"]] },
      },
    ],
  });
}

{
  const original = ["name", "year"];
  const style = createStyle({ pickProperties: original });
  original.push("mutated");
  assert.deepEqual(style.sources.demo.pickProperties, ["name", "year"]);
  assert.deepEqual(
    VectorTileStyleUtils.normalizeStyleDocument(createStyle()).sources.demo
      .pickProperties,
    undefined,
  );
  assert.deepEqual(
    createStyle({ pickProperties: [] }).sources.demo.pickProperties,
    [],
  );
  for (const pickProperties of ["name", [""], [1], ["name", "name"]]) {
    assert.throws(() => createStyle({ pickProperties }), /pickProperties/);
  }
}

{
  const style = createStyle({ pickProperties: ["name"] });
  style.layers[0].paint["line-color"] = [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    ["get", "highlightColor"],
    ["get", "class"],
  ];
  const projection =
    VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
      style,
      {
        allowPicking: true,
        pickProperties: style.sources.demo.pickProperties,
      },
    ).transport;
  assert.deepEqual(projection.style, {
    all: false,
    properties: ["class", "highlightColor", "kind"],
  });
  assert.deepEqual(projection.pick, {
    enabled: true,
    all: false,
    properties: ["name"],
  });
  assert.deepEqual(projection.properties, [
    "class",
    "highlightColor",
    "kind",
    "name",
  ]);
  assert.deepEqual(
    VectorTilePropertyProjectionUtils.projectVectorTileProperties(
      { class: "a", kind: "road", name: "Main", hidden: 1 },
      projection,
    ),
    { class: "a", kind: "road", name: "Main" },
  );
  assert.deepEqual(
    VectorTilePropertyProjectionUtils.getPublicPickProperties(
      { class: "a", name: "Main" },
      ["name"],
    ),
    { name: "Main" },
  );
}

{
  const style = createStyle();
  const disabled =
    VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
      style,
      {
        allowPicking: false,
      },
    ).transport;
  assert.equal(disabled.retainAll, false);
  assert.deepEqual(disabled.properties, ["class", "kind"]);
  assert.deepEqual(disabled.pick, {
    enabled: false,
    all: false,
    properties: [],
  });

  const defaultPicking =
    VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
      style,
      {
        allowPicking: true,
      },
    ).transport;
  assert.equal(defaultPicking.retainAll, true);
  assert.equal(defaultPicking.pick.all, true);
}

{
  const style = createStyle({ pickProperties: [] });
  style.layers[0].paint["line-color"] = ["get", ["get", "fieldName"]];
  const projection =
    VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
      style,
      {
        allowPicking: true,
        pickProperties: [],
      },
    ).transport;
  assert.equal(projection.style.all, true);
  assert.equal(projection.retainAll, true);
}

{
  const style = createStyle({ pickProperties: [] });
  style.layers[0].filter = [
    "all",
    ["in", ["get", "kind"], ["literal", ["road", "rail"]]],
    ["!", ["has", "hidden"]],
  ];
  style.layers[0].paint["line-color"] = [
    "coalesce",
    ["get", "preferredColor"],
    ["get", "fallbackColor"],
  ];
  style.layers[0].layout.custom = [
    "concat",
    ["upcase", ["get", "label"]],
    ["to-string", ["id"]],
    ["literal", ["get", "ignored"]],
  ];

  const projection =
    VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
      style,
      {
        allowPicking: true,
        pickProperties: [],
      },
    ).transport;
  assert.deepEqual(projection.style, {
    all: false,
    properties: ["fallbackColor", "hidden", "kind", "label", "preferredColor"],
  });
  assert.deepEqual(
    VectorTilePropertyProjectionUtils.projectVectorTileProperties(
      {
        fallbackColor: "blue",
        hidden: false,
        kind: "road",
        label: "main",
        preferredColor: "red",
        ignored: true,
      },
      projection,
    ),
    {
      fallbackColor: "blue",
      hidden: false,
      kind: "road",
      label: "main",
      preferredColor: "red",
    },
  );
}

console.log("VectorTilePropertyProjection tests passed.");
