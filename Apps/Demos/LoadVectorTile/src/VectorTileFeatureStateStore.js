import VectorTileFeatureStateUtils from "./VectorTileFeatureStateUtils.js";

/**
 * 保存运行时要素状态覆盖值的存储容器，支持按 `sourceLayer` + `id` 寻址。
 *
 * @param {object} [options={}] 构造参数。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器。
 */
class VectorTileFeatureStateStore {
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
    return (
      this._entries.get(
        VectorTileFeatureStateUtils.encodeFeatureStateKey(sourceLayer, id),
      ) ?? {}
    );
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
  return VectorTileFeatureStateUtils.encodeFeatureStateKey(
    target.sourceLayer,
    target.id,
  );
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

export default VectorTileFeatureStateStore;
