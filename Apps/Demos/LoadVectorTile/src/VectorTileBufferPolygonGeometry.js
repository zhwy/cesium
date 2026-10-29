import Cartesian3 from "../../../../packages/core/Source/Cartesian3.js";
import Ellipsoid from "../../../../packages/core/Source/Ellipsoid.js";
import EllipsoidTangentPlane from "../../../../packages/core/Source/EllipsoidTangentPlane.js";
import PolygonPipeline from "../../../../packages/core/Source/PolygonPipeline.js";

/** Worker 与测试共享的纯数值面准备。 */
class VectorTileBufferPolygonGeometry {
  static getParameters(styleRule) {
    const value = Number(styleRule.terrain?.heightOffset ?? 0);
    const height = Number.isFinite(value) ? value : 0;
    return {
      ground: styleRule.terrain?.clampToGround === true && height === 0,
      height,
    };
  }

  static createRequests(styleRules) {
    const requests = new Map();
    for (const rule of styleRules) {
      if (rule.type !== "fill" || rule.useBufferPrimitive !== true) {
        continue;
      }
      const request = {
        sourceLayer: rule.sourceLayer,
        ...VectorTileBufferPolygonGeometry.getParameters(rule),
      };
      requests.set(JSON.stringify(request), request);
    }
    return [...requests.values()];
  }

