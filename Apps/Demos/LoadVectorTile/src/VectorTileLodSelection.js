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
 * 返回用于唯一标识瓦片坐标的字符串键。
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
 * 返回指定瓦片的四个直接子瓦片坐标。
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
 * 检查某个瓦片区域是否已被 `candidatesMap` 中的瓦片完整覆盖。
 *
 * 满足以下任一条件即可视为覆盖完成：
 * - 当前瓦片自身存在于映射表中，且 `coverageComplete === true`；或
 * - 四个直接子区域都在 `maxDepth` 限制内递归达到完整覆盖。
 *
 * `READY` 与 `READY_EMPTY` 都满足 `coverageComplete`，因此合法的空瓦片也会
 * 参与覆盖判断，而不要求一定存在可见图元。
 *
 * @param {{x: number, y: number, level: number}} coords 待检查的瓦片坐标。
 * @param {Map<string, object>} candidatesMap `tileKey -> VectorTile` 的映射表。
 * @param {number} [maxDepth=MAX_COVERAGE_DEPTH] 递归深度上限。
 * @param {number} [depth=0] 当前递归深度，仅供内部使用。
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
 * 基于覆盖树分析，选出最优且互不重叠的矢量瓦片集合。
 *
 * 当父瓦片的四个直接子区域都已被完整覆盖时，父瓦片会被压制掉。
 * 这样一来，一旦四个兄弟瓦片都满足 `coverageComplete`，就可以在同一帧内
 * 原子地从父瓦片切换到子瓦片。
 *
 * 如果只有部分兄弟瓦片就绪，则保留父瓦片以避免出现空洞。随后会按祖先优先的
 * 顺序对未提升的瓦片去重，避免祖先回退结果与部分子瓦片同时渲染造成重叠。
 *
 * @param {Iterable<object>} candidates 候选 `VectorTile` 集合（`state === ImageryState.READY`）。
 *   只有 `coverageComplete === true` 的瓦片会参与覆盖计算。
 * @param {number} [maxDepth=MAX_COVERAGE_DEPTH] 子区域覆盖检查的递归深度上限。
 * @returns {object[]} 选中的瓦片集合，任意两个瓦片都不会覆盖同一区域。
 */
export function selectByCoverage(candidates, maxDepth = MAX_COVERAGE_DEPTH) {
  // 构建从瓦片坐标键到候选瓦片的查找表。
  const candidatesMap = new Map();
  for (const tile of candidates) {
    if (tile.coverageComplete) {
      candidatesMap.set(tileKey(tile.x, tile.y, tile.level), tile);
    }
  }

  // 找出那些已被更细粒度瓦片完整取代的父级瓦片。
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

  // 收集未被提升的瓦片，并按由粗到细排序。
  const nonPromoted = [];
  for (const tile of candidatesMap.values()) {
    if (!promoted.has(tileKey(tile.x, tile.y, tile.level))) {
      nonPromoted.push(tile);
    }
  }
  nonPromoted.sort((a, b) => a.level - b.level);

  // 按祖先优先规则去重，处理祖先回退与部分细级兄弟瓦片并存的情况。
  const selected = [];
  for (const tile of nonPromoted) {
    if (!selected.some((s) => isAncestorOrSame(s, tile))) {
      selected.push(tile);
    }
  }
  return selected;
}

/**
 * 判断 `ancestor` 是否是 `descendant` 的祖先，或二者是否为同一瓦片。
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
