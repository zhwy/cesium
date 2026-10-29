import Cartesian2 from "../../../../packages/core/Source/Cartesian2.js";
import Cartesian3 from "../../../../packages/core/Source/Cartesian3.js";
import Rectangle from "../../../../packages/core/Source/Rectangle.js";

const scenarios = Object.freeze({
  world: Rectangle.fromDegrees(-180.0, -80.0, 180.0, 80.0),
  regional: Rectangle.fromDegrees(-30.0, 15.0, 60.0, 75.0),
  close: Rectangle.fromDegrees(133.642031, 47.64763, 133.739338, 47.684557),
});

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function summarizeStyleUpdateDiagnostics(snapshot) {
  const counters = snapshot.counters ?? {};
  const gauges = snapshot.gauges ?? {};
  return {
    counters: {
      pbfCacheHits: counters.pbfCacheHits ?? 0,
      pbfCacheMisses: counters.pbfCacheMisses ?? 0,
      pbfRequestJoins: counters.pbfRequestJoins ?? 0,
      downloadedBytes: counters.downloadedBytes ?? 0,
      decodedFeatures: counters.decodedFeatures ?? 0,
      primitiveBuckets: counters.primitiveBuckets ?? 0,
      styleNoopUpdates: counters.styleNoopUpdates ?? 0,
      styleInPlaceUpdates: counters.styleInPlaceUpdates ?? 0,
      styleInPlaceInstanceUpdates: counters.styleInPlaceInstanceUpdates ?? 0,
      styleInPlacePointUpdates: counters.styleInPlacePointUpdates ?? 0,
      styleBucketRebuilds: counters.styleBucketRebuilds ?? 0,
      styleBucketPropertyFallbacks: counters.styleBucketPropertyFallbacks ?? 0,
      styleBucketRenderStateFallbacks:
        counters.styleBucketRenderStateFallbacks ?? 0,
      styleBucketReplacementCommits:
        counters.styleBucketReplacementCommits ?? 0,
      styleSourceRebuilds: counters.styleSourceRebuilds ?? 0,
    },
    gauges: {
      currentContentRevision: gauges.currentContentRevision ?? 0,
      residentRenderPrimitives: gauges.residentRenderPrimitives ?? 0,
      residentStyleBuckets: gauges.residentStyleBuckets ?? 0,
      residentFeatureTableEntries: gauges.residentFeatureTableEntries ?? 0,
      residentPickPropertyValues: gauges.residentPickPropertyValues ?? 0,
      offscreenResidentVectorTiles: gauges.offscreenResidentVectorTiles ?? 0,
      residentPbfCacheBytes: gauges.residentPbfCacheBytes ?? 0,
      residentPbfCacheEntries: gauges.residentPbfCacheEntries ?? 0,
    },
  };
}

function now() {
  return globalThis.performance?.now() ?? Date.now();
}

function summarizeSamples(samples) {
  if (samples.length === 0) {
    return { count: 0, averageMs: 0, p95Ms: 0, maximumMs: 0 };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    averageMs: total / sorted.length,
    p95Ms:
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    maximumMs: sorted[sorted.length - 1],
  };
}

const SOURCE_LEVEL_COUNTER = /^source:(.+):decodedTilesAtLevel(\d+)$/;

// tilesBySourceLevel: { [sourceId]: { [level]: tileCount } }
function summarizeTileLevels(tilesBySourceLevel) {
  const tilesByLevel = {};
  let tiles = 0;
  let weightedLevels = 0;
  for (const levels of Object.values(tilesBySourceLevel)) {
    for (const [level, count] of Object.entries(levels)) {
      tilesByLevel[level] = (tilesByLevel[level] ?? 0) + count;
      tiles += count;
      weightedLevels += Number(level) * count;
    }
  }
  return {
    tilesBySourceLevel,
    tilesByLevel,
    tiles,
    meanLevel: tiles > 0 ? weightedLevels / tiles : 0,
  };
}

