import assert from "node:assert/strict";

import {
  adoptDecodedFeatureTables,
  getDecodedTileByteLength,
} from "../src/VectorTileLayer.js";
import getVectorTileTransferableBuffers from "../src/getVectorTileTransferableBuffers.js";

const decodedTile = {
  layers: {
    demo: {
      features: [
        {
          id: 1,
          sourceFeatureIndex: 4,
          properties: { name: "A", internal: 2 },
        },
      ],
      points: {
        positions: new Float64Array([1, 2]),
        featureIndices: new Uint32Array([0]),
      },
      lines: {
        positions: new Float64Array(),
        offsets: new Uint32Array([0]),
        featureIndices: new Uint32Array(),
      },
      polygons: {
        positions: new Float64Array(),
        ringOffsets: new Uint32Array([0]),
        polygonOffsets: new Uint32Array([0]),
        featureIndices: new Uint32Array(),
      },
    },
  },
};
const gauges = {};
const diagnostics = {
  addGauge(name, amount) {
    gauges[name] = (gauges[name] ?? 0) + amount;
  },
};
const vectorTile = {};

adoptDecodedFeatureTables(vectorTile, decodedTile, true, ["name"], diagnostics);
assert.equal(vectorTile.features.demo, decodedTile.layers.demo.features);
assert.equal(vectorTile.residentFeatureTableEntries, 1);
assert.equal(vectorTile.residentPickPropertyValues, 1);
assert.equal(gauges.residentFeatureTableEntries, 1);
assert.equal(gauges.residentPickPropertyValues, 1);
assert.ok(getDecodedTileByteLength(decodedTile) > 32);
const transferableBuffers = getVectorTileTransferableBuffers(decodedTile);
assert.equal(transferableBuffers.length, 9);
assert.ok(
  transferableBuffers.includes(
    decodedTile.layers.demo.points.featureIndices.buffer,
  ),
);

console.log("VectorTile decoded residency tests passed.");
