import assert from "node:assert/strict";

import {
  computeCameraVectorTileStyleZoom,
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

const highCameraZoom = computeCameraVectorTileStyleZoom({
  camera: {
    positionCartographic: {
      latitude: 0,
      height: 1000000,
    },
    frustum: {
      fovy: Math.PI / 3,
    },
  },
  context: {
    drawingBufferHeight: 1000,
  },
});
const lowCameraZoom = computeCameraVectorTileStyleZoom({
  camera: {
    positionCartographic: {
      latitude: 0,
      height: 10000,
    },
    frustum: {
      fovy: Math.PI / 3,
    },
  },
  context: {
    drawingBufferHeight: 1000,
  },
});
assert.ok(lowCameraZoom > highCameraZoom);

const terrainAdjustedZoom = computeCameraVectorTileStyleZoom(
  {
    camera: {
      positionCartographic: {
        latitude: 0,
        height: 10000,
      },
      frustum: {
        fovy: Math.PI / 3,
      },
    },
    context: {
      drawingBufferHeight: 1000,
    },
  },
  {
    scene: {
      globe: {
        getHeight: () => 9000,
      },
    },
  },
);
assert.ok(terrainAdjustedZoom > lowCameraZoom);

console.log("VectorTileStyleZoom tests passed.");