function readPrimitiveTileLevels(counters, sourceIds) {
  const tilesBySourceLevel = Object.fromEntries(
    sourceIds.map((sourceId) => [sourceId, {}]),
  );
  for (const [name, count] of Object.entries(counters)) {
    const match = SOURCE_LEVEL_COUNTER.exec(name);
    if (match && tilesBySourceLevel[match[1]]) {
      tilesBySourceLevel[match[1]][match[2]] = count;
    }
  }
  return summarizeTileLevels(tilesBySourceLevel);
}

// 瓦片数比值落在 [0.8, 1.25] 之外时，认为两个后端的工作量不可比。
function compareWorkload(primitiveLevels, comparisonLevels, comparisonName) {
  const levels = [
    ...new Set([
      ...Object.keys(primitiveLevels.tilesByLevel),
      ...Object.keys(comparisonLevels.tilesByLevel),
    ]),
  ].sort((left, right) => Number(left) - Number(right));
  const byLevel = {};
  for (const level of levels) {
    byLevel[level] = {
      primitives: primitiveLevels.tilesByLevel[level] ?? 0,
      [comparisonName]: comparisonLevels.tilesByLevel[level] ?? 0,
    };
  }
  const tileRatio = ratio(comparisonLevels.tiles, primitiveLevels.tiles);
  return {
    tiles: {
      primitives: primitiveLevels.tiles,
      [comparisonName]: comparisonLevels.tiles,
      ratio: tileRatio,
    },
    meanLevel: {
      primitives: primitiveLevels.meanLevel,
      [comparisonName]: comparisonLevels.meanLevel,
    },
    byLevel,
    mismatch: tileRatio === undefined || tileRatio > 1.25 || tileRatio < 0.8,
  };
}

function resolveCameraView(viewer, scenarioName) {
  if (scenarioName === "current") {
    const camera = viewer.camera;
    return {
      destination: Cartesian3.clone(camera.positionWC),
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll,
      },
    };
  }
  const destination = scenarios[scenarioName];
  if (!destination) {
    throw new Error(`Unknown vector tile benchmark: ${scenarioName}`);
  }
  return { destination };
}

// 两种后端共用同一套采样：帧 CPU 耗时、帧间隔、drawCommand 数量、主线程长任务。
function createRuntimeSampler(scene) {
  const frameCpu = [];
  const frameIntervals = [];
  const commandCounts = [];
  const longTasks = [];
  let frameStart;
  let lastFrameEnd;

  const removePreUpdate = scene.preUpdate.addEventListener(() => {
    frameStart = now();
  });
  const removePostRender = scene.postRender.addEventListener(() => {
    const end = now();
    if (frameStart !== undefined) {
      frameCpu.push(end - frameStart);
    }
    if (lastFrameEnd !== undefined) {
      frameIntervals.push(end - lastFrameEnd);
    }
    lastFrameEnd = end;
    commandCounts.push(scene.frameState.commandList.length);
  });

  let observer;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push(entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    observer = undefined;
  }

  return {
    drain() {
      for (const entry of observer?.takeRecords() ?? []) {
        longTasks.push(entry.duration);
      }
      const result = {
        frameCpu: summarizeSamples(frameCpu),
        frameInterval: summarizeSamples(frameIntervals),
        averageCommands:
          commandCounts.length > 0
            ? commandCounts.reduce((sum, value) => sum + value, 0) /
              commandCounts.length
            : 0,
        longTasks: {
          supported: observer !== undefined,
          count: longTasks.length,
          totalMs: longTasks.reduce((sum, value) => sum + value, 0),
          maximumMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
        },
      };
      frameCpu.length = 0;
      frameIntervals.length = 0;
      commandCounts.length = 0;
      longTasks.length = 0;
      return result;
    },
    destroy() {
      removePreUpdate();
      removePostRender();
      observer?.disconnect();
    },
  };
}

