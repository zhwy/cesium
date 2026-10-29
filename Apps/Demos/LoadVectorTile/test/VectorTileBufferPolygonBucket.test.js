import assert from "node:assert/strict";
import test from "node:test";
import Cartesian3 from "../../../../packages/core/Source/Cartesian3.js";
import VectorTileBufferPolygonGeometry from "../src/VectorTileBufferPolygonGeometry.js";
import Matrix4 from "../../../../packages/core/Source/Matrix4.js";
import BufferPolygon from "../../../../packages/engine/Source/Scene/BufferPolygon.js";
import BufferPolygonMaterial from "../../../../packages/engine/Source/Scene/BufferPolygonMaterial.js";
import VectorTileBufferPolygonBucket from "../src/VectorTileBufferPolygonBucket.js";
import VectorTilePrimitiveBucket from "../src/VectorTilePrimitiveBucket.js";
import VectorTilePickRegistry from "../src/VectorTilePickRegistry.js";
import VectorTileFeatureStateStore from "../src/VectorTileFeatureStateStore.js";
import VectorTileDiagnostics from "../src/VectorTileDiagnostics.js";
import VectorTileStyleUtils from "../src/VectorTileStyleUtils.js";
import VectorTileStyleRule from "../src/VectorTileStyleRule.js";
import createPrimitiveBucket from "../src/createVectorTilePrimitiveBucket.js";
import VectorTileQuadtreePrimitive from "../src/VectorTileQuadtreePrimitive.js";
import VectorTileLayer from "../src/VectorTileLayer.js";
import ImageryState from "../../../../packages/engine/Source/Scene/ImageryState.js";
import VectorTileDecoder from "../src/VectorTileDecoder.js";
import { setImmediate } from "node:timers/promises";

// 测试从与 Worker 相同的准备契约进入工厂，不提供主线程运行时兜底。
function createBucket(layer, rule, zoom, options) {
  if (rule.type === "fill" && rule.useBufferPrimitive) {
    layer.bufferPolygons = [
      VectorTileBufferPolygonGeometry.prepareLayer(
        layer,
        VectorTileBufferPolygonGeometry.getParameters(rule),
      ),
    ];
  }
  return createPrimitiveBucket(layer, rule, zoom, options);
}

function fillBucket(bucket) {
  const primitive = bucket.primitives[0];
  const update = primitive.collection.update;
  primitive.collection.update = () => {};
  for (let frameNumber = 1; !primitive.ready; frameNumber++) {
    primitive.update({
      frameNumber,
      mode: 3,
      passes: { render: false, pick: false },
    });
  }
  primitive.collection.update = update;
}

function createLayer(rings = [[0, 0, 2, 0, 2, 2, 0, 2, 0, 0]]) {
  const positions = [];
  const ringOffsets = [0];
  for (const ring of rings) {
    positions.push(...ring);
    ringOffsets.push(positions.length / 2);
  }
  return {
    features: [
      {
        id: 7,
        sourceFeatureIndex: 4,
        properties: { kind: "park", color: "#ff0000ff" },
      },
    ],
    polygons: {
      positions: Float64Array.from(positions),
      ringOffsets: Uint32Array.from(ringOffsets),
      polygonOffsets: new Uint32Array([0, rings.length]),
      featureIndices: new Uint32Array([0]),
    },
    lines: {
      positions: new Float64Array(),
      offsets: new Uint32Array([0]),
      featureIndices: new Uint32Array(),
    },
    points: {
      positions: new Float64Array(),
      featureIndices: new Uint32Array(),
    },
  };
}

function createRule(extra = {}) {
  return {
    id: "land",
    type: "fill",
    source: "source",
    sourceLayer: "land",
    useBufferPrimitive: true,
    paint: { "fill-color": "#ff0000ff" },
    ...extra,
  };
}

function getMaterial(bucket) {
  return bucket.primitives[0].collection
    .get(0, new BufferPolygon())
    .getMaterial(new BufferPolygonMaterial());
}

