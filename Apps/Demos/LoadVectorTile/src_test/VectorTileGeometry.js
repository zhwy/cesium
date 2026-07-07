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
  let polygon;
  let exteriorIsCounterClockwise;
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
      if (polygon) {
        polygons.push(polygon);
      }
      polygon = [ring];
    } else if (polygon) {
      polygon.push(ring);
    }
  }

  if (polygon) {
    polygons.push(polygon);
  }
  return polygons;
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