function waitUntilSettled(
  scene,
  isSettled,
  { timeoutMs, stableFrames, minFrames },
) {
  return new Promise((resolve) => {
    const start = now();
    let frames = 0;
    let stable = 0;
    let settledAt;
    const finish = () => {
      remove();
      clearTimeout(timeout);
      resolve({
        settled: stable >= stableFrames,
        loadMs: (settledAt ?? now()) - start,
      });
    };
    const remove = scene.postRender.addEventListener(() => {
      frames++;
      if (frames >= minFrames && isSettled()) {
        stable++;
        settledAt = settledAt ?? now();
      } else {
        stable = 0;
        settledAt = undefined;
      }
      if (stable >= stableFrames) {
        finish();
      }
    });
    const timeout = setTimeout(finish, timeoutMs);
  });
}

function createNetworkRecorder(urlTemplates) {
  const prefixes = urlTemplates.map(
    (template) => new URL(template.split("{")[0], document.baseURI).href,
  );
  globalThis.performance?.setResourceTimingBufferSize?.(20000);
  globalThis.performance?.clearResourceTimings?.();
  return {
    read() {
      const entries = (
        globalThis.performance?.getEntriesByType("resource") ?? []
      ).filter((entry) =>
        prefixes.some((prefix) => entry.name.startsWith(prefix)),
      );
      // 跨域响应缺少 Timing-Allow-Origin 时 size 为 0，只有请求数可靠。
      return {
        requests: entries.length,
        transferBytes: entries.reduce(
          (sum, e) => sum + (e.transferSize || 0),
          0,
        ),
        decodedBytes: entries.reduce(
          (sum, e) => sum + (e.decodedBodySize || 0),
          0,
        ),
      };
    },
  };
}

function getHeapBytes() {
  return globalThis.performance?.memory?.usedJSHeapSize;
}

function getFillAndLineSourceIds(styleDocument) {
  const sourceIds = new Set();
  for (const layer of styleDocument?.layers ?? []) {
    if (layer.type === "fill" || layer.type === "line") {
      sourceIds.add(layer.source);
    }
  }
  return [...sourceIds].filter((sourceId) => styleDocument.sources[sourceId]);
}

function createPrimitiveBackend(manager, viewer) {
  const schedulers = () => [
    manager._networkScheduler,
    manager._decodeScheduler,
    manager._buildScheduler,
  ];

  return {
    name: "primitives",
    urlTemplates() {
      const styleDocument = manager.getStyle();
      return getFillAndLineSourceIds(styleDocument).map(
        (sourceId) => styleDocument.sources[sourceId].url,
      );
    },
    async start() {
      manager.diagnostics.reset();
      manager.clearCache();
    },
    isSettled() {
      const quadtree = manager.quadtreePrimitive;
      const queued =
        quadtree._tileLoadQueueHigh.length +
        quadtree._tileLoadQueueMedium.length +
        quadtree._tileLoadQueueLow.length;
      return (
        queued === 0 &&
        schedulers().every(
          (scheduler) => scheduler.activeTasks + scheduler.queuedTasks === 0,
        )
      );
    },
    stats() {
      const snapshot = manager.diagnostics.snapshot();
      return {
        tileLevels: readPrimitiveTileLevels(
          snapshot.counters,
          getFillAndLineSourceIds(manager.getStyle()),
        ),
        counters: {
          decodedFeatures: snapshot.counters.decodedFeatures ?? 0,
          primitiveBuckets: snapshot.counters.primitiveBuckets ?? 0,
          pbfCacheHits: snapshot.counters.pbfCacheHits ?? 0,
          pbfCacheMisses: snapshot.counters.pbfCacheMisses ?? 0,
        },
        gauges: {
          residentRenderPrimitives:
            snapshot.gauges.residentRenderPrimitives ?? 0,
          residentFeatureTableEntries:
            snapshot.gauges.residentFeatureTableEntries ?? 0,
        },
      };
    },
    async stop() {},
    // 在画面均匀网格上拾取要素，作为 hover/feature-state 修改目标。
    collectHoverTargets(count) {
      const scene = viewer.scene;
      const width = scene.canvas.clientWidth;
      const height = scene.canvas.clientHeight;
      const grid = 8;
      const targets = new Map();
      for (let gy = 1; gy < grid && targets.size < count; gy++) {
        for (let gx = 1; gx < grid && targets.size < count; gx++) {
          const feature = manager.resolvePickedFeature(
            scene.pick(
              new Cartesian2((width * gx) / grid, (height * gy) / grid),
            ),
          );
          if (feature?.id !== undefined) {
            const key = `${feature.sourceId}|${feature.sourceLayer}|${feature.id}`;
            targets.set(key, {
              source: feature.sourceId,
              sourceLayer: feature.sourceLayer,
              id: feature.id,
            });
          }
        }
      }
      return [...targets.values()];
    },
    setHover(target, on) {
      return on
        ? manager.setFeatureState(target, { hover: true })
        : manager.removeFeatureState(target, "hover");
    },
  };
}

