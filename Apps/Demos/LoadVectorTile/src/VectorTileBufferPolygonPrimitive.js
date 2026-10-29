import Color from "../../../../packages/core/Source/Color.js";
import DeveloperError from "../../../../packages/core/Source/DeveloperError.js";
import BufferPolygon from "../../../../packages/engine/Source/Scene/BufferPolygon.js";
import BufferPolygonMaterial from "../../../../packages/engine/Source/Scene/BufferPolygonMaterial.js";
import HeightReference from "../../../../packages/engine/Source/Scene/HeightReference.js";

/** 适配现有瓦片提交接口；贴地注册与普通 update 分开，避免隐藏预热误提交。 */
class VectorTileBufferPolygonPrimitive {
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
    this._vectorProvider = undefined;
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
    this.collection.show = this.show;
    this.collection.update(frameState);
    this.ready = true;
  }

  submitForFrame(frameState) {
    if (!this.show || this._destroyed) {
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
    const polygon = this.collection.get(index, this._polygon);
    polygon.getMaterial(this._material);
    Color.clone(color, this._material.color);
    polygon.setMaterial(this._material);
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._vectorProvider?.remove(this.collection);
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
}

export default VectorTileBufferPolygonPrimitive;
