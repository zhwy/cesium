import assert from "node:assert/strict";
import VectorTileCache from "../src/VectorTileCache.js";
import VectorTileDiagnostics from "../src/VectorTileDiagnostics.js";
import VectorTilePbfCache from "../src/VectorTilePbfCache.js";

const diagnostics = new VectorTileDiagnostics(true);
const renderCache = new VectorTileCache({
  maximumBytes: 16,
  diagnostics,
});
const pbfCache = new VectorTilePbfCache({
  maximumBytes: 16,
  diagnostics,
});
const renderTile = createRenderTile();
renderTile.cache = renderCache;
renderCache.set("render", renderTile);
renderCache.updateSize(renderTile, 4);

await pbfCache.getOrLoad("pbf", () =>
  resolvedTask(Uint8Array.from([1, 2, 3]).buffer),
).promise;
await pbfCache.getOrLoad("pbf", failIfCalled).promise;

let snapshot = diagnostics.snapshot();
assert.equal(snapshot.counters.cacheMisses, 1);
assert.equal(snapshot.counters.pbfCacheMisses, 1);
assert.equal(snapshot.counters.pbfCacheHits, 1);
assert.equal(snapshot.counters.pbfCacheCopies, 2);
assert.equal(snapshot.gauges.residentCacheBytes, 4);
assert.equal(snapshot.gauges.residentPbfCacheBytes, 3);
assert.equal(snapshot.gauges.residentPbfCacheEntries, 1);

pbfCache.clear();
snapshot = diagnostics.snapshot();
assert.equal(snapshot.gauges.residentCacheBytes, 4);
assert.equal(snapshot.gauges.residentPbfCacheBytes, 0);
assert.equal(snapshot.gauges.residentPbfCacheEntries, 0);
console.log("✓ diagnostics keep render-cache and PBF-cache metrics isolated");

function createRenderTile() {
  return {
    referenceCount: 0,
    cacheBytes: 0,
    cacheable: true,
    cancelPendingTasks() {},
    destroyResources() {},
  };
}

function resolvedTask(value) {
  return {
    promise: Promise.resolve(value),
    cancel() {},
    setPriority() {},
    cancelled: false,
  };
}

function failIfCalled() {
  assert.fail("load should not be called");
}
