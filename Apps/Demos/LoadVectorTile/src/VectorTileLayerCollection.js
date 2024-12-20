import {
  defined,
  DeveloperError,
  defaultValue,
  destroyObject,
  Event,
} from "../../../../Build/CesiumUnminified/index.js";
import VectorTileLayer from "./VectorTileLayer.js";

export default class VectorTileLayerCollection {
  get length() {
    return this._layers.length;
  }

  constructor() {
    this._layers = [];

    this.layerAdded = new Event();

    this.layerRemoved = new Event();

    this.layerMoved = new Event();

    this.layerShownOrHidden = new Event();
  }

  add(layer, index) {
    const hasIndex = defined(index);

    //>>includeStart('debug', pragmas.debug);
    if (!defined(layer)) {
      throw new DeveloperError("layer is required.");
    }
    if (hasIndex) {
      if (index < 0) {
        throw new DeveloperError(
          "index must be greater than or equal to zero.",
        );
      } else if (index > this._layers.length) {
        throw new DeveloperError(
          "index must be less than or equal to the number of layers.",
        );
      }
    }
    //>>includeEnd('debug');

    if (!hasIndex) {
      index = this._layers.length;
      this._layers.push(layer);
    } else {
      this._layers.splice(index, 0, layer);
    }

    this._update();
    this.layerAdded.raiseEvent(layer, index);
    const removeReadyEventListener = layer.readyEvent.addEventListener(() => {
      this.layerShownOrHidden.raiseEvent(layer, layer._layerIndex, layer.show);
      removeReadyEventListener();
    });
  }

  addLayerProvider(layerProvider, index) {
    //>>includeStart('debug', pragmas.debug);
    if (!defined(layerProvider)) {
      throw new DeveloperError("vectorTileProvider is required.");
    }
    //>>includeEnd('debug');

    const layer = new VectorTileLayer(layerProvider, layerProvider._options);
    this.add(layer, index);
    return layer;
  }

  remove(layer, destroy) {
    destroy = defaultValue(destroy, true);

    const index = this._layers.indexOf(layer);
    if (index !== -1) {
      this._layers.splice(index, 1);

      this._update();

      this.layerRemoved.raiseEvent(layer, index);

      if (destroy) {
        layer.destroy();
      }

      return true;
    }

    return false;
  }

  removeAll(destroy) {
    destroy = defaultValue(destroy, true);

    const layers = this._layers;
    for (let i = 0, len = layers.length; i < len; i++) {
      const layer = layers[i];
      this.layerRemoved.raiseEvent(layer, i);

      if (destroy) {
        layer.destroy();
      }
    }

    this._layers = [];
  }

  contains(layer) {
    return this.indexOf(layer) !== -1;
  }

  indexOf(layer) {
    return this._layers.indexOf(layer);
  }

  get(index) {
    //>>includeStart('debug', pragmas.debug);
    if (!defined(index)) {
      throw new DeveloperError("index is required.", "index");
    }
    //>>includeEnd('debug');

    return this._layers[index];
  }

  isDestroyed() {
    return false;
  }

  destroy() {
    this.removeAll();
    return destroyObject(this);
  }

  _update() {
    const layers = this._layers;
    let layersShownOrHidden;
    let layer;
    let i, len;
    for (i = 0, len = layers.length; i < len; ++i) {
      layer = layers[i];
      layer._layerIndex = i;

      if (layer.show !== layer._show) {
        if (defined(layer._show)) {
          if (!defined(layersShownOrHidden)) {
            layersShownOrHidden = [];
          }
          layersShownOrHidden.push(layer);
        }
        layer._show = layer.show;
      }
    }

    if (defined(layersShownOrHidden)) {
      for (i = 0, len = layersShownOrHidden.length; i < len; ++i) {
        layer = layersShownOrHidden[i];
        this.layerShownOrHidden.raiseEvent(
          layer,
          layer._layerIndex,
          layer.show,
        );
      }
    }
  }
}