test("图层开关校验、序列化和结构更新", () => {
  const document = {
    sources: { source: { type: "vector", url: "/{z}/{x}/{y}.pbf" } },
    layers: [createRule()],
  };
  const normalized = VectorTileStyleUtils.normalizeStyleDocument(document);
  const rule = new VectorTileStyleRule(normalized.layers[0]);
  assert.equal(rule.toJSON().useBufferPrimitive, true);
  for (const value of [null, 1, "true", [], {}]) {
    assert.throws(
      () =>
        VectorTileStyleUtils.normalizeStyleDocument({
          ...document,
          layers: [createRule({ useBufferPrimitive: value })],
        }),
      /land.*useBufferPrimitive/,
    );
  }
  const legacy = VectorTileStyleUtils.normalizeStyleDocument({
    ...document,
    layers: [createRule({ useBufferPrimitive: undefined })],
  }).layers[0];
  assert.equal(legacy.useBufferPrimitive, false);
  const explicitFalse = { ...legacy, useBufferPrimitive: false };
  assert.equal(
    VectorTileStyleUtils.createVectorTileStyleUpdatePlan(legacy, explicitFalse)
      .type,
    "NO_OP",
  );
  assert.equal(
    VectorTileStyleUtils.createVectorTileStyleUpdatePlan(legacy, rule.toJSON())
      .type,
    "REBUILD_SOURCE",
  );
});

test("工厂只为启用开关的 fill 路由到 Buffer", () => {
  const layer = createLayer();
  for (const enabled of [true, false, undefined]) {
    const bucket = createBucket(
      layer,
      createRule({ useBufferPrimitive: enabled }),
      4,
      { featureTable: layer.features },
    );
    assert.equal(
      bucket instanceof VectorTileBufferPolygonBucket,
      enabled === true,
    );
    bucket.destroy();
  }
  const line = createBucket(layer, createRule({ type: "line" }), 4, {
    featureTable: layer.features,
  });
  assert.equal(line.constructor.name, "VectorTileLineBucket");
  line.destroy();
});

test("非贴地面细分、洞索引与实际容量", () => {
  const layer = createLayer([
    [0, 0, 10, 0, 10, 10, 0, 10, 0, 0],
    [2, 2, 2, 3, 3, 3, 3, 2, 2, 2],
  ]);
  const bucket = createBucket(
    layer,
    createRule({ terrain: { heightOffset: 100 } }),
    4,
    { featureTable: layer.features },
  );
  const primitive = bucket.primitives[0];
  const collection = primitive.collection;
  assert.equal(collection.primitiveCount, 0);
  fillBucket(bucket);
  const polygon = collection.get(0, new BufferPolygon());
  assert.equal(polygon.holeCount, 1);
  assert.equal(polygon.getHoles()[0], 4);
  assert.ok(polygon.vertexCount > 8);
  assert.ok(polygon.triangleCount > 8);
  assert.equal(collection.vertexCountMax, collection.vertexCount);
  assert.equal(collection.triangleCountMax, collection.triangleCount);
  assert.ok(
    [...polygon.getTriangles()].every((index) => index < polygon.vertexCount),
  );
  const world = Matrix4.multiplyByPoint(
    collection.modelMatrix,
    Cartesian3.fromArray(polygon.getPositions()),
    new Cartesian3(),
  );
  assert.ok(Cartesian3.magnitude(world) > 6378137);
  bucket.destroy();
  assert.equal(primitive.isDestroyed(), true);
  bucket.destroy();
});

