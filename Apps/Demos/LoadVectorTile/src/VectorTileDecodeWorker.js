import createTaskProcessorWorker from "../../../../Build/CesiumUnminified/Workers/createTaskProcessorWorker.js";
import decodeVectorTile from "./decodeVectorTile.js";

function getTransferableBuffers(result) {
  const buffers = [];
  Object.values(result.layers).forEach((layer) => {
    buffers.push(
      layer.points.positions.buffer,
      layer.lines.positions.buffer,
      layer.lines.offsets.buffer,
      layer.polygons.positions.buffer,
      layer.polygons.ringOffsets.buffer,
      layer.polygons.polygonOffsets.buffer,
    );
  });
  return buffers;
}

function decodeVectorTileTask(parameters, transferableObjects) {
  const {
    arrayBuffer,
    tile,
    styledLayerNames,
    includeProperties,
    clipToTile,
    styleRules,
  } = parameters;

  const result = decodeVectorTile(
    arrayBuffer,
    tile,
    styledLayerNames,
    includeProperties,
    clipToTile,
    styleRules,
  );
  transferableObjects.push(...getTransferableBuffers(result));
  return result;
}

export default createTaskProcessorWorker(decodeVectorTileTask);
