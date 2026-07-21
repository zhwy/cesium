import assert from "node:assert/strict";

import VectorTileStyleUtils from "../src/VectorTileStyleUtils.js";
import VectorTileStyleUpdateType from "../src/VectorTileStyleUpdateType.js";

const supportedColors = {
  line: ["line-color"],
  fill: ["fill-color", "fill-outline-color"],
  circle: ["circle-color", "circle-outline-color"],
  symbol: ["text-color", "text-halo-color", "text-background-color"],
};

for (const [type, propertyNames] of Object.entries(supportedColors)) {
  for (const propertyName of propertyNames) {
    const previous = createLayer(type);
    const next = structuredClone(previous);
    next.paint[propertyName] = "#ff0000";
    assert.equal(
      VectorTileStyleUtils.createVectorTileStyleUpdatePlan(previous, next).type,
      VectorTileStyleUpdateType.IN_PLACE_APPEARANCE,
      `${type}.${propertyName}`,
    );
  }
}

{
  const previous = createLayer("fill");
  const next = structuredClone(previous);
  next.visibility = false;
  assert.equal(
    VectorTileStyleUtils.createVectorTileStyleUpdatePlan(previous, next).type,
    VectorTileStyleUpdateType.IN_PLACE_APPEARANCE,
  );
  assert.equal(
    VectorTileStyleUtils.createVectorTileStyleUpdatePlan(previous, previous)
      .type,
    VectorTileStyleUpdateType.NO_OP,
  );
}

for (const mutate of [
  (layer) => {
    layer.paint["line-width"] = 3;
  },
  (layer) => {
    layer.filter = ["==", ["get", "kind"], "road"];
  },
  (layer) => {
    layer.layout.custom = true;
  },
  (layer) => {
    layer.terrain.heightOffset = 2;
  },
  (layer) => {
    layer.sourceLayer = "other";
  },
]) {
  const previous = createLayer("line");
  const next = structuredClone(previous);
  mutate(next);
  assert.equal(
    VectorTileStyleUtils.createVectorTileStyleUpdatePlan(previous, next).type,
    VectorTileStyleUpdateType.REBUILD_SOURCE,
  );
}

{
  const previous = createLayer("fill");
  const next = structuredClone(previous);
  next.paint["fill-color"] = "#00ff00";
  const plan = VectorTileStyleUtils.createVectorTileStyleUpdatePlan(
    previous,
    next,
    {
      bucketRebuildReason: "MISSING_PROPERTIES",
    },
  );
  assert.equal(plan.type, VectorTileStyleUpdateType.REBUILD_BUCKET);
  assert.equal(plan.reason, "MISSING_PROPERTIES");
}

console.log("VectorTile style update utils tests passed.");

function createLayer(type) {
  return {
    id: `${type}-layer`,
    type,
    source: "demo",
    sourceLayer: "features",
    filter: undefined,
    layout: {},
    paint: {},
    terrain: { clampToGround: false, heightOffset: 0 },
    visibility: true,
    metadata: {},
  };
}