test("贴地面准备与实际提交分离，隐藏及销毁不残留", () => {
  const layer = createLayer();
  const marks = [];
  const removals = [];
  const scene = {
    vectorProvider: {
      markForFrame: (...args) => marks.push(args),
      remove: (collection) => removals.push(collection),
    },
  };
  const diagnostics = new VectorTileDiagnostics(true);
  const bucket = createBucket(
    layer,
    createRule({ terrain: { clampToGround: true } }),
    4,
    { featureTable: layer.features, scene, diagnostics },
  );
  const primitive = bucket.primitives[0];
  assert.equal(primitive.ready, false);
  const frame = {
    frameNumber: 1,
    mode: 3,
    context: {},
    passes: { render: true },
  };
  primitive.update(frame);
  assert.equal(primitive.ready, true);
  assert.equal(marks.length, 0);
  primitive.submitForFrame(frame);
  assert.equal(marks.length, 1);
  assert.equal(marks[0][0].constructor.name, "BufferPolygonCollection");
  assert.equal(marks[0][1], 1);
  primitive.show = false;
  primitive.submitForFrame({ ...frame, frameNumber: 2 });
  assert.equal(marks.length, 1);
  bucket.destroy();
  assert.deepEqual(removals, [primitive.collection]);
  assert.equal(diagnostics.snapshot().gauges.residentBufferPolygons, 0);
  assert.equal(diagnostics.snapshot().gauges.residentBufferPolygonBytes, 0);
  assert.throws(() => {
    const missing = createBucket(
      layer,
      createRule({ terrain: { clampToGround: true } }),
      4,
      { featureTable: layer.features },
    );
    try {
      fillBucket(missing);
      missing.primitives[0].submitForFrame(frame);
    } finally {
      missing.destroy();
    }
  }, /vectorProvider/);
});

test("超过默认容量、成面线和退化空面", () => {
  const ring = [];
  for (let i = 0; i < 1100; i++) {
    const angle = (i * Math.PI * 2) / 1100;
    ring.push(Math.cos(angle), Math.sin(angle));
  }
  const layer = createLayer([ring]);
  const bucket = createBucket(
    layer,
    createRule({ terrain: { clampToGround: true } }),
    4,
    { featureTable: layer.features },
  );
  fillBucket(bucket);
  assert.equal(bucket.primitives[0].collection.vertexCount, 1100);
  assert.equal(bucket.primitives[0].collection.triangleCountMax, 0);
  bucket.destroy();
  const lineLayer = createLayer([]);
  lineLayer.lines = {
    positions: new Float64Array([0, 0, 1, 0, 1, 1]),
    offsets: new Uint32Array([0, 3]),
    featureIndices: new Uint32Array([0]),
  };
  const lines = createBucket(lineLayer, createRule(), 4, {
    featureTable: lineLayer.features,
  });
  assert.equal(lines.length, 1);
  lines.destroy();
  const empty = createBucket(
    createLayer([[0, 0, 1, 1, 2, 2]]),
    createRule(),
    4,
  );
  assert.equal(empty.length, 0);
  empty.destroy();
});

test("颜色原地更新、透明 feature-state 与属性缺失回退", () => {
  const layer = createLayer();
  const store = new VectorTileFeatureStateStore();
  const rule = createRule({
    paint: {
      "fill-color": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        "#00ff00ff",
        "#00000000",
      ],
    },
  });
  const bucket = createBucket(layer, rule, 4, {
    featureTable: layer.features,
    featureStateStore: store,
  });
  const primitive = bucket.primitives[0];
  fillBucket(bucket);
  primitive.ready = false;
  assert.equal(getMaterial(bucket).color.alpha, 0);
  assert.equal(bucket.getFeatureStateKeys().length, 1);
  store.set({ sourceLayer: "land", id: 7 }, { hover: true });
  assert.equal(
    bucket.applyFeatureState({ sourceLayer: "land", id: 7 }).deferredUpdates,
    1,
  );
  primitive.ready = true;
  bucket.applyPendingFeatureStateUpdates();
  assert.equal(getMaterial(bucket).color.green, 1);
  assert.equal(getMaterial(bucket).color.alpha, 1);
  store.remove({ sourceLayer: "land", id: 7 });
  bucket.applyFeatureState({ sourceLayer: "land", id: 7 });
  assert.equal(getMaterial(bucket).color.alpha, 0);
  const result = bucket.applyStyle(
    createRule({ paint: { "fill-color": "#0000ffff" } }),
    1,
    { changedPaths: ["paint.fill-color"] },
  );
  assert.equal(result.instanceUpdates, 1);
  assert.equal(bucket.primitives[0], primitive);
  assert.equal(getMaterial(bucket).color.blue, 1);
  bucket._propertyProjection = { retainAll: false, properties: [] };
  const fallback = bucket.applyStyle(
    createRule({ paint: { "fill-color": ["get", "missing"] } }),
    2,
  );
  assert.equal(fallback.fallbackReason, "MISSING_PROPERTIES");
  bucket.destroy();
});

