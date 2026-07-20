import assert from "node:assert/strict";

import VectorTileStyleExpressionUtils from "../src/VectorTileStyleExpressionUtils.js";

assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies(
    ["all", ["has", "kind"], ["==", ["get", "status"], "active"]],
    ["case", ["get", "rank"], ["literal", ["get", "ignored"]]],
    [
      "match",
      ["get", "category"],
      ["water", "river"],
      ["get", "waterColor"],
      "other",
      ["get", "fallbackColor"],
    ],
    ["interpolate", ["linear"], ["zoom"], 4, ["get", "low"], 8, 5],
  ),
  {
    all: false,
    properties: [
      "category",
      "fallbackColor",
      "kind",
      "low",
      "rank",
      "status",
      "waterColor",
    ],
  },
);
assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies([
    "get",
    ["get", "fieldName"],
  ]),
  { all: true, properties: [] },
);
assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies(
    ["feature-state", "hover"],
    [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      ["get", "a"],
      0,
    ],
  ),
  { all: false, properties: ["a"] },
);
assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStyleStateDependencies(
    ["feature-state", "hover"],
    [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      ["get", "a"],
      0,
    ],
  ),
  ["hover", "selected"],
);

const context = {
  zoom: 6,
  properties: {
    name: "Central Park",
    kind: "park",
    status: "active",
    area: 120,
    rank: 2,
  },
  state: {
    hover: true,
    selected: "yes",
  },
};

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["get", "name"],
    context,
  ),
  "Central Park",
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["has", "kind"],
    context,
  ),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["has", "missing"],
    context,
  ),
  false,
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["==", ["get", "status"], "active"],
    context,
  ),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    [">", ["get", "area"], 100],
    context,
  ),
  true,
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["all", [">", ["get", "area"], 100], ["==", ["get", "kind"], "park"]],
    context,
  ),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["any", ["==", ["get", "kind"], "water"], ["==", ["get", "rank"], 2]],
    context,
  ),
  true,
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["case", ["==", ["get", "status"], "active"], "#00ff00", "#999999"],
    context,
  ),
  "#00ff00",
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    [
      "match",
      ["get", "kind"],
      "park",
      "#00ff00",
      ["water", "river"],
      "#0000ff",
      "#999999",
    ],
    context,
  ),
  "#00ff00",
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["interpolate", ["linear"], ["zoom"], 4, 1, 8, 5],
    context,
  ),
  3,
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["feature-state", "hover"],
    context,
  ),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["feature-state", "missing"],
    context,
  ),
  null,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["boolean", ["feature-state", "hover"], false],
    context,
  ),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(
    ["boolean", ["feature-state", "selected"], false],
    context,
  ),
  false,
);

assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleFilter(
    ["all", [">=", ["get", "area"], 100], ["==", ["get", "kind"], "park"]],
    { properties: context.properties },
    { zoom: 6 },
  ),
  true,
);

assert.throws(
  () => VectorTileStyleExpressionUtils.validateVectorStyleFilter(() => true),
  /cannot be a function/,
);
assert.throws(
  () =>
    VectorTileStyleExpressionUtils.validateVectorStyleExpression([
      "unsupported",
      ["get", "kind"],
    ]),
  /unsupported/,
);
assert.throws(
  () =>
    VectorTileStyleExpressionUtils.validateVectorStyleExpression([
      "feature-state",
      ["get", "key"],
    ]),
  /feature-state key/,
);
assert.throws(
  () =>
    VectorTileStyleExpressionUtils.validateVectorStyleExpression([
      "boolean",
      ["feature-state", "hover"],
    ]),
  /fallback/,
);

console.log("VectorTileStyleExpression tests passed.");
