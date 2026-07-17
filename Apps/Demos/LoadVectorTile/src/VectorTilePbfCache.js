import { DeveloperError } from "../../../../Build/CesiumUnminified/index.js";
import { VectorTileTaskCancelledError } from "./VectorTileTaskScheduler.js";

export const DEFAULT_PBF_CACHE_BYTES = 64 * 1024 * 1024;

/**
 * 管理 manager 级原始 PBF master buffer，并协调相同 key 的在途请求。
 *
 * @param {object} [options={}] 构造参数。
 * @param {number} [options.maximumBytes=64*1024*1024] ready master 的总字节预算。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器。
 */
export default class VectorTilePbfCache {
  constructor(options = {}) {
    const maximumBytes = options.maximumBytes ?? DEFAULT_PBF_CACHE_BYTES;
    if (
      typeof maximumBytes !== "number" ||
      !Number.isFinite(maximumBytes) ||
      maximumBytes < 0
    ) {
      throw new DeveloperError(
        "maximumBytes must be a finite, non-negative number.",
      );
    }

    this.maximumBytes = maximumBytes;
    this._diagnostics = options.diagnostics;
    this._ready = new Map();
    this._pending = new Map();
    this._totalBytes = 0;
    this._accessCounter = 0;
    this._generation = 0;
    this._updateResidentGauges();
  }

  get totalBytes() {
    return this._totalBytes;
  }

  get length() {
    return this._ready.size;
  }

  get pendingCount() {
    return this._pending.size;
  }

  getStatistics() {
    return {
      entries: this._ready.size,
      bytes: this._totalBytes,
      pending: this._pending.size,
    };
  }

  /**
   * 返回 PBF 工作副本，或创建/加入一个共享底层加载任务。
   *
   * @param {string} key 与样式内容代无关的 PBF 身份。
   * @param {function(number): object} load 创建底层任务的函数。
   * @param {number} [priority=0] 当前消费者的加载优先级，数值越小优先级越高。
   * @returns {object} 兼容 VectorTileTaskScheduler 的消费者任务句柄。
   */
  getOrLoad(key, load, priority = 0) {
    const readyEntry = this._ready.get(key);
    if (readyEntry) {
      readyEntry.lastAccess = ++this._accessCounter;
      this._diagnostics?.increment("pbfCacheHits");
      this._updateResidentGauges();
      return this._createReadyHandle(readyEntry.master);
    }

    let pendingEntry = this._pending.get(key);
    if (pendingEntry?.generation !== this._generation) {
      pendingEntry = undefined;
    }
    if (pendingEntry) {
      this._diagnostics?.increment("pbfRequestJoins");
      const handle = this._addConsumer(pendingEntry, priority);
      this._updatePendingPriority(pendingEntry);
      return handle;
    }

    this._diagnostics?.increment("pbfCacheMisses");
    pendingEntry = {
      key,
      generation: this._generation,
      consumers: new Set(),
      task: undefined,
      cancelled: false,
    };
    this._pending.set(key, pendingEntry);
    const handle = this._addConsumer(pendingEntry, priority);

    try {
      pendingEntry.task = load(normalizePriority(priority));
      if (!pendingEntry.task?.promise) {
        throw new DeveloperError("PBF load must return a task with a promise.");
      }
      this._updatePendingPriority(pendingEntry);
      pendingEntry.task.promise.then(
        (arrayBuffer) => this._resolvePending(pendingEntry, arrayBuffer),
        (error) => this._rejectPending(pendingEntry, error),
      );
    } catch (error) {
      this._rejectPending(pendingEntry, error);
    }

    return handle;
  }

  /**
   * 清除 ready PBF；既有消费者和在途网络请求继续运行，但旧请求不得回填。
   */
  clear() {
    this._generation++;
    this._ready.clear();
    this._totalBytes = 0;
    this._updateResidentGauges();
  }

