const MAX_COVERAGE_DEPTH = 4;

export const VectorTileCoverageState = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  READY_EMPTY: "ready-empty",
  FAILED: "failed",
  CANCELLED: "cancelled",
  UNAVAILABLE: "unavailable",
});

/**
 * Returns a string key that uniquely identifies a tile coordinate.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} level
 * @returns {string}
 */
export function tileKey(x, y, level) {
  return `${level}/${x}/${y}`;
}

/**
 * Returns the four direct child tile coordinates for a given tile.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} level
 * @returns {{x: number, y: number, level: number}[]}
 */
export function getDirectChildCoords(x, y, level) {
  const childLevel = level + 1;
  return [
    { x: 2 * x, y: 2 * y, level: childLevel },
    { x: 2 * x + 1, y: 2 * y, level: childLevel },
    { x: 2 * x, y: 2 * y + 1, level: childLevel },
    { x: 2 * x + 1, y: 2 * y + 1, level: childLevel },
  ];
}

/**
 * Checks whether a tile region is fully covered by tiles in `candidatesMap`.
 *
 * Coverage is satisfied when:
 * - the tile itself is present in the map with `coverageComplete === true`, OR
 * - all four direct child regions are recursively fully covered (up to `maxDepth`).
 *
 * Both READY and READY_EMPTY tiles satisfy `coverageComplete`, so legitimately
 * empty tiles contribute to coverage without requiring a visible primitive.
 *
 * @param {{x: number, y: number, level: number}} coords  Tile to check.
 * @param {Map<string, object>} candidatesMap  Map of tileKey → VectorTile.
 * @param {number} [maxDepth=MAX_COVERAGE_DEPTH]  Recursion limit.
 * @param {number} [depth=0]  Current depth (internal use only).
 * @returns {boolean}
 */
export function isRegionFullyCovered(
  coords,
  candidatesMap,
  maxDepth = MAX_COVERAGE_DEPTH,
  depth = 0,
) {
  if (depth >= maxDepth) {
    return false;
  }
  const candidate = candidatesMap.get(
    tileKey(coords.x, coords.y, coords.level),
  );
  if (candidate?.coverageComplete) {
    return true;
  }
  const children = getDirectChildCoords(coords.x, coords.y, coords.level);
  return children.every((child) =>
    isRegionFullyCovered(child, candidatesMap, maxDepth, depth + 1),
  );
}

/**
 * Selects the optimal non-overlapping set of vector tiles using coverage-tree analysis.
 *
 * A parent tile is suppressed when all four of its direct child regions are fully
 * covered (directly or recursively via deeper descendants). This enables an atomic
 * parent → children upgrade in a single frame once all four siblings satisfy
 * `coverageComplete`.
 *
 * When only some siblings are ready, the parent is kept to avoid gaps. The remaining
 * non-promoted tiles are then deduplicated with ancestor-first ordering so that
 * ancestor fallbacks do not create visual overlap with partial sibling sets.
 *
 * @param {Iterable<object>} candidates  VectorTile objects (state === ImageryState.READY).
 *   Only tiles with `coverageComplete === true` participate in coverage calculations.
 * @param {number} [maxDepth=MAX_COVERAGE_DEPTH]  Recursion depth limit for child coverage.
 * @returns {object[]}  Selected tiles; no two tiles cover the same region.
 */
export function selectByCoverage(candidates, maxDepth = MAX_COVERAGE_DEPTH) {
  // Build a lookup map from tile coordinate key to candidate tile.
  const candidatesMap = new Map();
  for (const tile of candidates) {
    if (tile.coverageComplete) {
      candidatesMap.set(tileKey(tile.x, tile.y, tile.level), tile);
    }
  }

  // Identify tiles whose region is fully superseded by finer tiles in the map.
  const promoted = new Set();
  for (const tile of candidatesMap.values()) {
    const children = getDirectChildCoords(tile.x, tile.y, tile.level);
    if (
      children.every((child) =>
        isRegionFullyCovered(child, candidatesMap, maxDepth, 0),
      )
    ) {
      promoted.add(tileKey(tile.x, tile.y, tile.level));
    }
  }

  // Collect non-promoted tiles sorted coarsest-first.
  const nonPromoted = [];
  for (const tile of candidatesMap.values()) {
    if (!promoted.has(tileKey(tile.x, tile.y, tile.level))) {
      nonPromoted.push(tile);
    }
  }
  nonPromoted.sort((a, b) => a.level - b.level);

  // Apply ancestor-first deduplication to handle coexisting ancestor fallbacks
  // with partial sibling sets at finer levels.
  const selected = [];
  for (const tile of nonPromoted) {
    if (!selected.some((s) => isAncestorOrSame(s, tile))) {
      selected.push(tile);
    }
  }
  return selected;
}

/**
 * Returns whether `ancestor` is an ancestor of or the same tile as `descendant`.
 *
 * @param {{x: number, y: number, level: number}} ancestor
 * @param {{x: number, y: number, level: number}} descendant
 * @returns {boolean}
 */
export function isAncestorOrSame(ancestor, descendant) {
  if (ancestor.level > descendant.level) {
    return false;
  }
  const levelDifference = descendant.level - ancestor.level;
  const scale = 2 ** levelDifference;
  return (
    Math.floor(descendant.x / scale) === ancestor.x &&
    Math.floor(descendant.y / scale) === ancestor.y
  );
}