test("紧凑拾取复用现有 registry，销毁注销且保留轮廓", () => {
  const layer = createLayer();
  const registry = new VectorTilePickRegistry();
  const rule = createRule({
    paint: {
      "fill-color": "#ff0000ff",
      "fill-outline-color": "#ffffffff",
      "fill-outline-width": 2,
    },
  });
  const vectorTile = { x: 1, y: 2, level: 4, primitives: {}, buckets: {} };
  const bucket = createBucket(layer, rule, 4, {
    allowPicking: true,
    asynchronous: false,
    featureTable: layer.features,
    vectorTile,
    sourceId: "source",
    pickRegistry: registry,
    pickProperties: ["kind"],
  });
  assert.equal(bucket.length, 2);
  assert.equal(bucket.primitives[1].constructor.name, "Primitive");
  VectorTilePrimitiveBucket.storeVectorTileBucket(vectorTile, bucket, rule);
  fillBucket(bucket);
  const picked = bucket.primitives[0].collection.get(
    0,
    new BufferPolygon(),
  ).pickObject;
  const resolved = registry.resolve(picked);
  assert.equal(resolved.id, 7);
  assert.deepEqual(resolved.properties, { kind: "park" });
  assert.equal(resolved.sourceFeatureIndex, 4);
  assert.equal(resolved.layerId, "land");
  bucket.destroy();
  assert.equal(registry.resolve(picked), undefined);
});

test("实际四叉树 committed 提交调用贴地 hook，隐藏后停止", () => {
  const layer = createLayer();
  const marks = [];
  const scene = {
    vectorProvider: {
      markForFrame: (...args) => marks.push(args),
      remove() {},
    },
  };
  const bucket = createBucket(
    layer,
    createRule({ terrain: { clampToGround: true } }),
    4,
    { featureTable: layer.features, scene },
  );
  const renderer = Object.create(VectorTileQuadtreePrimitive.prototype);
  renderer._tilesToRender = [];
  renderer._syncLayerPointCollections = () => {};
  renderer._layerRenderStates = new Map([
    [
      { _show: true },
      {
        committedRenderSet: new Set([
          {
            primitives: { land: bucket.primitives },
            buckets: { land: bucket },
          },
        ]),
      },
    ],
  ]);
  const frame = {
    frameNumber: 1,
    mode: 3,
    context: {},
    passes: { render: false, pick: true },
    commandList: [],
  };
  renderer.renderTiles(frame);
  assert.equal(marks.length, 1);
  bucket.styleRule.visibility = false;
  renderer.renderTiles({ ...frame, frameNumber: 2 });
  assert.equal(marks.length, 1);
  bucket.destroy();
});

test("贴地 outline 工厂和非零高度回退", () => {
  const layer = createLayer();
  const diagnostics = new VectorTileDiagnostics(true);
  const outlines = [];
  const bucket = createBucket(
    layer,
    createRule({
      paint: {
        "fill-color": "#ff0000ff",
        "fill-outline-color": "#ffffffff",
        "fill-outline-width": 2,
      },
      terrain: { clampToGround: true },
    }),
    4,
    {
      diagnostics,
      featureTable: layer.features,
      createGroundPolylinePrimitive: (instances) => {
        outlines.push(instances);
        return { ready: true, isDestroyed: () => false, destroy() {} };
      },
    },
  );
  assert.equal(outlines.length, 1);
  assert.equal(bucket.primitiveRecords[1].role, "fill-outline");
  bucket.destroy();
  const fallback = createBucket(
    layer,
    createRule({ terrain: { clampToGround: true, heightOffset: 5 } }),
    4,
    { featureTable: layer.features, diagnostics },
  );
  assert.equal(fallback.primitives[0]._ground, false);
  assert.equal(diagnostics.snapshot().counters.groundHeightOffsetFallbacks, 1);
  fallback.destroy();
});

