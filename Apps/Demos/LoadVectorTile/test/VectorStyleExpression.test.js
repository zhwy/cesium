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
  VectorTileStyleExpressionUtils.isVectorStyleExpression(["get", "name"]),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.isVectorStyleExpression([1, 2]),
  false,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleValue(
    ["get", "name"],
    { id: 7, properties: context.properties },
    { zoom: context.zoom, state: context.state },
    "fallback",
  ),
  "Central Park",
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleValue(
    ["feature-state", "hover"],
    { id: 7, properties: context.properties },
    { zoom: context.zoom, state: context.state },
    false,
  ),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleValue(
    ["get", "missing"],
    { properties: context.properties },
    { zoom: context.zoom },
    "fallback",
  ),
  "fallback",
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleValue(
    "constant",
    undefined,
    {},
    "fallback",
  ),
  "constant",
);

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
  /operator "feature-state".*string key.*expression\[1\]/,
);
assert.throws(
  () =>
    VectorTileStyleExpressionUtils.validateVectorStyleExpression([
      "boolean",
      ["feature-state", "hover"],
    ]),
  /operator "boolean".*exactly 2 operand/,
);

const exactArityExpressions = [
  ["literal", ["get", "constant"]],
  ["get", "name"],
  ["has", "name"],
  ["feature-state", "hover"],
  ["boolean", true, false],
  ["!", true],
  ["==", 1, 1],
  ["!=", 1, 2],
  [">", 2, 1],
  [">=", 2, 1],
  ["<", 1, 2],
  ["<=", 1, 2],
  ["in", "a", "abc"],
  ["zoom"],
  ["length", "abc"],
  ["at", 0, ["literal", ["a"]]],
  ["to-string", 1],
  ["upcase", "a"],
  ["downcase", "A"],
  ["id"],
];

for (const expression of exactArityExpressions) {
  VectorTileStyleExpressionUtils.validateVectorStyleExpression(expression);
  const operator = expression[0];
  if (expression.length > 1) {
    assert.throws(
      () =>
        VectorTileStyleExpressionUtils.validateVectorStyleExpression(
          expression.slice(0, -1),
          "layer.demo.value",
        ),
      new RegExp(`layer\\.demo\\.value.*operator "${operator}".*operand`),
    );
  }
  assert.throws(
    () =>
      VectorTileStyleExpressionUtils.validateVectorStyleExpression(
        [...expression, null],
        "layer.demo.value",
      ),
    new RegExp(`layer\\.demo\\.value.*operator "${operator}".*operand`),
  );
}

for (const expression of [
  ["all", true],
  ["any", false],
  ["concat", "a"],
  ["coalesce", null, "fallback"],
]) {
  VectorTileStyleExpressionUtils.validateVectorStyleExpression(expression);
  assert.throws(
    () =>
      VectorTileStyleExpressionUtils.validateVectorStyleExpression([
        expression[0],
        ...expression.slice(1, -1),
      ]),
    new RegExp(`operator "${expression[0]}".*at least`),
  );
}

for (const expression of [
  ["index-of", "a", "abc"],
  ["index-of", "a", "abc", 1],
  ["slice", "abc", 1],
  ["slice", "abc", 1, 2],
]) {
  VectorTileStyleExpressionUtils.validateVectorStyleExpression(expression);
}
for (const expression of [
  ["index-of", "a"],
  ["index-of", "a", "abc", 0, 1],
  ["slice", "abc"],
  ["slice", "abc", 0, 1, 2],
]) {
  assert.throws(
    () =>
      VectorTileStyleExpressionUtils.validateVectorStyleExpression(expression),
    /operator "(?:index-of|slice)".*operand/,
  );
}

for (const expression of [
  ["case", true, "yes", "no"],
  ["match", "a", "a", 1, 0],
  ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 2],
]) {
  VectorTileStyleExpressionUtils.validateVectorStyleExpression(expression);
}
for (const [expression, message] of [
  [["case", true, "yes", false, "no"], /operator "case".*fallback/],
  [["match", "a", "a", 1, "b", 2], /operator "match".*fallback/],
  [
    ["interpolate", ["linear"], ["zoom"], 0, 1],
    /operator "interpolate".*at least 6 operand/,
  ],
  [
    ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 2, 20],
    /operator "interpolate".*stop\/output pairs/,
  ],
  [
    ["interpolate", ["linear", 2], ["zoom"], 0, 1, 10, 2],
    /operator "interpolate".*\["linear"\].*expression\[1\]/,
  ],
  [["linear"], /unsupported.*linear/],
  [["literal"], /operator "literal".*operand/],
  [["literal", [], []], /operator "literal".*operand/],
]) {
  assert.throws(
    () =>
      VectorTileStyleExpressionUtils.validateVectorStyleExpression(expression),
    message,
  );
  assert.equal(
    VectorTileStyleExpressionUtils.isWorkerSupportedVectorStyleExpression(
      expression,
    ),
    false,
  );
}

const evaluate = (expression, overrides = {}) =>
  VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(expression, {
    ...context,
    ...overrides,
  });

assert.equal(evaluate(["!", false]), true);
assert.equal(evaluate(["!", true]), false);
assert.equal(evaluate(["!", 0]), undefined);
assert.equal(evaluate(["in", "park", ["literal", ["park", "water"]]]), true);
assert.equal(evaluate(["in", 2, ["literal", ["2", 2]]]), true);
assert.equal(evaluate(["in", 2, ["literal", ["2"]]]), false);
assert.equal(evaluate(["in", "tral", "Central Park"]), true);
assert.equal(evaluate(["in", 1, "123"]), undefined);
assert.equal(evaluate(["in", "a", 123]), undefined);

