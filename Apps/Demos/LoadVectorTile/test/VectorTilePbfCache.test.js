import assert from "node:assert/strict";
import VectorTilePbfCache from "../src/VectorTilePbfCache.js";
import VectorTileTaskCancelledError from "../src/VectorTileTaskCancelledError.js";

const DEFAULT_PBF_CACHE_BYTES = VectorTilePbfCache.DEFAULT_PBF_CACHE_BYTES;

{
  const cache = new VectorTilePbfCache();
  assert.equal(cache.maximumBytes, DEFAULT_PBF_CACHE_BYTES);
  assert.deepEqual(cache.getStatistics(), { entries: 0, bytes: 0, pending: 0 });
  for (const maximumBytes of [-1, Infinity, NaN, "64"]) {
    assert.throws(() => new VectorTilePbfCache({ maximumBytes }), /finite/);
  }
  console.log("✓ PBF cache validates its manager-level byte budget");
}

{
  const diagnostics = createDiagnostics();
  const cache = new VectorTilePbfCache({ maximumBytes: 6, diagnostics });
  const firstMaster = createBuffer([1, 2, 3]);
  const secondMaster = createBuffer([4, 5, 6]);
  const thirdMaster = createBuffer([7, 8, 9]);

  const firstCopy = await cache.getOrLoad("first", () =>
    resolvedTask(firstMaster),
  ).promise;
  await cache.getOrLoad("second", () => resolvedTask(secondMaster)).promise;
  const hitCopy = await cache.getOrLoad("first", failIfCalled).promise;
  await cache.getOrLoad("third", () => resolvedTask(thirdMaster)).promise;

  assert.notEqual(firstCopy, firstMaster);
  assert.notEqual(hitCopy, firstCopy);
  assert.deepEqual([...new Uint8Array(hitCopy)], [1, 2, 3]);
  assert.equal(cache.totalBytes, 6);
  assert.equal(cache.length, 2);
  assert.equal(diagnostics.counters.pbfCacheHits, 1);
  assert.equal(diagnostics.counters.pbfCacheEvictions, 1);

  let secondReloads = 0;
  await cache.getOrLoad("second", () => {
    secondReloads++;
    return resolvedTask(secondMaster);
  }).promise;
  assert.equal(secondReloads, 1);
  console.log(
    "✓ ready PBF entries return private copies and use byte-based LRU",
  );
}

{
  const diagnostics = createDiagnostics();
  const cache = new VectorTilePbfCache({ maximumBytes: 4, diagnostics });
  await cache.getOrLoad("small", () => resolvedTask(createBuffer([1, 2])))
    .promise;
  await cache.getOrLoad("large", () =>
    resolvedTask(createBuffer([1, 2, 3, 4, 5])),
  ).promise;
  assert.deepEqual(cache.getStatistics(), { entries: 1, bytes: 2, pending: 0 });
  assert.equal(diagnostics.counters.pbfCacheOversizeSkips, 1);

  await cache.getOrLoad("empty", () => resolvedTask(new ArrayBuffer(0)))
    .promise;
  assert.equal(cache.length, 1);
  console.log("✓ empty and oversize responses bypass ready residency");
}

{
  const cache = new VectorTilePbfCache({ maximumBytes: 0 });
  let loads = 0;
  const master = createBuffer([1]);
  await cache.getOrLoad("tile", () => {
    loads++;
    return resolvedTask(master);
  }).promise;
  await cache.getOrLoad("tile", () => {
    loads++;
    return resolvedTask(master);
  }).promise;
  assert.equal(loads, 2);
  assert.equal(cache.length, 0);
  console.log("✓ zero budget disables ready residency");
}

{
  const cache = new VectorTilePbfCache({ maximumBytes: 10 });
  const deferred = createTask();
  const consumer = cache.getOrLoad("tile", () => deferred.handle);
  cache.clear();
  deferred.resolve(createBuffer([1, 2, 3]));
  assert.deepEqual([...new Uint8Array(await consumer.promise)], [1, 2, 3]);
  assert.equal(cache.length, 0);
  console.log(
    "✓ clear preserves consumers but blocks old pending generation refill",
  );
}

