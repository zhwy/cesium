import * as CesiumModule from "../../../../Build/CesiumUnminified/index.js";

const Cesium = globalThis.Cesium ?? CesiumModule;

export default class SharedPointCollections {
  constructor(options = {}) {
    this._scene = options.scene;
    this._diagnostics = options.diagnostics;
    this._billboards = undefined;
    this._labels = undefined;
    this._tileEntries = new Map();
  }

  get scene() {
    return this._scene;
  }

  setScene(scene) {
    if (this._scene === scene) {
      return;
    }

    this.removeAll();
    this._scene = scene;
    this._destroyCollection("_billboards");
    this._destroyCollection("_labels");
  }

  getPrimitives() {
    const primitives = [];
    if (this._billboards) {
      primitives.push(this._billboards);
    }
    if (this._labels) {
      primitives.push(this._labels);
    }
    return primitives;
  }

  hasTileEntries(tileKey) {
    return this._tileEntries.has(tileKey);
  }

  addTileEntries(tileKey, descriptors = {}) {
    if (!tileKey) {
      return false;
    }

    this.removeTileEntries(tileKey);

    const billboardDescriptors = descriptors.billboards ?? [];
    const labelDescriptors = descriptors.labels ?? [];
    if (billboardDescriptors.length === 0 && labelDescriptors.length === 0) {
      return false;
    }

    const tileEntries = {
      billboards: [],
      labels: [],
    };

    if (billboardDescriptors.length > 0) {
      const billboards = this._getOrCreateBillboardCollection();
      for (let i = 0; i < billboardDescriptors.length; ++i) {
        tileEntries.billboards.push(billboards.add(billboardDescriptors[i]));
      }
    }

    if (labelDescriptors.length > 0) {
      const labels = this._getOrCreateLabelCollection();
      for (let i = 0; i < labelDescriptors.length; ++i) {
        tileEntries.labels.push(labels.add(labelDescriptors[i]));
      }
    }

    this._tileEntries.set(tileKey, tileEntries);
    this._diagnostics?.addGauge(
      "liveSharedBillboards",
      tileEntries.billboards.length,
    );
    this._diagnostics?.addGauge("liveSharedLabels", tileEntries.labels.length);
    this._diagnostics?.addGauge(
      "sharedPointAddsThisFrame",
      tileEntries.billboards.length + tileEntries.labels.length,
    );
    return true;
  }

  removeTileEntries(tileKey) {
    const tileEntries = this._tileEntries.get(tileKey);
    if (!tileEntries) {
      return false;
    }

    this._tileEntries.delete(tileKey);
    removeHandles(this._billboards, tileEntries.billboards);
    removeHandles(this._labels, tileEntries.labels);
    this._diagnostics?.addGauge(
      "liveSharedBillboards",
      -tileEntries.billboards.length,
    );
    this._diagnostics?.addGauge("liveSharedLabels", -tileEntries.labels.length);
    this._diagnostics?.addGauge(
      "sharedPointRemovesThisFrame",
      tileEntries.billboards.length + tileEntries.labels.length,
    );
    return true;
  }

  removeAll() {
    const tileKeys = [...this._tileEntries.keys()];
    for (let i = 0; i < tileKeys.length; ++i) {
      this.removeTileEntries(tileKeys[i]);
    }
  }

  destroy() {
    this.removeAll();
    this._destroyCollection("_billboards");
    this._destroyCollection("_labels");
  }

  _getOrCreateBillboardCollection() {
    if (!this._billboards) {
      this._billboards = markCollectionReady(
        new Cesium.BillboardCollection({ scene: this._scene }),
      );
      this._diagnostics?.addGauge("sharedPointCollections", 1);
    }
    return this._billboards;
  }

  _getOrCreateLabelCollection() {
    if (!this._labels) {
      this._labels = markCollectionReady(
        new Cesium.LabelCollection({ scene: this._scene }),
      );
      this._diagnostics?.addGauge("sharedPointCollections", 1);
    }
    return this._labels;
  }

  _destroyCollection(fieldName) {
    const collection = this[fieldName];
    if (!collection) {
      return;
    }

    if (!collection.isDestroyed?.()) {
      collection.destroy();
    }
    this[fieldName] = undefined;
    this._diagnostics?.addGauge("sharedPointCollections", -1);
  }
}

export function createSharedPointEntryKey(vectorTile, bucketId) {
  const tileKey =
    vectorTile?.cacheKey ??
    [vectorTile?.level, vectorTile?.x, vectorTile?.y].join("/");
  return `${tileKey}:${bucketId}`;
}

function removeHandles(collection, handles) {
  if (!collection || collection.isDestroyed?.() || handles.length === 0) {
    return;
  }

  for (let i = 0; i < handles.length; ++i) {
    collection.remove?.(handles[i]);
  }
}

function markCollectionReady(collection) {
  if (collection.ready === undefined) {
    collection.ready = true;
  }
  return collection;
}