async function runBackend(viewer, backend, cameraView, options) {
  const scene = viewer.scene;
  const sampler = createRuntimeSampler(scene);
  const network = createNetworkRecorder(backend.urlTemplates());
  const settleOptions = {
    timeoutMs: options.timeoutMs,
    stableFrames: options.stableFrames,
    minFrames: options.minFrames,
  };
  try {
    await backend.start();
    globalThis.gc?.();
    const heapBefore = getHeapBytes();
    sampler.drain();

    viewer.camera.setView(cameraView);
    const load = await waitUntilSettled(
      scene,
      () => backend.isSettled(),
      settleOptions,
    );
    const loadSamples = sampler.drain();

    await wait(options.steadyMs);
    const steadySamples = sampler.drain();
    globalThis.gc?.();
    const heapAfter = getHeapBytes();
    const networkAfterLoad = network.read();
    const backendStats = backend.stats();

    // hover 和平移在静态采样之后，且都放在统计快照之后，避免污染加载阶段的数据。
    let hover;
    let pan;
    if (options.dynamic) {
      hover = await runHoverScenario(backend, sampler, options);
      pan = await runPanScenario(
        viewer,
        backend,
        sampler,
        network,
        cameraView,
        options,
        settleOptions,
      );
    }

    return {
      settled: load.settled,
      loadMs: load.loadMs,
      load: loadSamples,
      steady: steadySamples,
      hover,
      pan,
      network: networkAfterLoad,
      heapDeltaBytes:
        heapBefore !== undefined && heapAfter !== undefined
          ? heapAfter - heapBefore
          : undefined,
      backend: backendStats,
    };
  } finally {
    sampler.destroy();
    await backend.stop();
  }
}

// 依次高亮若干要素，测量修改调用本身的耗时和期间的帧耗时。
async function runHoverScenario(backend, sampler, options) {
  const targets = backend.collectHoverTargets(options.hoverCount);
  if (targets.length === 0) {
    return { targets: 0, operations: 0 };
  }
  sampler.drain();
  const callMs = [];
  let previous;
  let applied = 0;
  for (let i = 0; i < options.hoverCount; i++) {
    const target = targets[i % targets.length];
    const start = now();
    if (previous !== undefined) {
      backend.setHover(previous, false);
    }
    if (backend.setHover(target, true) !== false) {
      applied++;
    }
    callMs.push(now() - start);
    previous = target;
    await wait(options.hoverIntervalMs);
  }
  backend.setHover(previous, false);
  await wait(options.hoverIntervalMs);
  return {
    targets: targets.length,
    operations: options.hoverCount,
    applied,
    callMs: summarizeSamples(callMs),
    ...sampler.drain(),
  };
}

// 沿相机右方向按时间往返平移一次（距离按相机高度的比例），结束后回到起点并等待稳定。
async function runPanScenario(
  viewer,
  backend,
  sampler,
  network,
  cameraView,
  options,
  settleOptions,
) {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const tilesBefore = backend.stats().tileLevels.tiles;
  const requestsBefore = network.read().requests;
  const distance =
    camera.positionCartographic.height * options.panDistanceRatio;

  sampler.drain();
  await new Promise((resolve) => {
    const start = now();
    let previousOffset = 0;
    const remove = scene.preRender.addEventListener(() => {
      const t = Math.min((now() - start) / options.panMs, 1);
      const offset = distance * (1 - Math.abs(2 * t - 1));
      camera.moveRight(offset - previousOffset);
      previousOffset = offset;
      if (t >= 1) {
        remove();
        resolve();
      }
    });
  });
  const motionSamples = sampler.drain();

  camera.setView(cameraView);
  const settle = await waitUntilSettled(
    scene,
    () => backend.isSettled(),
    settleOptions,
  );
  return {
    distanceMeters: distance,
    requests: network.read().requests - requestsBefore,
    tilesLoaded: backend.stats().tileLevels.tiles - tilesBefore,
    ...motionSamples,
    resettled: settle.settled,
    resettleMs: settle.loadMs,
    resettleWindow: sampler.drain(),
  };
}