  _createReadyHandle(master) {
    let cancelled = false;
    let settled = false;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject;
      queueMicrotask(() => {
        if (!cancelled) {
          settled = true;
          resolve(this._copyBuffer(master));
        }
      });
    });

    return {
      promise,
      cancel() {
        if (!cancelled && !settled) {
          cancelled = true;
          rejectPromise(new VectorTileTaskCancelledError());
        }
      },
      setPriority() {},
      get cancelled() {
        return cancelled;
      },
    };
  }

  _addConsumer(pendingEntry, priority) {
    const consumer = {
      priority: normalizePriority(priority),
      cancelled: false,
      settled: false,
    };
    consumer.promise = new Promise((resolve, reject) => {
      consumer.resolve = resolve;
      consumer.reject = reject;
    });
    pendingEntry.consumers.add(consumer);

    return {
      promise: consumer.promise,
      cancel: () => this._cancelConsumer(pendingEntry, consumer),
      setPriority: (value) => {
        if (consumer.cancelled || consumer.settled) {
          return;
        }
        consumer.priority = normalizePriority(value);
        this._updatePendingPriority(pendingEntry);
      },
      get cancelled() {
        return consumer.cancelled;
      },
    };
  }

  _cancelConsumer(pendingEntry, consumer) {
    if (consumer.cancelled || consumer.settled) {
      return;
    }

    consumer.cancelled = true;
    consumer.settled = true;
    consumer.reject(new VectorTileTaskCancelledError());
    pendingEntry.consumers.delete(consumer);

    if (pendingEntry.consumers.size === 0) {
      pendingEntry.cancelled = true;
      if (this._pending.get(pendingEntry.key) === pendingEntry) {
        this._pending.delete(pendingEntry.key);
      }
      pendingEntry.task?.cancel();
      return;
    }

    this._updatePendingPriority(pendingEntry);
  }

  _updatePendingPriority(pendingEntry) {
    if (!pendingEntry.task || pendingEntry.consumers.size === 0) {
      return;
    }
    let priority = Number.POSITIVE_INFINITY;
    for (const consumer of pendingEntry.consumers) {
      priority = Math.min(priority, consumer.priority);
    }
    pendingEntry.task.setPriority?.(priority);
  }

  _resolvePending(pendingEntry, arrayBuffer) {
    if (this._pending.get(pendingEntry.key) === pendingEntry) {
      this._pending.delete(pendingEntry.key);
    }
    if (pendingEntry.cancelled) {
      return;
    }

    const canCache =
      arrayBuffer instanceof ArrayBuffer && arrayBuffer.byteLength > 0;
    if (canCache && pendingEntry.generation === this._generation) {
      this._storeReady(pendingEntry.key, arrayBuffer, pendingEntry.generation);
    }

    for (const consumer of pendingEntry.consumers) {
      if (consumer.cancelled || consumer.settled) {
        continue;
      }
      consumer.settled = true;
      consumer.resolve(
        arrayBuffer instanceof ArrayBuffer
          ? this._copyBuffer(arrayBuffer)
          : arrayBuffer,
      );
    }
    pendingEntry.consumers.clear();
  }

  _rejectPending(pendingEntry, error) {
    if (this._pending.get(pendingEntry.key) === pendingEntry) {
      this._pending.delete(pendingEntry.key);
    }
    for (const consumer of pendingEntry.consumers) {
      if (consumer.cancelled || consumer.settled) {
        continue;
      }
      consumer.settled = true;
      consumer.reject(error);
    }
    pendingEntry.consumers.clear();
  }

  _storeReady(key, master, generation) {
    if (
      this.maximumBytes === 0 ||
      master.byteLength === 0 ||
      generation !== this._generation
    ) {
      return;
    }
    if (master.byteLength > this.maximumBytes) {
      this._diagnostics?.increment("pbfCacheOversizeSkips");
      return;
    }

    const existing = this._ready.get(key);
    if (existing) {
      this._totalBytes -= existing.byteLength;
    }
    this._ready.set(key, {
      master,
      byteLength: master.byteLength,
      lastAccess: ++this._accessCounter,
      generation,
    });
    this._totalBytes += master.byteLength;
    this._trim();
    this._updateResidentGauges();
  }

  _trim() {
    while (this._totalBytes > this.maximumBytes && this._ready.size > 0) {
      let oldestKey;
      let oldestEntry;
      for (const [key, entry] of this._ready) {
        if (!oldestEntry || entry.lastAccess < oldestEntry.lastAccess) {
          oldestKey = key;
          oldestEntry = entry;
        }
      }
      this._ready.delete(oldestKey);
      this._totalBytes -= oldestEntry.byteLength;
      this._diagnostics?.increment("pbfCacheEvictions");
    }
  }

  _copyBuffer(master) {
    this._diagnostics?.increment("pbfCacheCopies");
    return master.slice(0);
  }

  _updateResidentGauges() {
    this._diagnostics?.setGauge("residentPbfCacheBytes", this._totalBytes);
    this._diagnostics?.setGauge("residentPbfCacheEntries", this._ready.size);
  }
}

function normalizePriority(priority) {
  return Number.isFinite(priority) ? priority : 0;
}
