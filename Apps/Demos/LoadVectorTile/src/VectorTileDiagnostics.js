const MAX_SAMPLES = 600;

function now() {
  return globalThis.performance?.now() ?? Date.now();
}

function percentile(samples, ratio) {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * ratio) - 1,
  );
  return sorted[index];
}

function summarize(samples) {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    count: samples.length,
    averageMs: samples.length > 0 ? total / samples.length : 0,
    p95Ms: percentile(samples, 0.95),
    maximumMs: samples.length > 0 ? Math.max(...samples) : 0,
  };
}

/**
 * 汇总矢量瓦片管线中的计数器、时长采样与仪表盘指标。
 *
 * @param {boolean|object} [options={}] 构造参数。
 * @param {boolean} [options.enabled] 是否启用诊断；直接传 `true` 时效果等同于 `{ enabled: true }`。
 */
export default class VectorTileDiagnostics {
  constructor(options = {}) {
    this.enabled = options === true || options?.enabled === true;
    this._frameStart = undefined;
    this.reset();
  }

  reset() {
    this._counters = Object.create(null);
    this._gauges = Object.create(null);
    this._durations = Object.create(null);
    this._lastRenderPass = undefined;
  }

  startTimer() {
    return this.enabled ? now() : undefined;
  }

  recordDuration(name, startTime) {
    if (!this.enabled || startTime === undefined) {
      return;
    }

    const samples = (this._durations[name] ??= []);
    samples.push(now() - startTime);
    if (samples.length > MAX_SAMPLES) {
      samples.shift();
    }
  }

  increment(name, amount = 1) {
    if (this.enabled) {
      this._counters[name] = (this._counters[name] ?? 0) + amount;
    }
  }

  addGauge(name, amount) {
    if (this.enabled) {
      this._gauges[name] = Math.max(0, (this._gauges[name] ?? 0) + amount);
    }
  }

  setGauge(name, value) {
    if (this.enabled) {
      this._gauges[name] = Math.max(0, value || 0);
    }
  }

  beginFrame() {
    if (this.enabled) {
      this._frameStart = now();
    }
  }

  endFrame() {
    if (this.enabled && this._frameStart !== undefined) {
      this.recordDuration("frameCpu", this._frameStart);
      this._frameStart = undefined;
    }
  }

  recordRenderPass(pass) {
    if (!this.enabled) {
      return;
    }

    this.increment("renderPasses");
    this.increment("primitiveCandidates", pass.primitiveCandidates ?? 0);
    this.increment("primitiveSubmissions", pass.primitiveSubmissions ?? 0);
    this.increment(
      "preventedDuplicatePrimitiveSubmissions",
      pass.preventedDuplicatePrimitives ?? 0,
    );
    this.increment(
      "suppressedLodVectorTiles",
      pass.suppressedLodVectorTiles ?? 0,
    );
    this._lastRenderPass = { ...pass };
  }

  snapshot() {
    const durations = {};
    Object.keys(this._durations).forEach((name) => {
      durations[name] = summarize(this._durations[name]);
    });

    return {
      enabled: this.enabled,
      counters: { ...this._counters },
      gauges: { ...this._gauges },
      durations,
      lastRenderPass: this._lastRenderPass
        ? { ...this._lastRenderPass }
        : undefined,
    };
  }
}
