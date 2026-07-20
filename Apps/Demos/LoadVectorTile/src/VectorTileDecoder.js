import { TaskProcessor } from "../../../../Build/CesiumUnminified/index.js";

let instance;

/**
 * 统一管理矢量瓦片解码任务，使用 Cesium `TaskProcessor` 风格封装 Worker，
 * 但仍复用当前 demo 目录下的 Worker 文件。
 */
export default class VectorTileDecoder {
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
        new URL("./src/createDecodeVectorTileTask.js", location.href).href,
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
