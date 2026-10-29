import Color from "../../../../packages/core/Source/Color.js";
import DeveloperError from "../../../../packages/core/Source/DeveloperError.js";
import BufferPolygon from "../../../../packages/engine/Source/Scene/BufferPolygon.js";
import BufferPolygonMaterial from "../../../../packages/engine/Source/Scene/BufferPolygonMaterial.js";
import HeightReference from "../../../../packages/engine/Source/Scene/HeightReference.js";

// 所有面对象共享的单帧填充预算，避免多个瓦片同帧叠加成长任务。
const FILL_BUDGET_MS = 4;

/**
 * 适配现有瓦片提交接口。
 * - 要素在 `update()` 里按帧预算分批写入集合，写完才 `ready`；
 * - 贴地集合只在 `submitForFrame()` 里登记到 VectorProvider，隐藏预热不会误提交。
 */
class VectorTileBufferPolygonPrimitive {
  get filling() {
    return this._prepared !== undefined;
  }

  constructor(collection, options = {}) {
    this.collection = collection;
    this.show = true;
    this.ready = false;
    this._scene = options.scene;
    this._ground = options.ground ?? false;
    this._diagnostics = options.diagnostics;
    this._polygon = new BufferPolygon();
    this._material = new BufferPolygonMaterial();
    this._destroyed = false;
    this._firstUpdateDone = false;
    this._vectorProvider = undefined;
    this._prepared = options.prepared;
    this._indices = options.indices;
    this._next = 0;
    this._getColor = options.getColor;
    this._allowPicking = options.allowPicking;
    this._isCurrent = options.isCurrent;
    this._budget = options.budget ?? { frameNumber: undefined, spent: 0 };
    this._buildStarted = this._diagnostics?.startTimer?.();
    if (this._prepared) {
      this._diagnostics?.retainBufferPolygonGeometry?.(this._prepared);
      this._diagnostics?.addGauge(
        "pendingBufferPolygons",
        this._indices.length,
      );
    }
    this._diagnostics?.addGauge(
      "residentBufferPolygonBytes",
      collection.byteLength,
    );
    this._diagnostics?.addGauge(
      "residentBufferPolygons",
      collection.primitiveCount,
    );
  }

  update(frameState) {
    if (!this.show || this._destroyed) {
      return;
    }
    if (!this.ready && this._isCurrent?.() === false) {
      this._diagnostics?.increment("cancelledBufferPolygonBuilds");
      this.destroy();
      return;
    }
    if (this.filling && !this._fill(frameState)) {
      return;
    }
    this.collection.show = this.show;
    this._updateCollection(frameState);
  }

  submitForFrame(frameState) {
    if (!this.show || this._destroyed || !this.ready) {
      return;
    }
    this._diagnostics?.increment("bufferPolygonSubmissions");
    if (!this._ground) {
      return;
    }
    const provider = this._scene?.vectorProvider;
    if (!provider) {
      throw new DeveloperError("BufferPolygon 贴地需要 scene.vectorProvider。");
    }
    if (this._vectorProvider && this._vectorProvider !== provider) {
      this._vectorProvider.remove(this.collection);
    }
    this._vectorProvider = provider;
    provider.markForFrame(
      this.collection,
      frameState.frameNumber,
      HeightReference.CLAMP_TO_GROUND,
    );
  }

  setColor(index, color) {
    if (index >= this.collection.primitiveCount) {
      return false;
    }
    const polygon = this.collection.get(index, this._polygon);
    polygon.getMaterial(this._material);
    Color.clone(color, this._material.color);
    polygon.setMaterial(this._material);
    return true;
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._vectorProvider?.remove(this.collection);
    if (this.filling) {
      this._diagnostics?.addGauge(
        "pendingBufferPolygons",
        -(this._indices.length - this._next),
      );
      this._releasePrepared();
    }
    this._diagnostics?.addGauge(
      "residentBufferPolygonBytes",
      -this.collection.byteLength,
    );
    this._diagnostics?.addGauge(
      "residentBufferPolygons",
      -this.collection.primitiveCount,
    );
    this.collection.destroy();
    this._destroyed = true;
    this.ready = false;
  }

  /** 在共享预算内继续写入要素；全部写完返回 true。 */
  _fill(frameState) {
    const budget = this._budget;
    if (budget.frameNumber !== frameState.frameNumber) {
      budget.frameNumber = frameState.frameNumber;
      budget.spent = 0;
    }
    const first = this._next;
    const started = performance.now();
    while (budget.spent < FILL_BUDGET_MS && this._next < this._indices.length) {
      const addStarted = performance.now();
      this._addNext();
      budget.spent += performance.now() - addStarted;
    }
    this._recordFill(this._next - first, performance.now() - started);
    if (this._next < this._indices.length) {
      this._scene?.requestRender?.();
      return false;
    }
    this._releasePrepared();
    return true;
  }

  _addNext() {
    const id = this._next;
    const index = this._indices[id];
    const group = this._prepared;
    Color.clone(this._getColor(id), this._material.color);
    this.collection.add(
      {
        positions: group.positions.subarray(
          group.vertexOffsets[index] * 3,
          group.vertexOffsets[index + 1] * 3,
        ),
        holes: group.holes.subarray(
          group.holeOffsets[index],
          group.holeOffsets[index + 1],
        ),
        triangles: group.triangles?.subarray(
          group.triangleOffsets[index],
          group.triangleOffsets[index + 1],
        ),
        material: this._material,
        pickObject: this._allowPicking ? { primitive: this, id } : undefined,
      },
      this._polygon,
    );
    this._next = id + 1;
  }

  _recordFill(count, elapsed) {
    if (count === 0) {
      return;
    }
    const diagnostics = this._diagnostics;
    diagnostics?.recordSample?.("bufferPolygonAdd", elapsed);
    diagnostics?.addFrameWork?.("bufferPolygonAdd", elapsed, count);
    diagnostics?.addGauge("pendingBufferPolygons", -count);
    diagnostics?.addGauge("residentBufferPolygons", count);
    diagnostics?.increment("createdBufferPolygons", count);
  }

  _releasePrepared() {
    this._diagnostics?.releaseBufferPolygonGeometry?.(this._prepared);
    this._prepared = undefined;
    this._indices = undefined;
    this._getColor = undefined;
  }

  /** 首次 update 才创建并上传 GPU 缓冲，单独计时以区分上传与逐要素构建成本。 */
  _updateCollection(frameState) {
    const diagnostics = this._diagnostics;
    const firstUpdate = !this._firstUpdateDone;
    const started = firstUpdate ? diagnostics?.startTimer?.() : undefined;
    this.collection.update(frameState);
    this.ready = true;
    if (!firstUpdate) {
      return;
    }
    this._firstUpdateDone = true;
    const elapsed = diagnostics?.recordDuration?.(
      "bufferPolygonFirstUpdate",
      started,
    );
    diagnostics?.addFrameWork?.("bufferPolygonFirstUpdate", elapsed ?? 0);
    diagnostics?.recordDuration?.("bufferPolygonReady", this._buildStarted);
    // 预热发生在 coverage 选择之后，按需渲染还需要下一帧完成提交。
    this._scene?.requestRender?.();
  }
}

export default VectorTileBufferPolygonPrimitive;
