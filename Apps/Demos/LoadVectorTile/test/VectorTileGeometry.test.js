import assert from "node:assert/strict";

import {
  classifyRings,
  getWebMercatorTileBounds,
  isTileBoundarySegment,
} from "../src/VectorTileGeometryUtils.js";

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

{
  const outerA = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ];
  const outerB = [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 0 },
  ];
  const holeInA = [
    { x: 2, y: 2 },
    { x: 2, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 2 },
    { x: 2, y: 2 },
  ];

  const polygons = classifyRings([outerA, outerB, holeInA]);

  assert.equal(polygons.length, 2);
  assert.equal(polygons[0][0], outerA);
  assert.equal(polygons[0][1], holeInA);
  assert.equal(polygons[1][0], outerB);
  assert.equal(polygons[1].length, 1);
}

console.log("VectorTileGeometryUtils tests passed.");
