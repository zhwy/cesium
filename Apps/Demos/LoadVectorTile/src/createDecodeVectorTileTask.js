import createTaskProcessorWorker from "../../../../packages/engine/Source/Workers/createTaskProcessorWorker.js";
import decodeVectorTile from "./decodeVectorTile.js";

function getVectorTileTransferableBuffers(result) {
  const buffers = [];
  Object.values(result.layers).forEach((layer) => {
    buffers.push(
      layer.points.positions.buffer,
      layer.points.featureIndices.buffer,
      layer.lines.positions.buffer,
      layer.lines.offsets.buffer,
      layer.lines.featureIndices.buffer,
      layer.polygons.positions.buffer,
      layer.polygons.ringOffsets.buffer,
      layer.polygons.polygonOffsets.buffer,
      layer.polygons.featureIndices.buffer,
    );
  });
  return buffers;
}

function decodeVectorTileTask(parameters, transferableObjects) {
  const {
    arrayBuffer,
    tile,
    styledLayerNames,
    propertyProjections,
    clipToTile,
    styleRules,
    promoteId,
  } = parameters;

  const result = decodeVectorTile(
    arrayBuffer,
    tile,
    styledLayerNames,
    propertyProjections,
    clipToTile,
    styleRules,
    promoteId,
  );
  transferableObjects.push(...getVectorTileTransferableBuffers(result));
  return result;
}

export default createTaskProcessorWorker(decodeVectorTileTask);
