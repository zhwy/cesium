let instance;

/**
 * 统一管理矢量瓦片解码 Worker，将主线程请求分发到后台线程并收集结果。
 */
export default class VectorTileDecoder {
  constructor() {
    this._worker = undefined;
    this._nextRequestId = 0;
    this._pendingRequests = new Map();
  }

  decode(arrayBuffer, options) {
    const worker = this._getWorker();
    const id = this._nextRequestId++;
    const promise = new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
    });
    worker.postMessage({ id, arrayBuffer, ...options }, [arrayBuffer]);
    return promise;
  }

  _getWorker() {
    if (!this._worker) {
      this._worker = new Worker(
        new URL("./VectorTileDecodeWorker.js", import.meta.url),
        { type: "module" },
      );
      this._worker.onmessage = (event) => {
        const { id, result, error } = event.data;
        const request = this._pendingRequests.get(id);
        if (!request) {
          return;
        }
        this._pendingRequests.delete(id);
        if (error) {
          request.reject(new Error(error));
        } else {
          request.resolve(result);
        }
      };
      this._worker.onerror = (event) => {
        const error = new Error(event.message || "Vector tile worker failed.");
        this._pendingRequests.forEach((request) => request.reject(error));
        this._pendingRequests.clear();
        this._worker?.terminate();
        this._worker = undefined;
      };
    }
    return this._worker;
  }

  static instance() {
    if (!instance) {
      instance = new VectorTileDecoder();
    }
    return instance;
  }
}
