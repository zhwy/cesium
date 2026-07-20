import assert from "node:assert/strict";

import VectorTileFeatureStateUtils from "../src/VectorTileFeatureStateUtils.js";
import VectorTileFeatureStateStore from "../src/VectorTileFeatureStateStore.js";

{
  assert.equal(
    VectorTileFeatureStateUtils.normalizePromoteId("object_id", "demo"),
    "object_id",
  );
  assert.deepEqual(
    VectorTileFeatureStateUtils.normalizePromoteId(
      { roads: "road_id" },
      "demo",
    ),
    {
      roads: "road_id",
    },
  );
  assert.equal(
    VectorTileFeatureStateUtils.getPromoteIdPropertyName(
      { roads: "road_id" },
      "parcels",
    ),
    undefined,
  );
  assert.throws(
    () => VectorTileFeatureStateUtils.normalizePromoteId(["id"], "demo"),
    /promoteId/,
  );
  assert.throws(
    () => VectorTileFeatureStateUtils.normalizePromoteId({ roads: "" }, "demo"),
    /roads/,
  );
  console.log("✓ normalize promoteId string and source-layer mappings");
}

{
  assert.deepEqual(
    VectorTileFeatureStateUtils.resolveFeatureStateId(
      "roads",
      { id: 7, properties: { road_id: "r-1" } },
      "road_id",
    ),
    { id: "r-1", unaddressable: false },
  );
  assert.deepEqual(
    VectorTileFeatureStateUtils.resolveFeatureStateId(
      "parcels",
      { id: 8, properties: { parcel_id: 99 } },
      { roads: "road_id", parcels: "parcel_id" },
    ),
    { id: 99, unaddressable: false },
  );
  assert.deepEqual(
    VectorTileFeatureStateUtils.resolveFeatureStateId(
      "buildings",
      { id: 8, properties: { building_id: "ignored" } },
      { roads: "road_id" },
    ),
    { id: 8, unaddressable: false },
  );
  assert.deepEqual(
    VectorTileFeatureStateUtils.resolveFeatureStateId(
      "roads",
      { id: 7, properties: {} },
      "road_id",
    ),
    { id: undefined, unaddressable: true },
  );
  assert.deepEqual(
    VectorTileFeatureStateUtils.resolveFeatureStateId(
      "roads",
      { id: 7, properties: { road_id: true } },
      "road_id",
    ),
    { id: undefined, unaddressable: true },
  );
  console.log("✓ resolve promoted, native fallback and unaddressable ids");
}

{
  assert.notEqual(
    VectorTileFeatureStateUtils.encodeFeatureStateKey("roads", 1),
    VectorTileFeatureStateUtils.encodeFeatureStateKey("roads", "1"),
  );
  console.log("✓ encode numeric and string feature-state ids distinctly");
}

{
  const store = new VectorTileFeatureStateStore();
  const target = { sourceLayer: "roads", id: 1 };
  assert.equal(store.set(target, { hover: true, rank: 1 }), true);
  assert.equal(store.set(target, { rank: 2 }), true);
  assert.deepEqual(store.get(target), { hover: true, rank: 2 });
  const snapshot = store.get(target);
  snapshot.hover = false;
  assert.equal(store.get(target).hover, true);
  assert.equal(store.set(target, { rank: 2 }), false);
  assert.equal(store.remove(target, "hover"), true);
  assert.deepEqual(store.get(target), { rank: 2 });
  assert.equal(store.remove(target), true);
  assert.deepEqual(store.get(target), {});
  console.log(
    "✓ feature-state store shallow merges, copies, removes and no-ops",
  );
}

console.log("VectorTileFeatureState tests passed.");
