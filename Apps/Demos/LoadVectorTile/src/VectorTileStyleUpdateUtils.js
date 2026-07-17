export const VectorTileStyleUpdateType = Object.freeze({
  NO_OP: "NO_OP",
  IN_PLACE_APPEARANCE: "IN_PLACE_APPEARANCE",
  REBUILD_BUCKET: "REBUILD_BUCKET",
  REBUILD_SOURCE: "REBUILD_SOURCE",
});

const SUPPORTED_COLOR_PROPERTIES = Object.freeze({
  line: new Set(["line-color"]),
  fill: new Set(["fill-color", "fill-outline-color"]),
  circle: new Set(["circle-color", "circle-outline-color"]),
  symbol: new Set(["text-color", "text-halo-color", "text-background-color"]),
});

export function createVectorTileStyleUpdatePlan(
  previousLayer,
  nextLayer,
  options = {},
) {
  const changedPaths = collectChangedPaths(previousLayer, nextLayer);
  if (changedPaths.length === 0) {
    return {
      type: VectorTileStyleUpdateType.NO_OP,
      changedPaths,
    };
  }

  const colorProperties = SUPPORTED_COLOR_PROPERTIES[nextLayer?.type];
  const supportsInPlace =
    previousLayer?.type === nextLayer?.type &&
    changedPaths.every(
      (path) =>
        path === "visibility" ||
        (path.startsWith("paint.") &&
          colorProperties?.has(path.slice("paint.".length))),
    );
  if (!supportsInPlace) {
    return {
      type: VectorTileStyleUpdateType.REBUILD_SOURCE,
      changedPaths,
      reason: "STRUCTURAL_STYLE_CHANGE",
    };
  }

  if (options.bucketRebuildReason) {
    return {
      type: VectorTileStyleUpdateType.REBUILD_BUCKET,
      changedPaths,
      reason: options.bucketRebuildReason,
    };
  }

  return {
    type: VectorTileStyleUpdateType.IN_PLACE_APPEARANCE,
    changedPaths,
  };
}

function collectChangedPaths(previousValue, nextValue, path = "") {
  if (areStyleValuesEqual(previousValue, nextValue)) {
    return [];
  }

  if (!isPlainObject(previousValue) || !isPlainObject(nextValue)) {
    return [path];
  }

  const paths = [];
  const keys = new Set([
    ...Object.keys(previousValue),
    ...Object.keys(nextValue),
  ]);
  for (const key of keys) {
    const childPath = path ? `${path}.${key}` : key;
    paths.push(
      ...collectChangedPaths(previousValue[key], nextValue[key], childPath),
    );
  }
  return paths.sort();
}

function areStyleValuesEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areStyleValuesEqual(value, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        areStyleValuesEqual(left[key], right[key]),
    )
  );
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
