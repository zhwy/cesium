import createTaskProcessorWorker from "../../../../Build/CesiumUnminified/Workers/createTaskProcessorWorker.js";
import decodeVectorTile from "./decodeVectorTile.js";
import getVectorTileTransferableBuffers from "./getVectorTileTransferableBuffers.js";

function decodeVectorTileTask(parameters, transferableObjects) {
  const {
    arrayBuffer,
    tile,
    styledLayerNames,
    propertyProjections,
    clipToTile,
    styleRules,
  } = parameters;

  const result = decodeVectorTile(
    arrayBuffer,
    tile,
    styledLayerNames,
    propertyProjections,
    clipToTile,
    styleRules,
  );
  transferableObjects.push(...getVectorTileTransferableBuffers(result));
  return result;
}

export default createTaskProcessorWorker(decodeVectorTileTask);
