/**
 * 管理 `VectorTile` 的内存缓存，按引用计数和最近访问时间执行回收。
 *
 * @param {object} [options={}] 构造参数。
 * @param {number} [options.maximumBytes=64*1024*1024] 缓存允许占用的最大字节数。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器，用于记录命中、驱逐与内存占用指标。
 */
class VectorTileCache {
  constructor(options = {}) {
    this.maximumBytes = options.maximumBytes ?? 64 * 1024 * 1024;
    this._diagnostics = options.diagnostics;
    this._entries = new Map();
    this._totalBytes = 0;
    this._accessCounter = 0;
  }

  get totalBytes() {
    return this._totalBytes;
  }

  get length() {
    return this._entries.size;
  }

  values() {
    return this._entries.values();
  }

  getStatistics(currentContentRevision) {
    let staleTiles = 0;
    let retiredTiles = 0;
    let offscreenTiles = 0;
    for (const tile of this._entries.values()) {
      if (tile.cacheStale) {
        staleTiles++;
      }
      if (
        currentContentRevision !== undefined &&
        tile.contentRevision !== currentContentRevision
      ) {
        retiredTiles++;
      }
      if (tile.referenceCount === 0) {
        offscreenTiles++;
      }
    }
    return {
      tiles: this._entries.size,
      bytes: this._totalBytes,
      staleTiles,
      retiredTiles,
      offscreenTiles,
    };
  }

  get(key) {
    const tile = this._entries.get(key);
    if (tile) {
      this.touch(tile);
    }
    return tile;
  }

  set(key, tile) {
    tile.cacheKey = key;
    tile.cacheBytes = tile.cacheBytes ?? 0;
    tile.cacheStale = false;
    this._entries.set(key, tile);
    this.touch(tile);
    this._diagnostics?.increment("cacheMisses");
    return tile;
  }

  touch(tile) {
    tile.lastCacheAccess = ++this._accessCounter;
  }

  recordHit(tile) {
    this.touch(tile);
    this._diagnostics?.increment("cacheHits");
  }

  updateSize(tile, bytes) {
    if (!this._entries.has(tile.cacheKey)) {
      return;
    }
    const normalizedBytes = Math.max(0, bytes || 0);
    const difference = normalizedBytes - tile.cacheBytes;
    tile.cacheBytes = normalizedBytes;
    this._totalBytes += difference;
    this._diagnostics?.addGauge("residentCacheBytes", difference);
    this.trim();
  }

  tileReleased(tile) {
    if (tile.cacheStale || !tile.cacheable) {
      this._evict(tile);
    } else {
      this._setOffscreen(tile, true);
      this.touch(tile);
      this.trim();
    }
  }

  tileReferenced(tile) {
    this._setOffscreen(tile, false);
  }

  trim() {
    if (this._totalBytes <= this.maximumBytes) {
      return;
    }

    const candidates = [...this._entries.values()]
      .filter((tile) => tile.referenceCount === 0)
      .sort((left, right) => left.lastCacheAccess - right.lastCacheAccess);
    for (
      let i = 0;
      i < candidates.length && this._totalBytes > this.maximumBytes;
      ++i
    ) {
      this._evict(candidates[i]);
    }
  }

  clear() {
    const tiles = [...this._entries.values()];
    for (let i = 0; i < tiles.length; ++i) {
      const tile = tiles[i];
      if (this._entries.get(tile.cacheKey) !== tile) {
        continue;
      }
      tile.cacheStale = true;
      tile.cancelPendingTasks();
      if (tile.referenceCount === 0) {
        this._evict(tile);
      }
    }
  }

  destroy() {
    const tiles = [...this._entries.values()].sort(
      (left, right) => (right.level ?? 0) - (left.level ?? 0),
    );
    for (const tile of tiles) {
      this._evict(tile);
    }
  }

  _evict(tile) {
    if (this._entries.get(tile.cacheKey) !== tile) {
      return;
    }
    this._entries.delete(tile.cacheKey);
    this._setOffscreen(tile, false);
    this._totalBytes -= tile.cacheBytes;
    this._diagnostics?.addGauge("residentCacheBytes", -tile.cacheBytes);
    this._diagnostics?.increment("cacheEvictions");
    tile.cacheBytes = 0;
    tile.destroyResources();
  }

  _setOffscreen(tile, offscreen) {
    if (tile._offscreenResident === offscreen) {
      return;
    }
    tile._offscreenResident = offscreen;
    this._diagnostics?.addGauge(
      "offscreenResidentVectorTiles",
      offscreen ? 1 : -1,
    );
  }
}

export default VectorTileCache;
