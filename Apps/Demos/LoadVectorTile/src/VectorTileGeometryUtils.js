function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i];
    const previous = ring[j];
    sum += (previous.x - current.x) * (current.y + previous.y);
  }
  return sum;
}

export function classifyRings(rings) {
  if (rings.length <= 1) {
    return rings.length === 1 ? [rings] : [];
  }

  const polygons = [];
  const pendingHoles = [];
  let exteriorIsCounterClockwise;
  let lastExteriorIndex = -1;
  for (let i = 0; i < rings.length; ++i) {
    const ring = rings[i];
    const area = signedArea(ring);
    if (area === 0) {
      continue;
    }

    if (exteriorIsCounterClockwise === undefined) {
      exteriorIsCounterClockwise = area < 0;
    }

    if (exteriorIsCounterClockwise === area < 0) {
      polygons.push({
        ring,
        holes: [],
        area: Math.abs(area),
      });
      lastExteriorIndex = polygons.length - 1;
    } else {
      pendingHoles.push({
        ring,
        fallbackExteriorIndex: lastExteriorIndex,
      });
    }
  }

  for (const hole of pendingHoles) {
    const exteriorIndex = findContainingExterior(hole.ring, polygons);
    const target =
      exteriorIndex !== -1 ? exteriorIndex : hole.fallbackExteriorIndex;
    if (target !== -1) {
      polygons[target].holes.push(hole.ring);
    }
  }
  return polygons.map((polygon) => [polygon.ring, ...polygon.holes]);
}

export function projectPoint(point, tile, extent, positions) {
  const worldSize = extent * 2 ** tile.level;
  const worldX = (point.x + extent * tile.x) / worldSize;
  const worldY = (point.y + extent * tile.y) / worldSize;
  const longitude = worldX * 360.0 - 180.0;
  const latitude =
    (Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * worldY))) * 180.0) / Math.PI;
  positions.push(longitude, latitude);
}

function projectTileYToLatitude(y, level) {
  const worldY = y / 2 ** level;
  return (
    (Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * worldY))) * 180.0) / Math.PI
  );
}

export function getWebMercatorTileBounds(tile) {
  const worldSize = 2 ** tile.level;
  return {
    west: (tile.x / worldSize) * 360.0 - 180.0,
    east: ((tile.x + 1) / worldSize) * 360.0 - 180.0,
    north: projectTileYToLatitude(tile.y, tile.level),
    south: projectTileYToLatitude(tile.y + 1, tile.level),
  };
}

function nearlyEquals(left, right, epsilon = 1e-9) {
  return Math.abs(left - right) <= epsilon;
}

function getTileBoundaryMask(point, tileBounds) {
  let mask = 0;
  if (nearlyEquals(point.longitude, tileBounds.west)) {
    mask |= 1;
  }
  if (nearlyEquals(point.longitude, tileBounds.east)) {
    mask |= 2;
  }
  if (nearlyEquals(point.latitude, tileBounds.south)) {
    mask |= 4;
  }
  if (nearlyEquals(point.latitude, tileBounds.north)) {
    mask |= 8;
  }
  return mask;
}

export function isTileBoundarySegment(start, end, tileBounds) {
  if (!tileBounds) {
    return false;
  }
  return (
    (getTileBoundaryMask(start, tileBounds) &
      getTileBoundaryMask(end, tileBounds)) !==
    0
  );
}

export function isPointInRectangle(point, minimum, maximum) {
  return (
    point.x >= minimum &&
    point.x <= maximum &&
    point.y >= minimum &&
    point.y <= maximum
  );
}

function pointsEqual(left, right) {
  return left.x === right.x && left.y === right.y;
}

function findContainingExterior(hole, polygons) {
  const point = findRepresentativePoint(hole);
  let bestIndex = -1;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygons.length; ++i) {
    const polygon = polygons[i];
    if (polygon.area < bestArea && pointInRing(point, polygon.ring)) {
      bestIndex = i;
      bestArea = polygon.area;
    }
  }
  return bestIndex;
}

function findRepresentativePoint(ring) {
  for (let i = 0; i < ring.length; ++i) {
    if (!pointsEqual(ring[i], ring[(i + 1) % ring.length])) {
      return ring[i];
    }
  }
  return ring[0];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i];
    const previous = ring[j];
    if (isPointOnSegment(point, previous, current)) {
      return true;
    }
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function isPointOnSegment(point, start, end) {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) {
    return false;
  }
  return (
    point.x >= Math.min(start.x, end.x) - 1e-9 &&
    point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 &&
    point.y <= Math.max(start.y, end.y) + 1e-9
  );
}

