import TaskProcessor from "../../../../packages/engine/Source/Core/TaskProcessor.js";

let instance;

/**
 * 统一管理矢量瓦片解码任务，使用 Cesium `TaskProcessor` 风格封装 Worker，
 * Worker 由当前 demo 的 build-worker.mjs 从源码打包。
 */
class VectorTileDecoder {
  constructor() {
    this._taskProcessor = undefined;
  }

  decode(arrayBuffer, options) {
    return this._getTaskProcessor().scheduleTask(
      {
        arrayBuffer,
        ...options,
      },
      [arrayBuffer],
    );
  }

  _getTaskProcessor() {
    if (!this._taskProcessor) {
      this._taskProcessor = new TaskProcessor(
        new URL(
          "../../../../Build/LoadVectorTile/createDecodeVectorTileTask.js",
          import.meta.url,
        ).href,
      );
    }
    return this._taskProcessor;
  }

  static instance() {
    if (!instance) {
      instance = new VectorTileDecoder();
    }
    return instance;
  }
}

export default VectorTileDecoder;
