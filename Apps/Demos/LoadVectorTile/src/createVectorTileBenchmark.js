import Cartesian2 from "../../../../packages/core/Source/Cartesian2.js";
import Cartesian3 from "../../../../packages/core/Source/Cartesian3.js";
import Cartographic from "../../../../packages/core/Source/Cartographic.js";
import Color from "../../../../packages/core/Source/Color.js";
import Rectangle from "../../../../packages/core/Source/Rectangle.js";
import WebMercatorTilingScheme from "../../../../packages/engine/Source/Core/WebMercatorTilingScheme.js";
import Cesium3DTileStyle from "../../../../packages/engine/Source/Scene/Cesium3DTileStyle.js";
import VectorGltfTilesetProvider from "./VectorGltfTilesetProvider.js";

const scenarios = Object.freeze({
  world: Rectangle.fromDegrees(-180.0, -80.0, 180.0, 80.0),
  regional: Rectangle.fromDegrees(-30.0, 15.0, 60.0, 75.0),
  close: Rectangle.fromDegrees(-12.0, 35.0, 12.0, 58.0),
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

const webMercatorTilingScheme = new WebMercatorTilingScheme();

const SOURCE_LEVEL_COUNTER = /^source:(.+):decodedTilesAtLevel(\d+)$/;
const LEVEL_COUNTER = /^decodedTilesAtLevel(\d+)$/;

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

function readTilesetTileLevels(providers, sourceIds) {
  const tilesBySourceLevel = {};
  providers.forEach((provider, index) => {
    const levels = {};
    for (const [name, count] of Object.entries(
      provider.diagnostics.snapshot().counters,
    )) {
      const match = LEVEL_COUNTER.exec(name);
      if (match) {
        levels[match[1]] = count;
      }
    }
    tilesBySourceLevel[sourceIds[index]] = levels;
  });
  return summarizeTileLevels(tilesBySourceLevel);
}

// 瓦片数比值落在 [0.8, 1.25] 之外时，认为两个后端的工作量不可比。
function compareWorkload(primitiveLevels, vectorGltfLevels) {
  const levels = [
    ...new Set([
      ...Object.keys(primitiveLevels.tilesByLevel),
      ...Object.keys(vectorGltfLevels.tilesByLevel),
    ]),
  ].sort((left, right) => Number(left) - Number(right));
  const byLevel = {};
  for (const level of levels) {
    byLevel[level] = {
      primitives: primitiveLevels.tilesByLevel[level] ?? 0,
      vectorGltf: vectorGltfLevels.tilesByLevel[level] ?? 0,
    };
  }
  const tileRatio = ratio(vectorGltfLevels.tiles, primitiveLevels.tiles);
  return {
    tiles: {
      primitives: primitiveLevels.tiles,
      vectorGltf: vectorGltfLevels.tiles,
      ratio: tileRatio,
    },
    meanLevel: {
      primitives: primitiveLevels.meanLevel,
      vectorGltf: vectorGltfLevels.meanLevel,
    },
    byLevel,
    mismatch: tileRatio === undefined || tileRatio > 1.25 || tileRatio < 0.8,
  };
}

function resolveBenchmarkExtent(viewer, scenarioName) {
  const view =
    scenarioName === "current"
      ? viewer.camera.computeViewRectangle()
      : scenarios[scenarioName];
  if (!view) {
    throw new Error(
      "当前视野包含地平线，无法确定范围，请放大到只看到地表后再对比。",
    );
  }
  const maxLatitude = webMercatorTilingScheme.rectangle.north;
  const paddingLongitude = view.width * 0.1;
  const paddingLatitude = view.height * 0.1;
  return new Rectangle(
    Math.max(-Math.PI, view.west - paddingLongitude),
    Math.max(-maxLatitude, view.south - paddingLatitude),
    Math.min(Math.PI, view.east + paddingLongitude),
    Math.min(maxLatitude, view.north + paddingLatitude),
  );
}

// 瓦片树一次性生成，按视野范围截断 maxZoom，并由 provider 限制总节点数。
function chooseMaxZoom(extent, minZoom, maxZoom, maximumTilesPerLevel) {
  let result = minZoom;
  for (let level = minZoom; level <= maxZoom; level++) {
    const northwest = webMercatorTilingScheme.positionToTileXY(
      Cartographic.fromRadians(extent.west, extent.north),
      level,
    );
    const southeast = webMercatorTilingScheme.positionToTileXY(
      Cartographic.fromRadians(extent.east, extent.south),
      level,
    );
    const tileCount =
      (Math.abs(southeast.x - northwest.x) + 1) *
      (Math.abs(southeast.y - northwest.y) + 1);
    if (tileCount > maximumTilesPerLevel) {
      break;
    }
    result = level;
  }
  return result;
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
    const remove = scene.postRender.addEventListener(() => {
      frames++;
      if (frames >= minFrames && isSettled()) {
        stable++;
        settledAt = settledAt ?? now();
      } else {
        stable = 0;
        settledAt = undefined;
      }
      const timedOut = now() - start >= timeoutMs;
      if (stable >= stableFrames || timedOut) {
        remove();
        resolve({
          settled: stable >= stableFrames,
          loadMs: (settledAt ?? now()) - start,
        });
      }
    });
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
  const savedShow = new Map();

  return {
    name: "primitives",
    urlTemplates() {
      const styleDocument = manager.getStyle();
      return getFillAndLineSourceIds(styleDocument).map(
        (sourceId) => styleDocument.sources[sourceId].url,
      );
    },
    async start() {
      for (const [layer, show] of savedShow) {
        layer.show = show;
      }
      savedShow.clear();
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
    // 供另一后端运行时隐藏本后端，隐藏图层会同时清掉已提交的点集合。
    suspend() {
      const quadtree = manager.quadtreePrimitive;
      const layers = manager.vectorTileLayers;
      for (let i = 0; i < layers.length; ++i) {
        const layer = layers.get(i);
        savedShow.set(layer, layer.show);
        layer.show = false;
      }
      const hadOwnUpdate = Object.hasOwn(quadtree, "update");
      const originalUpdate = quadtree.update;
      quadtree.update = () => {};
      return () => {
        if (hadOwnUpdate) {
          quadtree.update = originalUpdate;
        } else {
          delete quadtree.update;
        }
        for (const [layer, show] of savedShow) {
          layer.show = show;
        }
        savedShow.clear();
      };
    },
  };
}

function createVectorGltfBackend(viewer, manager, options) {
  const scene = viewer.scene;
  const primitiveBackend = createPrimitiveBackend(manager, viewer);
  let providers = [];
  const sourceIds = [];
  const maxZooms = [];
  const hoverColors = new Map();
  let resume;

  const tilesets = () =>
    providers.map((provider) => provider.tileset).filter(Boolean);

  return {
    name: "vectorGltf",
    urlTemplates: () => primitiveBackend.urlTemplates(),
    async start() {
      resume = primitiveBackend.suspend();
      const styleDocument = manager.getStyle();
      for (const sourceId of getFillAndLineSourceIds(styleDocument)) {
        const source = styleDocument.sources[sourceId];
        const maxZoom = chooseMaxZoom(
          options.extent,
          source.minimumLevel ?? 0,
          source.maximumLevel ?? 14,
          options.maximumTilesPerLevel,
        );
        maxZooms.push(maxZoom);
        sourceIds.push(sourceId);
        const provider = await VectorGltfTilesetProvider.fromUrl(source.url, {
          ...source,
          rules: styleDocument.layers.filter(
            (rule) => rule.source === sourceId,
          ),
          maximumNodes: options.maximumNodes,
          minZoom: source.minimumLevel,
          maxZoom: maxZoom,
          extent: options.extent,
          heightReference: options.heightReference,
          scene: options.heightReference === undefined ? undefined : scene,
        });
        const tileset = provider.tileset;
        tileset.maximumScreenSpaceError = options.maximumScreenSpaceError;
        if (options.cacheBytes !== undefined) {
          tileset.cacheBytes = options.cacheBytes;
        }
        tileset.style = new Cesium3DTileStyle(options.style);
        scene.primitives.add(provider);
        providers.push(provider);
      }
    },
    isSettled() {
      return tilesets().every(
        (tileset) =>
          tileset.tilesLoaded &&
          tileset.statistics.numberOfPendingRequests === 0 &&
          tileset.statistics.numberOfTilesProcessing === 0,
      );
    },
    stats() {
      const total = {
        tilesWithContentReady: 0,
        featuresLoaded: 0,
        geometryByteLength: 0,
        trianglesSelected: 0,
        commands: 0,
      };
      for (const { statistics } of tilesets()) {
        total.tilesWithContentReady += statistics.numberOfTilesWithContentReady;
        total.featuresLoaded += statistics.numberOfFeaturesLoaded;
        total.geometryByteLength += statistics.geometryByteLength;
        total.trianglesSelected += statistics.numberOfTrianglesSelected;
        total.commands += statistics.numberOfCommands;
      }
      return {
        sources: providers.length,
        maxZooms: [...maxZooms],
        styleZoom: "tileLevel",
        buildThread: "main",
        tileLevels: readTilesetTileLevels(providers, sourceIds),
        diagnostics: providers.map((provider) =>
          provider.diagnostics.snapshot(),
        ),
        ...total,
      };
    },
    // 从当前选中的瓦片里逐瓦片轮流取要素；贴地后线面不再产生拾取命令，所以不能用 scene.pick。
    collectHoverTargets(count) {
      const featuresByTile = [];
      for (const tileset of tilesets()) {
        for (const tile of tileset._selectedTiles) {
          const tables = tile.content?._featuresByTableId;
          if (!tables) {
            continue;
          }
          const features = [];
          for (const table of tables.values()) {
            features.push(...table.values());
          }
          if (features.length > 0) {
            featuresByTile.push(features);
          }
        }
      }
      const targets = [];
      for (let round = 0; targets.length < count; round++) {
        let added = false;
        for (const features of featuresByTile) {
          if (round < features.length && targets.length < count) {
            targets.push(features[round]);
            added = true;
          }
        }
        if (!added) {
          break;
        }
      }
      return targets;
    },
    setHover(feature, on) {
      if (on) {
        hoverColors.set(feature, Color.clone(feature.color));
        feature.color = Color.YELLOW;
        return true;
      }
      const original = hoverColors.get(feature);
      if (original !== undefined) {
        feature.color = original;
      }
      hoverColors.delete(feature);
      return true;
    },
    async stop() {
      for (const provider of providers) {
        scene.primitives.remove(provider);
      }
      providers = [];
      sourceIds.length = 0;
      maxZooms.length = 0;
      hoverColors.clear();
      resume?.();
      resume = undefined;
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

    /**
     * 在相同相机和相同数据源（仅 fill/line 样式引用的 source）上，冷启动对比：
     * - `primitives`：当前四叉树 + Worker 解码 + Primitive 后端；
     * - `vectorGltf`：demo provider（3D Tiles + vector glTF + Buffer 集合）后端。
     *
     * 点要素（symbol/circle）不在对比范围内，两种后端都不计入。
     *
     * @param {string} [scenarioName="current"] `current` 使用调用时的相机，其余使用内置场景。
     * @param {object} [options]
     * @param {number} [options.maximumScreenSpaceError=2] vectorGltf 后端的 SSE，默认值与四叉树对齐。
     * @param {object} [options.style] vectorGltf 后端使用的 `Cesium3DTileStyle` 定义。
     * @param {number} [options.cacheBytes] vectorGltf tileset 缓存预算。
     * @param {number} [options.heightReference] 传给 tileset，需要贴地时设置。
     * @param {number} [options.maximumNodes=50000] vectorGltf 瓦片树的总节点上限。
     * @param {boolean} [options.primeHttpCache=true] 先预热一次，避免后运行的后端独占浏览器 HTTP 缓存。
     * @param {number} [options.steadyMs=3000] 加载稳定后的静态渲染采样时长。
     * @param {number} [options.timeoutMs=60000] 单个后端的加载超时。
     * @param {number} [options.maximumTilesPerLevel=1500] vectorGltf 的瓦片树是一次性生成的，
     *   这里限制视野范围内单层的瓦片数，据此截断 maxZoom，避免生成海量节点卡死页面。
     * @param {boolean} [options.dynamic=true] 稳定后是否继续运行 hover 修改和相机平移场景。
     * @param {number} [options.panMs=5000] 平移往返总时长。
     * @param {number} [options.panDistanceRatio=0.5] 单程平移距离占相机高度的比例。
     * @param {number} [options.hoverCount=10] hover 高亮次数。
     * @param {number} [options.hoverIntervalMs=250] 相邻两次 hover 的间隔。
     */
    async compareWithVectorGltf(scenarioName = "current", options = {}) {
      options = {
        maximumScreenSpaceError: 2,
        style: { color: "color('#3388ff', 0.5)" },
        primeHttpCache: true,
        steadyMs: 3000,
        timeoutMs: 60000,
        stableFrames: 10,
        minFrames: 10,
        maximumTilesPerLevel: 1500,
        dynamic: true,
        panMs: 5000,
        panDistanceRatio: 0.5,
        hoverCount: 10,
        hoverIntervalMs: 250,
        ...options,
      };
      const cameraView = resolveCameraView(viewer, scenarioName);
      options.extent = resolveBenchmarkExtent(viewer, scenarioName);
      const primitiveBackend = createPrimitiveBackend(manager, viewer);
      const vectorGltfBackend = createVectorGltfBackend(
        viewer,
        manager,
        options,
      );
      if (primitiveBackend.urlTemplates().length === 0) {
        throw new Error("当前样式中没有引用 fill/line 的 source。");
      }

      if (options.primeHttpCache) {
        await runBackend(viewer, primitiveBackend, cameraView, {
          ...options,
          steadyMs: 0,
          dynamic: false,
        });
      }
      const primitives = await runBackend(
        viewer,
        primitiveBackend,
        cameraView,
        options,
      );
      const vectorGltf = await runBackend(
        viewer,
        vectorGltfBackend,
        cameraView,
        options,
      );
      const workload = compareWorkload(
        primitives.backend.tileLevels,
        vectorGltf.backend.tileLevels,
      );

      return {
        scenario: scenarioName,
        options: {
          maximumScreenSpaceError: options.maximumScreenSpaceError,
          primeHttpCache: options.primeHttpCache,
          heightReference: options.heightReference,
          dynamic: options.dynamic,
        },
        // mismatch 为 true 时，加载耗时等比值不可直接解读，先用 sweepVectorGltfSse 对齐瓦片数。
        workload,
        primitives,
        vectorGltf,
        // 比值 < 1 表示 vectorGltf 更好（耗时、内存、命令数越小越好）。
        ratios: {
          loadMs: ratio(vectorGltf.loadMs, primitives.loadMs),
          loadMsPerTile: ratio(
            vectorGltf.loadMs / workload.tiles.vectorGltf,
            primitives.loadMs / workload.tiles.primitives,
          ),
          loadFrameCpuP95: ratio(
            vectorGltf.load.frameCpu.p95Ms,
            primitives.load.frameCpu.p95Ms,
          ),
          loadLongTaskTotal: ratio(
            vectorGltf.load.longTasks.totalMs,
            primitives.load.longTasks.totalMs,
          ),
          steadyFrameCpuAverage: ratio(
            vectorGltf.steady.frameCpu.averageMs,
            primitives.steady.frameCpu.averageMs,
          ),
          steadyCommands: ratio(
            vectorGltf.steady.averageCommands,
            primitives.steady.averageCommands,
          ),
          heapDelta: ratio(
            vectorGltf.heapDeltaBytes,
            primitives.heapDeltaBytes,
          ),
          ...(options.dynamic
            ? {
                hoverCallAverage: ratio(
                  vectorGltf.hover?.callMs?.averageMs,
                  primitives.hover?.callMs?.averageMs,
                ),
                hoverFrameCpuMaximum: ratio(
                  vectorGltf.hover?.frameCpu?.maximumMs,
                  primitives.hover?.frameCpu?.maximumMs,
                ),
                panFrameCpuP95: ratio(
                  vectorGltf.pan.frameCpu.p95Ms,
                  primitives.pan.frameCpu.p95Ms,
                ),
                panFrameCpuMaximum: ratio(
                  vectorGltf.pan.frameCpu.maximumMs,
                  primitives.pan.frameCpu.maximumMs,
                ),
                panLongTaskTotal: ratio(
                  vectorGltf.pan.longTasks.totalMs,
                  primitives.pan.longTasks.totalMs,
                ),
                panRequests: ratio(
                  vectorGltf.pan.requests,
                  primitives.pan.requests,
                ),
              }
            : {}),
        },
      };
    },

    /**
     * 用一组 `maximumScreenSpaceError` 重复运行 vectorGltf，与 primitives 的瓦片数/层级分布对齐，
     * 找出让两边工作量最接近的 SSE（按瓦片数比值的对数距离选择）。默认不跑动态场景。
     *
     * @param {string} [scenarioName="current"]
     * @param {object} [options] 同 `compareWithVectorGltf`，另有：
     * @param {number[]} [options.sseValues=[2, 4, 8, 16]] 待测的 SSE。
     */
    async sweepVectorGltfSse(scenarioName = "current", options = {}) {
      options = {
        sseValues: [2, 4, 8, 16],
        style: { color: "color('#3388ff', 0.5)" },
        primeHttpCache: true,
        steadyMs: 2000,
        timeoutMs: 60000,
        stableFrames: 10,
        minFrames: 10,
        maximumTilesPerLevel: 1500,
        dynamic: false,
        panMs: 5000,
        panDistanceRatio: 0.5,
        hoverCount: 10,
        hoverIntervalMs: 250,
        ...options,
      };
      const cameraView = resolveCameraView(viewer, scenarioName);
      options.extent = resolveBenchmarkExtent(viewer, scenarioName);
      const primitiveBackend = createPrimitiveBackend(manager, viewer);
      if (primitiveBackend.urlTemplates().length === 0) {
        throw new Error("当前样式中没有引用 fill/line 的 source。");
      }

      if (options.primeHttpCache) {
        await runBackend(viewer, primitiveBackend, cameraView, {
          ...options,
          steadyMs: 0,
          dynamic: false,
        });
      }
      const baseline = await runBackend(
        viewer,
        primitiveBackend,
        cameraView,
        options,
      );

      const rows = [];
      for (const sse of options.sseValues) {
        const runOptions = { ...options, maximumScreenSpaceError: sse };
        const result = await runBackend(
          viewer,
          createVectorGltfBackend(viewer, manager, runOptions),
          cameraView,
          runOptions,
        );
        const workload = compareWorkload(
          baseline.backend.tileLevels,
          result.backend.tileLevels,
        );
        rows.push({
          maximumScreenSpaceError: sse,
          settled: result.settled,
          tiles: workload.tiles.vectorGltf,
          tileRatio: workload.tiles.ratio,
          meanLevel: workload.meanLevel.vectorGltf,
          byLevel: workload.byLevel,
          loadMs: result.loadMs,
          loadMsPerTile: result.loadMs / workload.tiles.vectorGltf,
          loadFrameCpuP95Ms: result.load.frameCpu.p95Ms,
          loadFrameCpuMaximumMs: result.load.frameCpu.maximumMs,
          loadLongTaskTotalMs: result.load.longTasks.totalMs,
          steadyFrameCpuAverageMs: result.steady.frameCpu.averageMs,
          steadyCommands: result.steady.averageCommands,
        });
      }

      const candidates = rows.filter((row) => row.tileRatio > 0);
      const recommended = candidates.reduce(
        (best, row) =>
          best === undefined ||
          Math.abs(Math.log(row.tileRatio)) < Math.abs(Math.log(best.tileRatio))
            ? row
            : best,
        undefined,
      );
      return {
        scenario: scenarioName,
        baseline: {
          tiles: baseline.backend.tileLevels.tiles,
          meanLevel: baseline.backend.tileLevels.meanLevel,
          tilesByLevel: baseline.backend.tileLevels.tilesByLevel,
          loadMs: baseline.loadMs,
          loadMsPerTile: baseline.loadMs / baseline.backend.tileLevels.tiles,
          loadFrameCpuP95Ms: baseline.load.frameCpu.p95Ms,
          steadyFrameCpuAverageMs: baseline.steady.frameCpu.averageMs,
          steadyCommands: baseline.steady.averageCommands,
        },
        rows,
        recommendedMaximumScreenSpaceError:
          recommended?.maximumScreenSpaceError,
      };
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
