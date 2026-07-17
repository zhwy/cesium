export default function getVectorTileTransferableBuffers(result) {
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