{
  const cache = new VectorTilePbfCache({ maximumBytes: 10 });
  const oldTask = createTask();
  const newTask = createTask();
  let loadCount = 0;
  const oldConsumer = cache.getOrLoad("generation", () => {
    loadCount++;
    return oldTask.handle;
  });
  cache.clear();
  const newConsumer = cache.getOrLoad("generation", () => {
    loadCount++;
    return newTask.handle;
  });
  assert.equal(loadCount, 2);

  newTask.resolve(createBuffer([2]));
  assert.deepEqual([...new Uint8Array(await newConsumer.promise)], [2]);
  oldTask.resolve(createBuffer([1]));
  assert.deepEqual([...new Uint8Array(await oldConsumer.promise)], [1]);
  const cached = await cache.getOrLoad("generation", failIfCalled).promise;
  assert.deepEqual([...new Uint8Array(cached)], [2]);
  console.log("✓ post-clear reads ignore and outlive old pending work");
}

{
  const diagnostics = createDiagnostics();
  const cache = new VectorTilePbfCache({ maximumBytes: 0, diagnostics });
  const deferred = createTask();
  let loadCount = 0;
  const first = cache.getOrLoad(
    "shared",
    () => {
      loadCount++;
      return deferred.handle;
    },
    8,
  );
  const second = cache.getOrLoad("shared", failIfCalled, 3);

  assert.equal(loadCount, 1);
  assert.deepEqual(deferred.priorities, [8, 3]);
  first.setPriority(1);
  assert.equal(deferred.priorities.at(-1), 1);
  first.cancel();
  await assert.rejects(first.promise, VectorTileTaskCancelledError);
  assert.equal(deferred.cancelCount, 0);

  deferred.resolve(createBuffer([9, 8]));
  const secondCopy = await second.promise;
  assert.deepEqual([...new Uint8Array(secondCopy)], [9, 8]);
  assert.equal(cache.length, 0);
  assert.equal(diagnostics.counters.pbfRequestJoins, 1);
  console.log(
    "✓ pending requests merge with isolated cancellation and priority",
  );
}

{
  const cache = new VectorTilePbfCache();
  const deferred = createTask();
  const first = cache.getOrLoad("copies", () => deferred.handle);
  const second = cache.getOrLoad("copies", failIfCalled);
  deferred.resolve(createBuffer([3, 2, 1]));
  const [firstCopy, secondCopy] = await Promise.all([
    first.promise,
    second.promise,
  ]);
  assert.notEqual(firstCopy, secondCopy);
  assert.deepEqual([...new Uint8Array(firstCopy)], [3, 2, 1]);
  assert.deepEqual([...new Uint8Array(secondCopy)], [3, 2, 1]);
  console.log("✓ joined consumers receive independent working buffers");
}

{
  const cache = new VectorTilePbfCache();
  const deferred = createTask();
  const first = cache.getOrLoad("cancel-all", () => deferred.handle);
  const second = cache.getOrLoad("cancel-all", failIfCalled);
  first.promise.catch(() => {});
  second.promise.catch(() => {});
  first.cancel();
  second.cancel();
  assert.equal(deferred.cancelCount, 1);
  assert.equal(cache.pendingCount, 0);
  deferred.resolve(createBuffer([1]));
  await Promise.resolve();
  assert.equal(cache.length, 0);
  console.log("✓ the final consumer cancellation stops the shared task");
}

{
  const cache = new VectorTilePbfCache();
  const failed = createTask();
  const first = cache.getOrLoad("retry", () => failed.handle);
  failed.reject(new Error("network failed"));
  await assert.rejects(first.promise, /network failed/);

  let retryCount = 0;
  const retried = cache.getOrLoad("retry", () => {
    retryCount++;
    return resolvedTask(createBuffer([1]));
  });
  await retried.promise;
  assert.equal(retryCount, 1);
  console.log("✓ failed pending requests are removed and can be retried");
}

console.log("VectorTilePbfCache tests passed.");

function createBuffer(values) {
  return Uint8Array.from(values).buffer;
}

function resolvedTask(value) {
  return {
    promise: Promise.resolve(value),
    cancel() {},
    setPriority() {},
    cancelled: false,
  };
}

function createTask() {
  let resolvePromise;
  let rejectPromise;
  const task = {
    priorities: [],
    cancelCount: 0,
  };
  task.handle = {
    promise: new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    cancel() {
      task.cancelCount++;
    },
    setPriority(priority) {
      task.priorities.push(priority);
    },
    cancelled: false,
  };
  task.resolve = resolvePromise;
  task.reject = rejectPromise;
  return task;
}

function createDiagnostics() {
  return {
    counters: {},
    gauges: {},
    increment(name, amount = 1) {
      this.counters[name] = (this.counters[name] ?? 0) + amount;
    },
    setGauge(name, value) {
      this.gauges[name] = value;
    },
  };
}

function failIfCalled() {
  assert.fail("load should not be called");
}
