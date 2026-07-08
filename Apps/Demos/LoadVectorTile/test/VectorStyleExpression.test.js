import assert from "node:assert/strict";

import {
  evaluateVectorStyleExpression,
  validateVectorStyleExpression,
} from "../src/VectorStyleExpression.js";
import {
  evaluateVectorStyleFilter,
  validateVectorStyleFilter,
} from "../src/VectorStyleFilter.js";

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

console.log("VectorStyleExpression tests passed.");
