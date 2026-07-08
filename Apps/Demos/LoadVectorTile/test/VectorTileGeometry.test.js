import assert from "node:assert/strict";

import {
  getWebMercatorTileBounds,
  isTileBoundarySegment,
} from "../src/VectorTileGeometryUtil.js";

const tileBounds = getWebMercatorTileBounds({ x: 1, y: 1, level: 2 });

assert.equal(tileBounds.west, -90);
assert.equal(tileBounds.east, 0);

assert.equal(
  isTileBoundarySegment(
    { longitude: tileBounds.west, latitude: tileBounds.south + 1 },
    { longitude: tileBounds.west, latitude: tileBounds.north - 1 },
    tileBounds,
  ),
  true,
);

assert.equal(
  isTileBoundarySegment(
    { longitude: tileBounds.west, latitude: tileBounds.south + 1 },
    { longitude: tileBounds.east, latitude: tileBounds.north - 1 },
    tileBounds,
  ),
  false,
);

assert.equal(
  isTileBoundarySegment(
    { longitude: tileBounds.west + 1, latitude: tileBounds.south + 1 },
    { longitude: tileBounds.east - 1, latitude: tileBounds.north - 1 },
    tileBounds,
  ),
  false,
);

console.log("VectorTileGeometryUtil tests passed.");