assert.equal(evaluate(["index-of", "a", "banana"]), 1);
assert.equal(evaluate(["index-of", "a", "banana", 2]), 3);
assert.equal(evaluate(["index-of", "a", "banana", -2]), 1);
assert.equal(evaluate(["index-of", 2, ["literal", [1, 2, 2]], 2]), 2);
assert.equal(evaluate(["index-of", "x", "banana"]), -1);
assert.equal(evaluate(["index-of", "a", 2]), undefined);
assert.equal(evaluate(["index-of", "a", "banana", 1.5]), undefined);

assert.equal(evaluate(["slice", "Central", 1, 4]), "ent");
assert.equal(evaluate(["slice", "Central", -4]), "tral");
assert.deepEqual(evaluate(["slice", ["literal", [1, 2, 3, 4]], 1, -1]), [2, 3]);
assert.equal(evaluate(["slice", 123, 0]), undefined);
assert.equal(evaluate(["slice", "abc", 0.5]), undefined);
assert.equal(evaluate(["length", "Central"]), 7);
assert.equal(evaluate(["length", ["literal", [1, 2, 3]]]), 3);
assert.equal(evaluate(["length", 123]), undefined);
assert.equal(evaluate(["at", 1, ["literal", ["a", "b"]]]), "b");
assert.equal(evaluate(["at", -1, ["literal", ["a", "b"]]]), undefined);
assert.equal(evaluate(["at", 2, ["literal", ["a", "b"]]]), undefined);
assert.equal(evaluate(["at", 0.5, ["literal", ["a"]]]), undefined);
assert.equal(evaluate(["at", 0, "abc"]), undefined);

assert.equal(evaluate(["to-string", "text"]), "text");
assert.equal(evaluate(["to-string", 12]), "12");
assert.equal(evaluate(["to-string", false]), "false");
assert.equal(evaluate(["to-string", null]), "");
assert.equal(evaluate(["to-string", ["get", "missing"]]), "");
assert.equal(evaluate(["to-string", ["literal", [1, "a"]]]), '[1,"a"]');
assert.equal(
  evaluate(["to-string", ["literal", { type: "park", rank: 2 }]]),
  '{"type":"park","rank":2}',
);
assert.equal(
  evaluate(["to-string", ["get", "date"]], {
    properties: { date: new Date(0) },
  }),
  undefined,
);
assert.equal(
  evaluate([
    "concat",
    "rank=",
    ["get", "rank"],
    ", missing=",
    ["get", "missing"],
  ]),
  "rank=2, missing=",
);
assert.equal(evaluate(["upcase", "Straße"]), "STRASSE");
assert.equal(evaluate(["downcase", "ÄBC"]), "äbc");
assert.equal(evaluate(["upcase", 1]), undefined);

assert.equal(
  evaluate(["coalesce", ["get", "missing"], null, false, "fallback"]),
  false,
);
assert.equal(evaluate(["coalesce", ["get", "missing"], null]), undefined);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleValue(
    ["coalesce", ["get", "missing"], null],
    { properties: {} },
    {},
    "outer fallback",
  ),
  "outer fallback",
);
assert.equal(evaluate(["id"], { id: "feature-7" }), "feature-7");
assert.equal(evaluate(["id"], { id: 0 }), 0);
assert.equal(evaluate(["id"], { id: undefined }), undefined);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleValue(["id"], undefined, {
    id: 9,
  }),
  9,
);

assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies([
    "concat",
    ["get", "first"],
    ["to-string", ["get", "count"]],
    ["coalesce", ["get", "nickname"], ["get", "name"]],
    ["literal", ["get", "ignored"]],
    ["id"],
  ]),
  {
    all: false,
    properties: ["count", "first", "name", "nickname"],
  },
);
assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies([
    "concat",
    ["get", ["get", "fieldName"]],
    "x",
  ]),
  { all: true, properties: [] },
);
assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStyleStateDependencies(
    ["coalesce", ["feature-state", "hover"], ["get", "name"]],
    ["literal", ["feature-state", "ignored"]],
  ),
  ["hover"],
);
assert.deepEqual(
  VectorTileStyleExpressionUtils.collectVectorStylePropertyDependencies(["id"]),
  { all: false, properties: [] },
);

const workerFilter = [
  "all",
  ["!", ["has", "hidden"]],
  ["in", ["get", "kind"], ["literal", ["park", "water"]]],
  [">", ["length", ["get", "name"]], 3],
];
assert.equal(
  VectorTileStyleExpressionUtils.isWorkerSupportedVectorStyleFilter(
    workerFilter,
  ),
  true,
);
assert.equal(
  VectorTileStyleExpressionUtils.evaluateVectorStyleFilter(
    workerFilter,
    { id: 7, properties: context.properties },
    { zoom: 6 },
  ),
  Boolean(evaluate(workerFilter)),
);

const { default: VectorTileSymbolBucket } =
  await import("../src/VectorTileSymbolBucket.js");
const symbolBucket = new VectorTileSymbolBucket(
  {
    id: "expression-label",
    type: "symbol",
    sourceLayer: "poi",
    layout: {
      "text-field": [
        "concat",
        ["upcase", ["coalesce", ["get", "name"], "unknown"]],
        " #",
        ["to-string", ["id"]],
      ],
    },
    paint: {},
    terrain: {},
  },
  {},
).build(
  {
    positions: new Float64Array([116, 40]),
    metadata: [{ id: 42, properties: {} }],
  },
  6,
);
assert.equal(symbolBucket.pointDescriptors.labels.length, 1);
assert.equal(symbolBucket.pointDescriptors.labels[0].text, "UNKNOWN #42");

console.log("VectorTileStyleExpression tests passed.");
