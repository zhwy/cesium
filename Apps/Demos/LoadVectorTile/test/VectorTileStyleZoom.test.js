import assert from "node:assert/strict";

import VectorTileStyleUtils from "../src/VectorTileStyleUtils.js";

const highCameraZoom = VectorTileStyleUtils.computeCameraVectorTileStyleZoom({
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
const lowCameraZoom = VectorTileStyleUtils.computeCameraVectorTileStyleZoom({
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

const terrainAdjustedZoom =
  VectorTileStyleUtils.computeCameraVectorTileStyleZoom(
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