test("manager 共享软预算，同帧 update/pick 不重置，跨帧完成才提交", (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const layer = createLayer();
  layer.polygons.polygonOffsets = new Uint32Array([0, 1, 1, 1]);
  // 以成面线增加三个独立实例。
  layer.lines = {
    positions: Float64Array.from(Array(3).fill([0, 0, 1, 0, 1, 1]).flat()),
    offsets: new Uint32Array([0, 3, 6, 9]),
    featureIndices: new Uint32Array([0, 0, 0]),
  };
  const budget = { frameNumber: undefined, spent: 0 };
  const diagnostics = new VectorTileDiagnostics(true);
  const store = new VectorTileFeatureStateStore();
  const scene = {
    requestRender: t.mock.fn(),
    vectorProvider: { markForFrame: t.mock.fn(), remove() {} },
  };
  const options = {
    featureTable: layer.features,
    diagnostics,
    scene,
    bufferPolygonBudget: budget,
    featureStateStore: store,
  };
  const rule = createRule({ terrain: { clampToGround: true } });
  const first = createBucket(layer, rule, 4, options);
  const second = createBucket(layer, rule, 4, options);
  const primitive = first.primitives[0];
  const collection = primitive.collection;
  const add = collection.add.bind(collection);
  t.mock.method(collection, "add", (...args) => {
    clock += 3;
    return add(...args);
  });
  t.mock.method(collection, "update", () => {});
  const frame = {
    frameNumber: 1,
    mode: 3,
    passes: { render: true },
    commandList: [],
  };
  primitive.update(frame);
  assert.equal(collection.primitiveCount, 2);
  assert.equal(primitive.ready, false);
  assert.equal(collection.update.mock.callCount(), 0);
  primitive.submitForFrame(frame);
  assert.equal(scene.vectorProvider.markForFrame.mock.callCount(), 0);
  primitive.update({ ...frame, passes: { pick: true } });
  second.primitives[0].update(frame);
  assert.equal(collection.primitiveCount, 2);
  assert.equal(second.primitives[0].collection.primitiveCount, 0);
  assert.ok(scene.requestRender.mock.callCount() >= 3);
  const expression = [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    "#00ff00ff",
    "#0000ffff",
  ];
  const result = first.applyStyle(
    createRule({ ...rule, paint: { "fill-color": expression } }),
    1,
    { changedPaths: ["paint.fill-color"] },
  );
  assert.equal(result.instanceUpdates, 2);
  assert.equal(getMaterial(first).color.blue, 1);
  store.set({ sourceLayer: "land", id: 7 }, { hover: true });
  const state = first.applyFeatureState({ sourceLayer: "land", id: 7 });
  assert.equal(state.instanceUpdates, 2);
  assert.equal(getMaterial(first).color.green, 1);
  primitive.update({ ...frame, frameNumber: 2 });
  assert.equal(primitive.ready, true);
  assert.equal(collection.primitiveCount, 4);
  assert.equal(
    collection
      .get(3, new BufferPolygon())
      .getMaterial(new BufferPolygonMaterial()).color.green,
    1,
  );
  assert.equal(primitive._prepared, undefined);
  primitive.submitForFrame({ ...frame, frameNumber: 2 });
  assert.equal(scene.vectorProvider.markForFrame.mock.callCount(), 1);
  first.destroy();
  second.destroy();
  assert.equal(diagnostics.snapshot().gauges.pendingBufferPolygons, 0);
  assert.equal(diagnostics.snapshot().gauges.bufferPolygonPreparedBytes, 0);
  assert.equal(diagnostics.snapshot().gauges.residentBufferPolygons, 0);
});

