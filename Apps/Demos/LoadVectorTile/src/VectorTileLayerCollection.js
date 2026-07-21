import defined from "../../../../packages/engine/Source/Core/defined.js";
import destroyObject from "../../../../packages/engine/Source/Core/destroyObject.js";
import DeveloperError from "../../../../packages/engine/Source/Core/DeveloperError.js";
import Event from "../../../../packages/engine/Source/Core/Event.js";
import VectorTileLayer from "./VectorTileLayer.js";

/**
 * 维护 `VectorTileLayer` 的有序集合，并向外转发图层增删改与显隐事件。
 */
class VectorTileLayerCollection {
  get length() {
    return this._layers.length;
  }

  constructor() {
    this._layers = [];

    this.layerAdded = new Event();

    this.layerRemoved = new Event();

    this.layerMoved = new Event();

    this.layerShownOrHidden = new Event();

    this.layerChanged = new Event();
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
    layer._removeCollectionShowListener =
      layer.showChangedEvent.addEventListener((changedLayer, show) => {
        this.layerShownOrHidden.raiseEvent(
          changedLayer,
          changedLayer._layerIndex,
          show,
        );
      });
    layer._removeCollectionChangedListener =
      layer.changedEvent.addEventListener((changedLayer) => {
        this.layerChanged.raiseEvent(changedLayer, changedLayer._layerIndex);
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
    destroy = destroy ?? true;

    const index = this._layers.indexOf(layer);
    if (index !== -1) {
      this._layers.splice(index, 1);

      this._update();

      this.layerRemoved.raiseEvent(layer, index);
      this._removeLayerListeners(layer);

      if (destroy) {
        layer.destroy();
      }

      return true;
    }

    return false;
  }

  removeAll(destroy) {
    destroy = destroy ?? true;

    const layers = this._layers;
    for (let i = 0, len = layers.length; i < len; i++) {
      const layer = layers[i];
      this.layerRemoved.raiseEvent(layer, i);
      this._removeLayerListeners(layer);

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
    for (let i = 0, len = layers.length; i < len; ++i) {
      const layer = layers[i];
      layer._layerIndex = i;
    }
  }

  _removeLayerListeners(layer) {
    layer._removeCollectionShowListener?.();
    layer._removeCollectionChangedListener?.();
    layer._removeCollectionShowListener = undefined;
    layer._removeCollectionChangedListener = undefined;
  }
}

export default VectorTileLayerCollection;
