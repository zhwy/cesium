import * as Cesium from "../../../../Build/CesiumUnminified/index.js";

export default class VectorTileQuadtreePrimitive extends Cesium.QuadtreePrimitive {
  get visualizers() {
    return this._visualizers;
  }

  constructor(options) {
    super(options);
    this._visualizers = [];
  }

  /**
   * 绑定渲染图层
   * @param {*} visualizer
   */
  addVisualizer(visualizer) {
    this._visualizers.push(visualizer);
  }

  removeVisualizer(visualizer) {
    const index = this._visualizers.indexOf(visualizer);
    if (index !== -1) {
      this._visualizers.splice(index, 1);
    }
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
    this._visualizers.forEach((visualizer) => {
      if (visualizer && visualizer.visible) {
        // 图层显隐
        try {
          visualizer.renderTiles(this, frameState);
        } catch (e) {
          console.error(e);
        }
      }
    });
  }
}