test("填充中取消清理部分集合，释放准备缓冲且停止后续帧", (t) => {
  const layer = createLayer();
  layer.lines = {
    positions: new Float64Array([0, 0, 1, 0, 1, 1]),
    offsets: new Uint32Array([0, 3]),
    featureIndices: new Uint32Array([0]),
  };
  const diagnostics = new VectorTileDiagnostics(true);
  let current = true;
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const bucket = createBucket(layer, createRule(), 4, {
    featureTable: layer.features,
    diagnostics,
    isCurrent: () => current,
    bufferPolygonBudget: { frameNumber: undefined, spent: 0 },
  });
  const primitive = bucket.primitives[0];
  const add = primitive.collection.add.bind(primitive.collection);
  t.mock.method(primitive.collection, "add", (...args) => {
    clock += 5;
    return add(...args);
  });
  const destroy = t.mock.method(primitive.collection, "destroy");
  primitive.update({ frameNumber: 1 });
  assert.equal(primitive.collection.primitiveCount, 1);
  current = false;
  primitive.update({ frameNumber: 2 });
  primitive.update({ frameNumber: 3 });
  assert.equal(primitive.isDestroyed(), true);
  assert.equal(destroy.mock.callCount(), 1);
  assert.equal(diagnostics.snapshot().gauges.pendingBufferPolygons, 0);
  assert.equal(diagnostics.snapshot().gauges.bufferPolygonPreparedBytes, 0);
  assert.equal(diagnostics.snapshot().gauges.residentBufferPolygons, 0);
  bucket.destroy();
});

test("replacement 未填完保留旧桶，换代和快速取消拒绝提交旧结果", () => {
  const layer = Object.create(VectorTileLayer.prototype);
  layer._contentRevision = 1;
  layer._styleLayerStates = new Map([
    ["land", { revision: 2, rule: createRule() }],
  ]);
  layer._sharedPointCollections = { removeTileEntries() {} };
  const old = {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  };
  const tile = {
    contentRevision: 1,
    state: ImageryState.READY,
    referenceCount: 1,
    buckets: { land: old },
    primitives: { land: [] },
    bucketRebuilds: {},
  };
  const prepared = createLayer();
  const bucket = createBucket(prepared, createRule(), 4, {
    featureTable: prepared.features,
  });
  const rebuild = { revision: 2, replacementBucket: bucket };
  const primitive = bucket.primitives[0];
  tile.bucketRebuilds.land = rebuild;
  assert.equal(layer._isCurrentBucketRebuild(tile, "land", rebuild), true);
  assert.equal(bucket.primitives[0].ready, false);
  layer._warmReplacementBucket(bucket, {
    frameNumber: 1,
    mode: 3,
    passes: { render: false },
    commandList: [],
  });
  assert.equal(bucket.primitives[0].ready, true);
  assert.equal(old.destroyed, false);
  tile.bucketRebuilds.land = { revision: 3 };
  assert.equal(
    layer._commitStyleLayerBucketReplacement(tile, "land", rebuild),
    false,
  );
  assert.equal(primitive.isDestroyed(), true);
  assert.equal(tile.buckets.land, old);
  tile.bucketRebuilds.land = rebuild;
  tile.released = true;
  assert.equal(layer._isCurrentBucketRebuild(tile, "land", rebuild), false);
});

