const MAX_SAMPLES = 600;

/**
 * 汇总矢量瓦片管线中的计数器、时长采样与仪表盘指标。
 *
 * @param {boolean|object} [options={}] 构造参数。
 * @param {boolean} [options.enabled] 是否启用诊断；直接传 `true` 时效果等同于 `{ enabled: true }`。
 */
class VectorTileDiagnostics {
  constructor(options = {}) {
    this.enabled = options === true || options?.enabled === true;
    this._frameStart = undefined;
    this.reset();
  }

  reset() {
    const bufferGauges = {};
    for (const name of [
      "residentBufferPolygons",
      "residentBufferPolygonBytes",
      "pendingBufferPolygons",
      "bufferPolygonPreparedBytes",
    ]) {
      if (this._gauges?.[name] !== undefined) {
        bufferGauges[name] = this._gauges[name];
      }
    }
    this._counters = Object.create(null);
    this._gauges = Object.assign(Object.create(null), bufferGauges);
    this._durations = Object.create(null);
    this._frameWork = Object.create(null);
    this._pendingFrameWork = Object.create(null);
    this._lastRenderPass = undefined;
    this._bufferPolygonBuffers ??= new Map();
  }

  retainBufferPolygonGeometry(group) {
    const buffers = new Set(
      Object.values(group)
        .filter(ArrayBuffer.isView)
        .map((value) => value.buffer),
    );
    for (const buffer of buffers) {
      const count = this._bufferPolygonBuffers.get(buffer) ?? 0;
      if (count === 0) {
        this.addGauge("bufferPolygonPreparedBytes", buffer.byteLength);
      }
      this._bufferPolygonBuffers.set(buffer, count + 1);
    }
  }

  releaseBufferPolygonGeometry(group) {
    const buffers = new Set(
      Object.values(group)
        .filter(ArrayBuffer.isView)
        .map((value) => value.buffer),
    );
    for (const buffer of buffers) {
      const count = this._bufferPolygonBuffers.get(buffer);
      if (count === 1) {
        this.addGauge("bufferPolygonPreparedBytes", -buffer.byteLength);
        this._bufferPolygonBuffers.delete(buffer);
      } else if (count > 1) {
        this._bufferPolygonBuffers.set(buffer, count - 1);
      }
    }
  }

  startTimer() {
    return this.enabled ? now() : undefined;
  }

  /** 记录时长样本并返回本次毫秒数；未启用诊断时返回 0。 */
  recordDuration(name, startTime) {
    if (!this.enabled || startTime === undefined) {
      return 0;
    }

    if (!this._durations[name]) {
      this._durations[name] = [];
    }

    const samples = this._durations[name];
    const elapsed = now() - startTime;
    samples.push(elapsed);
    if (samples.length > MAX_SAMPLES) {
      samples.shift();
    }
    return elapsed;
  }

  /**
   * 把主线程工作累计到两次 endFrame 之间的"帧间窗口"。
   * 窗口内包含帧外的 Promise 任务和帧内的 update，二者都会推迟下一帧。
   */
  addFrameWork(name, milliseconds, items = 1) {
    if (!this.enabled) {
      return;
    }

    const pending = (this._pendingFrameWork[name] ??= { ms: 0, items: 0 });
    pending.ms += milliseconds;
    pending.items += items;
  }

  /** 返回自 startTime 起的毫秒数；未启用诊断时为 0。 */
  elapsedSince(startTime) {
    return this.enabled && startTime !== undefined ? now() - startTime : 0;
  }

  /** 直接记录一个已累计好的时长样本，用于单次构建内多段累加的阶段。 */
  recordSample(name, milliseconds) {
    if (!this.enabled) {
      return;
    }

    if (!this._durations[name]) {
      this._durations[name] = [];
    }

    const samples = this._durations[name];
    samples.push(milliseconds);
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
    if (this.enabled) {
      for (const name of Object.keys(this._pendingFrameWork)) {
        const samples = (this._frameWork[name] ??= []);
        samples.push(this._pendingFrameWork[name]);
        if (samples.length > MAX_SAMPLES) {
          samples.shift();
        }
      }
      this._pendingFrameWork = Object.create(null);
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

    const frameWork = {};
    Object.keys(this._frameWork).forEach((name) => {
      const samples = this._frameWork[name];
      frameWork[name] = {
        ms: summarize(samples.map((sample) => sample.ms)),
        items: summarize(samples.map((sample) => sample.items)),
      };
    });

    return {
      enabled: this.enabled,
      counters: { ...this._counters },
      gauges: { ...this._gauges },
      durations,
      frameWork,
      lastRenderPass: this._lastRenderPass
        ? { ...this._lastRenderPass }
        : undefined,
    };
  }
}

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

export default VectorTileDiagnostics;
