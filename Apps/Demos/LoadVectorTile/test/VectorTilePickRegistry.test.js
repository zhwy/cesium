import assert from "node:assert/strict";

import VectorTilePickRegistry from "../src/VectorTilePickRegistry.js";

const features = [
  {
    id: 12,
    sourceFeatureIndex: 7,
    properties: { name: "Main", kind: "road", internal: true },
  },
  {
    id: 15,
    sourceFeatureIndex: 9,
    properties: { name: "Second", kind: "road" },
  },
];
const baseContext = {
  featureTable: features,
  sourceId: "demo",
  sourceLayer: "transport",
  styleLayerId: "roads",
  tile: { x: 1, y: 2, level: 3 },
};

{
  const registry = new VectorTilePickRegistry();
  const primitive = {};
  registry.registerPrimitive(primitive, {
    ...baseContext,
    pickProperties: ["name"],
    instanceFeatureIndices: new Uint32Array([1, 0]),
  });
  const resolved = registry.resolve({ primitive, id: 1 });
  assert.deepEqual(resolved, {
    id: 12,
    properties: { name: "Main" },
    sourceId: "demo",
    sourceLayer: "transport",
    layerId: "roads",
    tile: { x: 1, y: 2, level: 3 },
    featureIndex: 0,
    sourceFeatureIndex: 7,
  });
  resolved.properties.name = "mutated";
  assert.equal(features[0].properties.name, "Main");
  assert.equal(registry.resolve({ primitive, id: 99 }), undefined);
  registry.unregister(primitive);
  assert.equal(registry.resolve({ primitive, id: 1 }), undefined);
}

{
  const registry = new VectorTilePickRegistry();
  const allHandle = {};
  const emptyHandle = {};
  registry.registerPoint(allHandle, baseContext, 0);
  registry.registerPoint(
    emptyHandle,
    { ...baseContext, pickProperties: [] },
    1,
  );
  assert.deepEqual(registry.resolve({ primitive: allHandle }).properties, {
    name: "Main",
    kind: "road",
    internal: true,
  });
  assert.deepEqual(registry.resolve({ primitive: emptyHandle }).properties, {});
  assert.equal(registry.resolve({ primitive: {} }), undefined);
}

console.log("VectorTilePickRegistry tests passed.");
