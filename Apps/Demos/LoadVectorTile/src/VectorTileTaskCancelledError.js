/**
 * 表示矢量瓦片任务被主动取消时抛出的错误类型。
 *
 * @param {string} [message="Vector tile task cancelled."] 错误消息。
 */
class VectorTileTaskCancelledError extends Error {
  constructor(message = "Vector tile task cancelled.") {
    super(message);
    this.name = "VectorTileTaskCancelledError";
  }
}

export default VectorTileTaskCancelledError;