function clipSegment(start, end, minimum, maximum) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let startRatio = 0.0;
  let endRatio = 1.0;
  const p = [-deltaX, deltaX, -deltaY, deltaY];
  const q = [
    start.x - minimum,
    maximum - start.x,
    start.y - minimum,
    maximum - start.y,
  ];

  for (let i = 0; i < 4; ++i) {
    if (p[i] === 0) {
      if (q[i] < 0) {
        return undefined;
      }
      continue;
    }
    const ratio = q[i] / p[i];
    if (p[i] < 0) {
      startRatio = Math.max(startRatio, ratio);
    } else {
      endRatio = Math.min(endRatio, ratio);
    }
    if (startRatio > endRatio) {
      return undefined;
    }
  }

  return [
    {
      x: start.x + startRatio * deltaX,
      y: start.y + startRatio * deltaY,
    },
    {
      x: start.x + endRatio * deltaX,
      y: start.y + endRatio * deltaY,
    },
  ];
}

export function clipLineString(line, minimum, maximum) {
  const clippedLines = [];
  let currentLine = [];
  for (let i = 0; i + 1 < line.length; ++i) {
    const segment = clipSegment(line[i], line[i + 1], minimum, maximum);
    if (!segment || pointsEqual(segment[0], segment[1])) {
      if (currentLine.length >= 2) {
        clippedLines.push(currentLine);
      }
      currentLine = [];
      continue;
    }

    if (
      currentLine.length === 0 ||
      !pointsEqual(currentLine[currentLine.length - 1], segment[0])
    ) {
      if (currentLine.length >= 2) {
        clippedLines.push(currentLine);
      }
      currentLine = [segment[0]];
    }
    currentLine.push(segment[1]);
  }
  if (currentLine.length >= 2) {
    clippedLines.push(currentLine);
  }
  return clippedLines;
}

function clipAgainstBoundary(points, isInside, intersection) {
  if (points.length === 0) {
    return points;
  }
  const output = [];
  let previous = points[points.length - 1];
  let previousInside = isInside(previous);
  for (let i = 0; i < points.length; ++i) {
    const current = points[i];
    const currentInside = isInside(current);
    if (currentInside !== previousInside) {
      output.push(intersection(previous, current));
    }
    if (currentInside) {
      output.push({ x: current.x, y: current.y });
    }
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

function intersectVertical(start, end, x) {
  const ratio = (x - start.x) / (end.x - start.x);
  return { x, y: start.y + ratio * (end.y - start.y) };
}

function intersectHorizontal(start, end, y) {
  const ratio = (y - start.y) / (end.y - start.y);
  return { x: start.x + ratio * (end.x - start.x), y };
}

function removeDuplicatePoints(points) {
  const result = [];
  for (let i = 0; i < points.length; ++i) {
    if (
      result.length === 0 ||
      !pointsEqual(result[result.length - 1], points[i])
    ) {
      result.push(points[i]);
    }
  }
  if (result.length > 1 && pointsEqual(result[0], result[result.length - 1])) {
    result.pop();
  }
  return result;
}

export function clipRingToRectangle(ring, minimum, maximum) {
  let points = removeDuplicatePoints(ring);
  points = clipAgainstBoundary(
    points,
    (point) => point.x >= minimum,
    (start, end) => intersectVertical(start, end, minimum),
  );
  points = clipAgainstBoundary(
    points,
    (point) => point.x <= maximum,
    (start, end) => intersectVertical(start, end, maximum),
  );
  points = clipAgainstBoundary(
    points,
    (point) => point.y >= minimum,
    (start, end) => intersectHorizontal(start, end, minimum),
  );
  points = clipAgainstBoundary(
    points,
    (point) => point.y <= maximum,
    (start, end) => intersectHorizontal(start, end, maximum),
  );
  points = removeDuplicatePoints(points);
  if (points.length < 3 || signedArea(points) === 0) {
    return [];
  }
  points.push({ ...points[0] });
  return points;
}

export function countOutOfBoundsPoints(geometry, minimum, maximum) {
  let count = 0;
  for (let i = 0; i < geometry.length; ++i) {
    for (let j = 0; j < geometry[i].length; ++j) {
      if (!isPointInRectangle(geometry[i][j], minimum, maximum)) {
        count++;
      }
    }
  }
  return count;
}
