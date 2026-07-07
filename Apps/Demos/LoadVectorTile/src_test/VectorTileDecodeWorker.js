import {
  decodeVectorTile,
  getTransferableBuffers,
} from "./decodeVectorTile.js";

globalThis.onmessage = function (event) {
  const {
    id,
    arrayBuffer,
    tile,
    styledLayerNames,
    includeProperties,
    clipToTile,
  } = event.data;
  try {
    const result = decodeVectorTile(
      arrayBuffer,
      tile,
      styledLayerNames,
      includeProperties,
      clipToTile,
    );
    globalThis.postMessage({ id, result }, getTransferableBuffers(result));
  } catch (error) {
    globalThis.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