  static prepareGeometry(rawRings, origin, ground, height) {
    const rings = [];
    for (const raw of rawRings) {
      const ring = [];
      for (let i = 0; i < raw.length; i += 2) {
        if (
          Number.isFinite(raw[i]) &&
          Number.isFinite(raw[i + 1]) &&
          (ring.length === 0 ||
            raw[i] !== ring[ring.length - 2] ||
            raw[i + 1] !== ring[ring.length - 1])
        ) {
          ring.push(raw[i], raw[i + 1]);
        }
      }
      if (
        ring.length >= 4 &&
        ring[0] === ring[ring.length - 2] &&
        ring[1] === ring[ring.length - 1]
      ) {
        ring.length -= 2;
      }
      let area = 0;
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        area += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
      }
      if (ring.length < 6 || Math.abs(area) < 1e-14) {
        if (rings.length === 0) {
          return undefined;
        }
        continue;
      }
      rings.push(ring);
    }
    if (rings.length === 0) {
      return undefined;
    }
    const world = [];
    const holes = [];
    for (let r = 0; r < rings.length; r++) {
      if (r > 0) {
        holes.push(world.length);
      }
      for (let i = 0; i < rings[r].length; i += 2) {
        world.push(
          Cartesian3.fromDegrees(
            rings[r][i],
            rings[r][i + 1],
            0,
            Ellipsoid.WGS84,
          ),
        );
      }
    }
    let positions;
    let triangles;
    if (ground) {
      positions = Cartesian3.packArray(world);
    } else {
      const plane = EllipsoidTangentPlane.fromPoints(world, Ellipsoid.WGS84);
      triangles = PolygonPipeline.triangulate(
        plane.projectPointsToNearestOnPlane(world),
        holes,
      );
      if (triangles.length === 0) {
        return undefined;
      }
      const subdivided = PolygonPipeline.computeSubdivision(
        Ellipsoid.WGS84,
        world,
        triangles,
      );
      positions = subdivided.attributes.position.values;
      PolygonPipeline.scaleToGeodeticHeight(positions, height, Ellipsoid.WGS84);
      triangles = Uint32Array.from(subdivided.indices);
    }
    const local = new Float64Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      local[i] = positions[i] - origin.x;
      local[i + 1] = positions[i + 1] - origin.y;
      local[i + 2] = positions[i + 2] - origin.z;
    }
    return {
      positions: local,
      holes: Uint32Array.from(holes),
      triangles,
      rings,
    };
  }

  static prepareLayer(layer, request) {
    const origin = new Cartesian3();
    const candidates = [];
    const polygons = layer.polygons;
    for (let i = 0; i + 1 < polygons.polygonOffsets.length; i++) {
      const rings = [];
      for (
        let r = polygons.polygonOffsets[i];
        r < polygons.polygonOffsets[i + 1];
        r++
      ) {
        rings.push(
          polygons.positions.subarray(
            polygons.ringOffsets[r] * 2,
            polygons.ringOffsets[r + 1] * 2,
          ),
        );
      }
      candidates.push({
        rings,
        index: i,
        type: 3,
        featureIndex: polygons.featureIndices[i],
      });
    }
    const lines = layer.lines;
    for (let i = 0; i + 1 < lines.offsets.length; i++) {
      candidates.push({
        rings: [
          lines.positions.subarray(
            lines.offsets[i] * 2,
            lines.offsets[i + 1] * 2,
          ),
        ],
        index: i,
        type: 2,
        featureIndex: lines.featureIndices[i],
      });
    }
    const geometries = [];
    for (const candidate of candidates) {
      if (geometries.length === 0 && candidate.rings[0]?.length >= 2) {
        const ring = candidate.rings[0];
        for (let i = 0; i < ring.length; i += 2) {
          if (Number.isFinite(ring[i]) && Number.isFinite(ring[i + 1])) {
            Cartesian3.fromDegrees(
              ring[i],
              ring[i + 1],
              0,
              Ellipsoid.WGS84,
              origin,
            );
            break;
          }
        }
      }
      const geometry = VectorTileBufferPolygonGeometry.prepareGeometry(
        candidate.rings,
        origin,
        request.ground,
        request.height,
      );
      if (geometry) {
        geometries.push({ ...geometry, ...candidate, rings: geometry.rings });
      }
    }
    return VectorTileBufferPolygonGeometry.pack(geometries, request, origin);
  }

  static pack(geometries, request, origin) {
    const result = {
      ground: request.ground,
      height: request.height,
      origin: new Float64Array([origin.x, origin.y, origin.z]),
      positions: [],
      vertexOffsets: [0],
      holes: [],
      holeOffsets: [0],
      ringPositions: [],
      ringOffsets: [0],
      polygonOffsets: [0],
      geometryTypes: [],
      geometryIndices: [],
      featureIndices: [],
    };
    if (!request.ground) {
      result.triangles = [];
      result.triangleOffsets = [0];
    }
    for (const geometry of geometries) {
      for (const value of geometry.positions) {
        result.positions.push(value);
      }
      for (const value of geometry.holes) {
        result.holes.push(value);
      }
      result.vertexOffsets.push(result.positions.length / 3);
      result.holeOffsets.push(result.holes.length);
      if (!request.ground) {
        for (const value of geometry.triangles) {
          result.triangles.push(value);
        }
        result.triangleOffsets.push(result.triangles.length);
      }
      for (const ring of geometry.rings) {
        for (const value of ring) {
          result.ringPositions.push(value);
        }
        result.ringOffsets.push(result.ringPositions.length / 2);
      }
      result.polygonOffsets.push(result.ringOffsets.length - 1);
      result.geometryTypes.push(geometry.type);
      result.geometryIndices.push(geometry.index);
      result.featureIndices.push(geometry.featureIndex);
    }
    for (const key of Object.keys(result)) {
      if (Array.isArray(result[key])) {
        result[key] =
          key === "positions" || key === "ringPositions"
            ? Float64Array.from(result[key])
            : key === "geometryTypes"
              ? Uint8Array.from(result[key])
              : Uint32Array.from(result[key]);
      }
    }
    return result;
  }

  static getTransferableBuffers(layers) {
    const buffers = new Set();
    for (const layer of Object.values(layers)) {
      for (const data of [
        layer.points,
        layer.lines,
        layer.polygons,
        ...(layer.bufferPolygons ?? []),
      ]) {
        for (const value of Object.values(data)) {
          if (ArrayBuffer.isView(value)) {
            buffers.add(value.buffer);
          }
        }
      }
    }
    return [...buffers];
  }

  static filterGroups(groups, lines, polygons) {
    const lineMap = new Map(
      Array.from(lines.sourceGeometryIndices, (oldIndex, index) => [
        oldIndex,
        index,
      ]),
    );
    const polygonMap = new Map(
      Array.from(polygons.sourceGeometryIndices, (oldIndex, index) => [
        oldIndex,
        index,
      ]),
    );
    return groups.map((group) => {
      const geometries = [];
      for (let i = 0; i < group.featureIndices.length; i++) {
        const type = group.geometryTypes[i];
        const index = (type === 2 ? lineMap : polygonMap).get(
          group.geometryIndices[i],
        );
        if (index === undefined) {
          continue;
        }
        const rings = [];
        for (
          let r = group.polygonOffsets[i];
          r < group.polygonOffsets[i + 1];
          r++
        ) {
          rings.push(
            group.ringPositions.subarray(
              group.ringOffsets[r] * 2,
              group.ringOffsets[r + 1] * 2,
            ),
          );
        }
        geometries.push({
          positions: group.positions.subarray(
            group.vertexOffsets[i] * 3,
            group.vertexOffsets[i + 1] * 3,
          ),
          holes: group.holes.subarray(
            group.holeOffsets[i],
            group.holeOffsets[i + 1],
          ),
          triangles: group.triangles?.subarray(
            group.triangleOffsets[i],
            group.triangleOffsets[i + 1],
          ),
          rings,
          type,
          index,
          featureIndex: group.featureIndices[i],
        });
      }
      return VectorTileBufferPolygonGeometry.pack(geometries, group, {
        x: group.origin[0],
        y: group.origin[1],
        z: group.origin[2],
      });
    });
  }
}

export default VectorTileBufferPolygonGeometry;
