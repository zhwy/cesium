import assert from "node:assert/strict";

import {
  computeStyleZoomOffset,
  computeVectorTileStyleZoom,
} from "../src/VectorTileStyleZoom.js";

const defaultOffset = computeStyleZoomOffset();

assert.ok(defaultOffset < -2.9 && defaultOffset > -3.0);
assert.equal(computeVectorTileStyleZoom(0), 0);
assert.ok(computeVectorTileStyleZoom(4) > 1.0);
assert.ok(computeVectorTileStyleZoom(4) < 1.1);
assert.ok(computeVectorTileStyleZoom(5) > 2.0);
assert.ok(computeVectorTileStyleZoom(5) < 2.1);

assert.equal(
  computeVectorTileStyleZoom(5, {
    styleZoomOffset: 0,
  }),
  5,
);
assert.equal(
  computeVectorTileStyleZoom(5, {
    styleZoom: 1,
  }),
  1,
);

console.log("VectorTileStyleZoom tests passed.");
