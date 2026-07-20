import assert from "node:assert/strict";

const { default: VectorTileCache } = await import("../src/VectorTileCache.js");

{
  const cache = new VectorTileCache({ maximumBytes: 20 });
  const oldTile = createTile(0);
  const newTile = createTile(1);
  oldTile.cache = cache;
  newTile.cache = cache;

  cache.set("[0,1,2,3]", oldTile);
  cache.updateSize(oldTile, 6);
  oldTile.addReference();
  cache.clear();

  assert.equal(cache.length, 1);
  assert.equal(oldTile.cacheStale, true);
  assert.equal(oldTile.destroyed, false);

  cache.set("[1,1,2,3]", newTile);
  cache.updateSize(newTile, 6);

  assert.deepEqual(cache.getStatistics(1), {
    tiles: 2,
    bytes: 12,
    staleTiles: 1,
    retiredTiles: 1,
    offscreenTiles: 1,
  });

  oldTile.releaseReference();
  assert.equal(cache.length, 1);
  assert.equal(oldTile.destroyed, true);
  assert.equal(newTile.destroyed, false);
  console.log("✓ stale referenced entries can coexist with current revision");
}

{
  const gauges = {};
  const diagnostics = {
    increment() {},
    addGauge(name, amount) {
      gauges[name] = Math.max(0, (gauges[name] ?? 0) + amount);
    },
  };
  const cache = new VectorTileCache({
    maximumBytes: 20,
    diagnostics,
  });
  const tile = createTile(0);
  tile.cache = cache;
  cache.set("[0,0,0,0]", tile);
  tile.addReference();
  tile.releaseReference();
  assert.equal(gauges.offscreenResidentVectorTiles, 1);

  tile.addReference();
  assert.equal(gauges.offscreenResidentVectorTiles, 0);
  tile.releaseReference();
  cache.destroy();
  assert.equal(gauges.offscreenResidentVectorTiles, 0);
  assert.equal(tile.destroyed, true);
  console.log("✓ offscreen residency follows reference and eviction state");
}

{
  const cache = new VectorTileCache({ maximumBytes: 30 });
  const revision0 = createTile(0);
  const revision1 = createTile(1);
  const revision2 = createTile(2);
  revision0.cache = cache;
  revision1.cache = cache;
  revision2.cache = cache;

  cache.set("[0,0,0,0]", revision0);
  revision0.addReference();
  cache.clear();
  cache.set("[1,0,0,0]", revision1);
  revision1.addReference();
  cache.clear();
  cache.set("[2,0,0,0]", revision2);

  assert.equal(cache.getStatistics(2).retiredTiles, 2);
  revision0.releaseReference();
  revision1.releaseReference();
  assert.equal(revision0.destroyed, true);
  assert.equal(revision1.destroyed, true);
  assert.equal(revision2.destroyed, false);
  assert.equal(cache.getStatistics(2).retiredTiles, 0);
  console.log("✓ multiple stale revisions are released independently");
}

console.log("VectorTileCache tests passed.");

function createTile(contentRevision) {
  return {
    contentRevision,
    referenceCount: 0,
    cacheBytes: 0,
    cacheable: true,
    destroyed: false,
    addReference() {
      if (this.referenceCount === 0) {
        this.cache.tileReferenced?.(this);
      }
      this.referenceCount++;
    },
    releaseReference() {
      this.referenceCount--;
      this.cache.tileReleased(this);
    },
    cancelPendingTasks() {
      this.cancelled = true;
    },
    destroyResources() {
      this.destroyed = true;
    },
  };
}
