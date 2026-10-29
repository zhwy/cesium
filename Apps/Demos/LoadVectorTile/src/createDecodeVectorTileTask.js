import createTaskProcessorWorker from "../../../../packages/engine/Source/Workers/createTaskProcessorWorker.js";
import decodeVectorTile from "./decodeVectorTile.js";
import VectorTileBufferPolygonGeometry from "./VectorTileBufferPolygonGeometry.js";

function decodeVectorTileTask(parameters, transferableObjects) {
  const {
    arrayBuffer,
    tile,
    styledLayerNames,
    propertyProjections,
    clipToTile,
    styleRules,
    promoteId,
    bufferPolygonRequests = [],
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
  if (bufferPolygonRequests.length > 0) {
    const started = performance.now();
    for (const request of bufferPolygonRequests) {
      const layer = result.layers[request.sourceLayer];
      if (!layer) {
        continue;
      }
      layer.bufferPolygons ??= [];
      if (
        !layer.bufferPolygons.some(
          (group) =>
            group.ground === request.ground && group.height === request.height,
        )
      ) {
        layer.bufferPolygons.push(
          VectorTileBufferPolygonGeometry.prepareLayer(layer, request),
        );
      }
    }
    result.bufferPolygonPrepareMs = performance.now() - started;
  }
  transferableObjects.push(
    ...VectorTileBufferPolygonGeometry.getTransferableBuffers(result.layers),
  );
  return result;
}

export default createTaskProcessorWorker(decodeVectorTileTask);
