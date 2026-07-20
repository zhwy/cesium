export function normalizePromoteId(promoteId, sourceId) {
  if (promoteId === undefined) {
    return undefined;
  }
  if (isNonEmptyString(promoteId)) {
    return promoteId;
  }
  if (!isPlainObject(promoteId)) {
    throw new Error(
      `source "${sourceId}" promoteId must be a non-empty string or an object mapping source-layer names to property names.`,
    );
  }

  const result = {};
  for (const [sourceLayer, propertyName] of Object.entries(promoteId)) {
    if (!isNonEmptyString(sourceLayer)) {
      throw new Error(
        `source "${sourceId}" promoteId source-layer names must be non-empty strings.`,
      );
    }
    if (!isNonEmptyString(propertyName)) {
      throw new Error(
        `source "${sourceId}" promoteId["${sourceLayer}"] must be a non-empty string.`,
      );
    }
    result[sourceLayer] = propertyName;
  }
  return result;
}

export function getPromoteIdPropertyName(promoteId, sourceLayer) {
  if (typeof promoteId === "string") {
    return promoteId;
  }
  if (
    promoteId &&
    Object.prototype.hasOwnProperty.call(promoteId, sourceLayer)
  ) {
    return promoteId[sourceLayer];
  }
  return undefined;
}

export function resolveFeatureStateId(sourceLayer, feature, promoteId) {
  const propertyName = getPromoteIdPropertyName(promoteId, sourceLayer);
  if (propertyName !== undefined) {
    const id = feature?.properties?.[propertyName];
    return {
      id: isValidFeatureStateId(id) ? id : undefined,
      unaddressable: !isValidFeatureStateId(id),
    };
  }
  const id = feature?.id;
  return {
    id: isValidFeatureStateId(id) ? id : undefined,
    unaddressable: !isValidFeatureStateId(id),
  };
}

export function isValidFeatureStateId(id) {
  return typeof id === "string" || typeof id === "number";
}

export function encodeFeatureStateKey(sourceLayer, id) {
  return `${sourceLayer}\u0000${typeof id}\u0000${String(id)}`;
}

export function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export class VectorTileFeatureStateStore {
  constructor(options = {}) {
    this._entries = new Map();
    this._revision = 0;
    this._diagnostics = options.diagnostics;
  }

  get revision() {
    return this._revision;
  }

  get size() {
    return this._entries.size;
  }

  get(target) {
    return { ...(this._entries.get(encodeTargetKey(target)) ?? {}) };
  }

  peek(sourceLayer, id) {
    return this._entries.get(encodeFeatureStateKey(sourceLayer, id)) ?? {};
  }

  set(target, state) {
    const key = encodeTargetKey(target);
    const current = this._entries.get(key) ?? {};
    const next = { ...current, ...state };
    if (shallowEqual(current, next)) {
      this._diagnostics?.increment("featureStateNoopWrites");
      return false;
    }
    const hadEntry = this._entries.has(key);
    this._entries.set(key, next);
    this._revision++;
    this._diagnostics?.increment("featureStateWrites");
    if (!hadEntry) {
      this._diagnostics?.addGauge("featureStateEntries", 1);
    }
    return true;
  }

  remove(target, stateKey) {
    const key = encodeTargetKey(target);
    if (!this._entries.has(key)) {
      this._diagnostics?.increment("featureStateNoopWrites");
      return false;
    }
    if (stateKey === undefined) {
      this._entries.delete(key);
      this._revision++;
      this._diagnostics?.increment("featureStateRemovals");
      this._diagnostics?.addGauge("featureStateEntries", -1);
      return true;
    }

    const current = this._entries.get(key);
    if (!Object.prototype.hasOwnProperty.call(current, stateKey)) {
      this._diagnostics?.increment("featureStateNoopWrites");
      return false;
    }
    const next = { ...current };
    delete next[stateKey];
    if (Object.keys(next).length === 0) {
      this._entries.delete(key);
      this._diagnostics?.addGauge("featureStateEntries", -1);
    } else {
      this._entries.set(key, next);
    }
    this._revision++;
    this._diagnostics?.increment("featureStateRemovals");
    return true;
  }

  clear() {
    const size = this._entries.size;
    if (size === 0) {
      return;
    }
    this._entries.clear();
    this._revision++;
    this._diagnostics?.addGauge("featureStateEntries", -size);
  }
}

function encodeTargetKey(target) {
  return encodeFeatureStateKey(target.sourceLayer, target.id);
}

function shallowEqual(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      Object.is(left[key], right[key]),
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
