import assert from "node:assert/strict";
import test from "node:test";
import Event from "../../../../packages/core/Source/Event.js";
import createBenchmark from "../src/createVectorTileBenchmark.js";
import VectorTileDiagnostics from "../src/VectorTileDiagnostics.js";

test("面后端对比隔离相同图层、保留开关并恢复原配置", async () => {
  const original = {
    sources: { source: { url: "/{z}/{x}/{y}.pbf" } },
    layers: [
      {
        id: "land",
        type: "fill",
        source: "source",
        useBufferPrimitive: true,
        paint: { "fill-color": "#ff0000ff" },
      },
      { id: "other", type: "line", source: "source", visibility: true },
    ],
  };
  let style = structuredClone(original);
  const seen = [];
  const manager = {
    diagnostics: new VectorTileDiagnostics(true),
    getStyle: () => structuredClone(style),
    setLayerStyle: (id, value) => {
      style = {
        ...style,
        layers: style.layers.map((layer) => (layer.id === id ? value : layer)),
      };
    },
    quadtreePrimitive: {
      _tileLoadQueueHigh: [],
      _tileLoadQueueMedium: [],
      _tileLoadQueueLow: [],
    },
    _networkScheduler: { activeTasks: 0, queuedTasks: 0 },
    _decodeScheduler: { activeTasks: 0, queuedTasks: 0 },
    _buildScheduler: { activeTasks: 0, queuedTasks: 0 },
    clearCache: () => {
      seen.push(structuredClone(style));
    },
  };
  const scene = {
    preUpdate: new Event(),
    postRender: new Event(),
    frameState: { commandList: [] },
  };
  const viewer = { scene, camera: { setView() {} } };
  const oldDocument = globalThis.document;
  globalThis.document = { baseURI: "http://localhost/" };
  const timer = setInterval(() => {
    scene.preUpdate.raiseEvent();
    scene.postRender.raiseEvent();
  }, 2);
  try {
    const benchmark = createBenchmark(viewer, manager);
    await assert.rejects(
      () => benchmark.compareBufferPolygons(["missing"], "close"),
      /layerIds/,
    );
    const result = await benchmark.compareBufferPolygons(["land"], "close", {
      timeoutMs: 50,
      stableFrames: 1,
      minFrames: 1,
      steadyMs: 0,
    });
    assert.equal(seen[0].layers[0].useBufferPrimitive, false);
    assert.equal(seen[1].layers[0].useBufferPrimitive, true);
    assert.equal(seen[0].layers[1].visibility, false);
    assert.equal(result.comparable, false); // 无实际 Buffer 激活时不能报告性能收益。
    assert.deepEqual(style, original);
    clearInterval(timer);
    const stopped = await benchmark.compareBufferPolygons(["land"], "close", {
      timeoutMs: 5,
      stableFrames: 1,
      minFrames: 1,
      steadyMs: 0,
    });
    assert.equal(stopped.primitives.settled, false);
    assert.equal(stopped.buffer.settled, false);
    assert.deepEqual(style, original);
    manager.clearCache = () => {
      throw new Error("加载失败");
    };
    await assert.rejects(
      () => benchmark.compareBufferPolygons(["land"], "close"),
      /加载失败/,
    );
    assert.deepEqual(style, original);
  } finally {
    clearInterval(timer);
    globalThis.document = oldDocument;
  }
});
