import assert from "node:assert/strict";

import {
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

const context = {
  zoom: 6,
  properties: {
    name: "Central Park",
    kind: "park",
    status: "active",
    area: 120,
    rank: 2,
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

console.log("VectorTileStyleExpression tests passed.");
