import createTaskProcessorWorker from "../../../../Build/CesiumUnminified/Workers/createTaskProcessorWorker.js";
import {
  decodeVectorTile,
  getTransferableBuffers,
} from "./decodeVectorTile.js";

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
