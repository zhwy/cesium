import assert from "node:assert/strict";

import {
  collectVectorStyleStateDependencies,
  collectVectorStylePropertyDependencies,
  evaluateVectorStyleExpression,
  evaluateVectorStyleFilter,
  validateVectorStyleExpression,
  validateVectorStyleFilter,
} from "../src/VectorTileStyleExpression.js";

assert.deepEqual(
  collectVectorStylePropertyDependencies(
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
  collectVectorStylePropertyDependencies(["get", ["get", "fieldName"]]),
  { all: true, properties: [] },
);
assert.deepEqual(
  collectVectorStylePropertyDependencies(
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
  collectVectorStyleStateDependencies(
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
  evaluateVectorStyleExpression(["get", "name"], context),
  "Central Park",
);

assert.equal(evaluateVectorStyleExpression(["has", "kind"], context), true);
assert.equal(evaluateVectorStyleExpression(["has", "missing"], context), false);

assert.equal(
  evaluateVectorStyleExpression(["==", ["get", "status"], "active"], context),
  true,
);
assert.equal(
  evaluateVectorStyleExpression([">", ["get", "area"], 100], context),
  true,
);

assert.equal(
  evaluateVectorStyleExpression(
    ["all", [">", ["get", "area"], 100], ["==", ["get", "kind"], "park"]],
    context,
  ),
  true,
);
assert.equal(
  evaluateVectorStyleExpression(
    ["any", ["==", ["get", "kind"], "water"], ["==", ["get", "rank"], 2]],
    context,
  ),
  true,
);

assert.equal(
  evaluateVectorStyleExpression(
    ["case", ["==", ["get", "status"], "active"], "#00ff00", "#999999"],
    context,
  ),
  "#00ff00",
);

assert.equal(
  evaluateVectorStyleExpression(
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
  evaluateVectorStyleExpression(
    ["interpolate", ["linear"], ["zoom"], 4, 1, 8, 5],
    context,
  ),
  3,
);

assert.equal(
  evaluateVectorStyleExpression(["feature-state", "hover"], context),
  true,
);
assert.equal(
  evaluateVectorStyleExpression(["feature-state", "missing"], context),
  null,
);
assert.equal(
  evaluateVectorStyleExpression(
    ["boolean", ["feature-state", "hover"], false],
    context,
  ),
  true,
);
assert.equal(
  evaluateVectorStyleExpression(
    ["boolean", ["feature-state", "selected"], false],
    context,
  ),
  false,
);

assert.equal(
  evaluateVectorStyleFilter(
    ["all", [">=", ["get", "area"], 100], ["==", ["get", "kind"], "park"]],
    { properties: context.properties },
    { zoom: 6 },
  ),
  true,
);

assert.throws(
  () => validateVectorStyleFilter(() => true),
  /cannot be a function/,
);
assert.throws(
  () => validateVectorStyleExpression(["unsupported", ["get", "kind"]]),
  /unsupported/,
);
assert.throws(
  () => validateVectorStyleExpression(["feature-state", ["get", "key"]]),
  /feature-state key/,
);
assert.throws(
  () => validateVectorStyleExpression(["boolean", ["feature-state", "hover"]]),
  /fallback/,
);

console.log("VectorTileStyleExpression tests passed.");