test("真实 Layer 重建链拒绝晚到结果，颜色更新沿用 Worker 几何", async (t) => {
  const pending = [];
  t.mock.method(
    VectorTileDecoder.instance(),
    "decode",
    (buffer, options) =>
      new Promise((resolve) => pending.push({ resolve, options })),
  );
  for (const scenario of ["release", "height", "color"]) {
    const document = {
      sources: { source: { type: "vector" } },
      layers: [createRule()],
    };
    const provider = {
      sourceId: "source",
      minimumLevel: 0,
      maximumLevel: 18,
      tilingScheme: {
        tileXYToRectangle: () => ({ west: 0, south: 0, east: 1, north: 1 }),
      },
      requestTile: () => ({
        promise: Promise.resolve(new ArrayBuffer(1)),
        cancel() {},
      }),
    };
    const runtime = new VectorTileLayer(provider, { styleDocument: document });
    const tile = runtime.getVectorTileFromCache(0, 0, 0);
    tile.addReference();
    tile.state = ImageryState.READY;
    const changed = {
      ...document,
      layers: [createRule({ terrain: { heightOffset: 10 } })],
    };
    runtime.setStyleLayerBucketRebuild(changed, "land", {
      changedPaths: ["terrain.heightOffset"],
    });
    await setImmediate();
    const request = pending.shift();
    assert.deepEqual(request.options.bufferPolygonRequests, [
      { sourceLayer: "land", ground: false, height: 10 },
    ]);
    if (scenario === "release") {
      runtime.clearCache();
    } else if (scenario === "height") {
      runtime.setStyleLayerBucketRebuild(
        {
          ...document,
          layers: [createRule({ terrain: { heightOffset: 20 } })],
        },
        "land",
        { changedPaths: ["terrain.heightOffset"] },
      );
    } else {
      runtime.setStyleLayerAppearance(
        {
          ...changed,
          layers: [
            { ...changed.layers[0], paint: { "fill-color": "#0000ffff" } },
          ],
        },
        "land",
        { changedPaths: ["paint.fill-color"] },
      );
    }
    const packed = createLayer();
    packed.bufferPolygons = [
      VectorTileBufferPolygonGeometry.prepareLayer(
        packed,
        request.options.bufferPolygonRequests[0],
      ),
    ];
    request.resolve({ layers: { land: packed } });
    await setImmediate();
    const replacement = tile.bucketRebuilds?.land?.replacementBucket;
    if (scenario === "color") {
      assert.ok(replacement);
      assert.equal(replacement.styleRule.paint["fill-color"], "#0000ffff");
      fillBucket(replacement);
      assert.equal(getMaterial(replacement).color.blue, 1);
      assert.equal(pending.length, 0);
    } else {
      assert.equal(replacement, undefined);
    }
    runtime.destroy();
    for (const task of pending.splice(0)) {
      task.resolve({ layers: {} });
    }
    await setImmediate();
  }
});

test("实际四叉树在子面填充完成后整体替换父覆盖", (t) => {
  const renderer = Object.create(VectorTileQuadtreePrimitive.prototype);
  renderer._tileProvider = {};
  renderer._warmupTilesPerFrame = 4;
  renderer._syncLayerPointCollections = () => {};
  const layer = { _show: true };
  const parent = {
    x: 0,
    y: 0,
    level: 0,
    primitives: {},
    addReference() {},
    releaseReference() {},
  };
  const state = {
    committedRenderSet: new Set([parent]),
    committedPointEntries: new Map(),
  };
  renderer._layerRenderStates = new Map([[layer, state]]);
  const buckets = [];
  const children = [];
  const budget = { frameNumber: 1, spent: 4 };
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const packed = createLayer();
      const bucket = createBucket(packed, createRule(), 4, {
        featureTable: packed.features,
        bufferPolygonBudget: budget,
      });
      t.mock.method(bucket.primitives[0].collection, "update", () => {});
      buckets.push(bucket);
      children.push({
        x,
        y,
        level: 1,
        vectorTileLayer: layer,
        state: ImageryState.READY,
        coverageComplete: true,
        primitives: { land: bucket.primitives },
        addReference() {},
        releaseReference() {},
      });
    }
  }
  renderer._tilesToRender = children.map((child) => ({
    data: {
      tileVectorTiles: [{ loadingVectorTile: child, readyVectorTile: child }],
    },
  }));
  const frame = {
    frameNumber: 1,
    mode: 3,
    passes: { render: true },
    commandList: [],
  };
  renderer.renderTiles(frame);
  assert.deepEqual([...state.committedRenderSet], [parent]);
  assert.ok(buckets.every((bucket) => bucket.primitives[0].ready === false));
  renderer.renderTiles({ ...frame, frameNumber: 2 });
  assert.deepEqual([...state.committedRenderSet], [parent]);
  assert.ok(buckets.every((bucket) => bucket.primitives[0].ready === true));
  renderer.renderTiles({ ...frame, frameNumber: 3 });
  assert.equal(state.committedRenderSet.has(parent), false);
  assert.equal(state.committedRenderSet.size, 4);
  for (const bucket of buckets) {
    bucket.destroy();
  }
});
