import * as Cesium from "../../../../Build/CesiumUnminified/index.js";

export default class VectorTileQuadtreePrimitive extends Cesium.QuadtreePrimitive {
  get visualizer() {
    return this._visualizer;
  }

  constructor(options) {
    super(options);
    this._visualizer = null;
  }

  update(frameState) {
    if (frameState.passes.pick === true) {
      this.renderTiles(frameState);
    } else {
      this.beginFrame(frameState);
      this.render(frameState);
      this.endFrame(frameState);
    }
  }

  render(frameState) {
    super.render(frameState);
    if (frameState.passes.render) {
      this.renderTiles(frameState);
    }
  }

  renderTiles(frameState) {
    if (this._visualizer) {
      this._visualizer.renderTiles(this._tilesToRender, frameState);
    }
  }
}
