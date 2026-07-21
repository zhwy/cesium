import VectorTileTaskCancelledError from "./VectorTileTaskCancelledError.js";

/**
 * 控制异步任务的并发数、优先级与取消行为，供下载、解码和构建阶段复用。
 *
 * @param {number} [maximumActiveTasks=1] 允许同时执行的最大任务数。
 */
class VectorTileTaskScheduler {
  constructor(maximumActiveTasks = 1) {
    this.maximumActiveTasks = Math.max(1, maximumActiveTasks);
    this._activeTasks = 0;
    this._nextTaskId = 0;
    this._queue = [];
  }

  get activeTasks() {
    return this._activeTasks;
  }

  get queuedTasks() {
    return this._queue.length;
  }

  schedule(run, priority = 0) {
    const task = {
      id: this._nextTaskId++,
      run,
      priority,
      state: "queued",
      cancelled: false,
      cancelCallbacks: [],
      settled: false,
    };
    task.promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });

    const handle = {
      promise: task.promise,
      cancel: () => this._cancel(task),
      setPriority: (value) => {
        task.priority = Number.isFinite(value) ? value : 0;
        if (task.state === "queued") {
          this._sortQueue();
        }
      },
      get cancelled() {
        return task.cancelled;
      },
    };

    this._queue.push(task);
    this._sortQueue();
    this._drain();
    return handle;
  }

  _sortQueue() {
    this._queue.sort(
      (left, right) => left.priority - right.priority || left.id - right.id,
    );
  }

  _cancel(task) {
    if (task.cancelled || task.state === "finished") {
      return;
    }

    task.cancelled = true;
    if (!task.settled) {
      task.settled = true;
      task.reject(new VectorTileTaskCancelledError());
    }
    for (let i = 0; i < task.cancelCallbacks.length; ++i) {
      task.cancelCallbacks[i]();
    }

    if (task.state === "queued") {
      const index = this._queue.indexOf(task);
      if (index !== -1) {
        this._queue.splice(index, 1);
      }
      task.state = "finished";
      this._drain();
    }
  }

  _drain() {
    while (
      this._activeTasks < this.maximumActiveTasks &&
      this._queue.length > 0
    ) {
      const task = this._queue.shift();
      if (task.cancelled) {
        continue;
      }
      this._run(task);
    }
  }

  _run(task) {
    task.state = "active";
    this._activeTasks++;
    const context = {
      get cancelled() {
        return task.cancelled;
      },
      onCancel: (callback) => {
        if (task.cancelled) {
          callback();
        } else {
          task.cancelCallbacks.push(callback);
        }
      },
    };

    Promise.resolve()
      .then(() => (task.cancelled ? undefined : task.run(context)))
      .then(
        (result) => {
          if (!task.cancelled && !task.settled) {
            task.settled = true;
            task.resolve(result);
          }
        },
        (error) => {
          if (!task.cancelled && !task.settled) {
            task.settled = true;
            task.reject(error);
          }
        },
      )
      .finally(() => {
        task.state = "finished";
        task.cancelCallbacks.length = 0;
        this._activeTasks--;
        this._drain();
      });
  }
}

export default VectorTileTaskScheduler;