function ratio(value, baseline) {
  return baseline > 0 && value !== undefined ? value / baseline : undefined;
}

function createVectorTileBenchmark(viewer, manager) {
  return {
    scenarios: [...Object.keys(scenarios), "current"],

    /** 在同一调度链上比较指定 fill 图层；关闭 outline 可单独观察填充成本。 */
    async compareBufferPolygons(
      layerIds,
      scenarioName = "current",
      options = {},
    ) {
      if (!manager.diagnostics.enabled) {
        throw new Error("请使用 ?diagnostics 开启诊断后运行面后端对比。");
      }
      const original = manager.getStyle();
      const ids = new Set(layerIds);
      const selected = original.layers.filter((layer) => ids.has(layer.id));
      if (
        selected.length !== ids.size ||
        selected.length === 0 ||
        selected.some((layer) => layer.type !== "fill")
      ) {
        throw new Error("layerIds 必须是已存在且非空的 fill 图层 id 数组。");
      }
      const cameraView = resolveCameraView(viewer, scenarioName);
      const runOptions = {
        timeoutMs: 60000,
        stableFrames: 10,
        minFrames: 10,
        steadyMs: 3000,
        dynamic: false,
        ...options,
      };
      const results = {};
      try {
        for (const enabled of [false, true]) {
          // 隔离相同 fill 集合，透明默认色也使用相同的可见测试色，避免测量空画面。
          for (const layer of original.layers) {
            manager.setLayerStyle(
              layer.id,
              {
                ...layer,
                visibility: ids.has(layer.id),
                ...(ids.has(layer.id)
                  ? {
                      useBufferPrimitive: enabled,
                      paint: {
                        ...layer.paint,
                        ...(options.fillColor
                          ? { "fill-color": options.fillColor }
                          : {}),
                      },
                      terrain: {
                        ...layer.terrain,
                        ...(options.heightOffset === undefined
                          ? {}
                          : { heightOffset: options.heightOffset }),
                        ...(options.clampToGround === undefined
                          ? {}
                          : { clampToGround: options.clampToGround }),
                      },
                    }
                  : {}),
              },
              false,
            );
          }
          const backend = createPrimitiveBackend(manager, viewer);
          backend.start = async () => {
            manager.diagnostics.reset();
            if (options.cold !== false) {
              manager.clearCache();
            }
          };
          const result = await runBackend(
            viewer,
            backend,
            cameraView,
            runOptions,
          );
          const snapshot = manager.diagnostics.snapshot();
          result.buffer = {
            buckets: snapshot.counters.bufferPolygonBuckets ?? 0,
            submissions: snapshot.counters.bufferPolygonSubmissions ?? 0,
            polygons: snapshot.gauges.residentBufferPolygons ?? 0,
            cpuCapacityBytes: snapshot.gauges.residentBufferPolygonBytes ?? 0,
            build: snapshot.durations.bufferPolygonBuild,
            prepare: snapshot.durations.bufferPolygonPrepare,
            workerPrepare: snapshot.durations.bufferPolygonWorkerPrepare,
            add: snapshot.durations.bufferPolygonAdd,
            ready: snapshot.durations.bufferPolygonReady,
            pending: snapshot.gauges.pendingBufferPolygons ?? 0,
            preparedBytes: snapshot.gauges.bufferPolygonPreparedBytes ?? 0,
            outline: snapshot.durations.bufferPolygonOutline,
            firstUpdate: snapshot.durations.bufferPolygonFirstUpdate,
            // 每帧窗口内同时完成的桶数及累计耗时，用于判断多个桶是否挤进同一帧。
            perFrame: {
              build: snapshot.frameWork?.bufferPolygonBuild,
              add: snapshot.frameWork?.bufferPolygonAdd,
              firstUpdate: snapshot.frameWork?.bufferPolygonFirstUpdate,
            },
          };
          results[enabled ? "buffer" : "primitives"] = result;
        }
        const workload = compareWorkload(
          results.primitives.backend.tileLevels,
          results.buffer.backend.tileLevels,
          "buffer",
        );
        return {
          ...results,
          workload,
          comparable:
            !workload.mismatch &&
            results.primitives.settled &&
            results.buffer.settled &&
            results.buffer.buffer.polygons > 0 &&
            results.buffer.buffer.submissions > 0,
          cacheMode:
            options.cold === false
              ? "保留内存 PBF 缓存；后端切换仍会重建渲染对象"
              : "清空内存 PBF 缓存；HTTP 缓存由浏览器控制",
          draping:
            "贴地初次烘焙包含在加载窗口；settled 仅表示任务队列稳定，真实烘焙完成需结合视觉结果验证",
        };
      } finally {
        for (const layer of original.layers) {
          manager.setLayerStyle(layer.id, layer, false);
        }
      }
    },

    async capture(
      scenarioName,
      { cold = false, warmupMs = 1000, sampleMs = 5000 } = {},
    ) {
      const destination = scenarios[scenarioName];
      if (!destination) {
        throw new Error(`Unknown vector tile benchmark: ${scenarioName}`);
      }
      if (!manager.diagnostics.enabled) {
        throw new Error("Enable diagnostics with ?diagnostics in the URL.");
      }

      manager.diagnostics.reset();
      if (cold) {
        manager.clearCache();
        viewer.camera.setView({ destination });
        await wait(sampleMs);
        return manager.diagnostics.snapshot();
      }

      viewer.camera.setView({ destination });
      await wait(warmupMs);
      manager.diagnostics.reset();
      await wait(sampleMs);
      return manager.diagnostics.snapshot();
    },

    async compareBackends(layer, scenarioName, options = {}) {
      const originalBackend = layer.renderBackend;
      const captureOptions = { cold: true, ...options };
      try {
        layer.setRenderBackend("instances");
        const instances = await this.capture(scenarioName, captureOptions);
        layer.setRenderBackend("packed");
        const packed = await this.capture(scenarioName, captureOptions);
        const instancesP95 = instances.durations.frameCpu?.p95Ms ?? 0;
        const packedP95 = packed.durations.frameCpu?.p95Ms ?? 0;
        const packedActivated = (packed.counters.packedLineBuckets ?? 0) > 0;
        const improvementPercent =
          instancesP95 > 0
            ? ((instancesP95 - packedP95) / instancesP95) * 100
            : 0;
        return {
          instances,
          packed,
          frameCpuP95: {
            instancesMs: instancesP95,
            packedMs: packedP95,
            improvementPercent,
            packedActivated,
            passesAdoptionThreshold:
              packedActivated && improvementPercent >= 20,
          },
        };
      } finally {
        layer.setRenderBackend(originalBackend);
      }
    },

    async measureStyleUpdate(
      layerId,
      styleUpdate,
      scenarioName,
      { warmupMs = 1000, sampleMs = 1000, merged = true } = {},
    ) {
      const destination = scenarios[scenarioName];
      if (!destination) {
        throw new Error(`Unknown vector tile benchmark: ${scenarioName}`);
      }
      if (!manager.diagnostics.enabled) {
        throw new Error("Enable diagnostics with ?diagnostics in the URL.");
      }

      viewer.camera.setView({ destination });
      await wait(warmupMs);
      const before = manager.diagnostics.snapshot();
      manager.diagnostics.reset();
      manager.setLayerStyle(layerId, styleUpdate, merged);
      await wait(sampleMs);
      const update = manager.diagnostics.snapshot();
      return {
        before: summarizeStyleUpdateDiagnostics(before),
        update: summarizeStyleUpdateDiagnostics(update),
        raw: {
          before,
          update,
        },
      };
    },
  };
}

export default createVectorTileBenchmark;
