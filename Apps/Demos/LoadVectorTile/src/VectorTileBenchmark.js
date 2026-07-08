import * as Cesium from "../../../../Build/CesiumUnminified/index.js";

const scenarios = Object.freeze({
  world: Cesium.Rectangle.fromDegrees(-180.0, -80.0, 180.0, 80.0),
  regional: Cesium.Rectangle.fromDegrees(-30.0, 15.0, 60.0, 75.0),
  close: Cesium.Rectangle.fromDegrees(-12.0, 35.0, 12.0, 58.0),
});

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export default function createVectorTileBenchmark(viewer, manager) {
  return {
    scenarios: Object.keys(scenarios),

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
  };
}
