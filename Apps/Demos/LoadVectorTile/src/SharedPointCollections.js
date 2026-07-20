import {
  BillboardCollection,
  LabelCollection,
} from "../../../../Build/CesiumUnminified/index.js";

/**
 * 管理跨瓦片复用的点要素集合，统一维护 BillboardCollection 与 LabelCollection 的增删生命周期。
 *
 * @param {object} [options={}] 构造参数。
 * @param {Scene} [options.scene] Cesium 场景，用于创建 `BillboardCollection` 和 `LabelCollection`。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器，用于累计共享点集合相关指标。
 * @param {Function} [options.createBillboardCollection] Billboard 集合工厂，测试可注入替身。
 * @param {Function} [options.createLabelCollection] Label 集合工厂，测试可注入替身。
 */
export default class SharedPointCollections {
  static createSharedPointEntryKey(vectorTile, bucketId) {
    const tileKey =
      vectorTile?.cacheKey ??
      [vectorTile?.level, vectorTile?.x, vectorTile?.y].join("/");
    return `${tileKey}:${bucketId}`;
  }

  constructor(options = {}) {
    this._scene = options.scene;
    this._diagnostics = options.diagnostics;
    this._pickRegistry = options.pickRegistry;
    this._createBillboardCollection =
      options.createBillboardCollection ??
      ((scene) => new BillboardCollection({ scene }));
    this._createLabelCollection =
      options.createLabelCollection ??
      ((scene) => new LabelCollection({ scene }));
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

  addTileEntries(tileKey, descriptors = {}, pickContext) {
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
        const descriptor = normalizePointDescriptor(billboardDescriptors[i]);
        const handle = billboards.add(descriptor.options);
        tileEntries.billboards.push(handle);
        if (pickContext) {
          this._pickRegistry?.registerPoint(
            handle,
            pickContext,
            descriptor.featureIndex,
          );
        }
      }
    }

    if (labelDescriptors.length > 0) {
      const labels = this._getOrCreateLabelCollection();
      for (let i = 0; i < labelDescriptors.length; ++i) {
        const descriptor = normalizePointDescriptor(labelDescriptors[i]);
        const handle = labels.add(descriptor.options);
        tileEntries.labels.push(handle);
        if (pickContext) {
          this._pickRegistry?.registerPoint(
            handle,
            pickContext,
            descriptor.featureIndex,
          );
        }
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

  updateTileEntries(tileKey, descriptors = {}, properties) {
    const tileEntries = this._tileEntries.get(tileKey);
    if (!tileEntries) {
      return false;
    }
    updateHandles(
      tileEntries.billboards,
      descriptors.billboards ?? [],
      properties,
    );
    updateHandles(tileEntries.labels, descriptors.labels ?? [], properties);
    return true;
  }

  removeTileEntries(tileKey) {
    const tileEntries = this._tileEntries.get(tileKey);
    if (!tileEntries) {
      return false;
    }

    this._tileEntries.delete(tileKey);
    removeHandles(this._billboards, tileEntries.billboards, this._pickRegistry);
    removeHandles(this._labels, tileEntries.labels, this._pickRegistry);
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
        this._createBillboardCollection(this._scene),
      );
      this._diagnostics?.addGauge("sharedPointCollections", 1);
    }
    return this._billboards;
  }

  _getOrCreateLabelCollection() {
    if (!this._labels) {
      this._labels = markCollectionReady(
        this._createLabelCollection(this._scene),
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

function removeHandles(collection, handles, pickRegistry) {
  if (handles.length === 0) {
    return;
  }

  for (let i = 0; i < handles.length; ++i) {
    pickRegistry?.unregister(handles[i]);
    if (collection && !collection.isDestroyed?.()) {
      collection.remove?.(handles[i]);
    }
  }
}

function normalizePointDescriptor(descriptor) {
  if (descriptor?.options) {
    return descriptor;
  }
  const { _vectorTileFeatureIndex, ...options } = descriptor ?? {};
  return {
    options,
    featureIndex: _vectorTileFeatureIndex ?? descriptor?.id,
  };
}

function updateHandles(handles, descriptors, properties) {
  const length = Math.min(handles.length, descriptors.length);
  for (let i = 0; i < length; ++i) {
    if (Array.isArray(properties)) {
      const options = descriptors[i]?.options ?? descriptors[i] ?? {};
      for (let j = 0; j < properties.length; ++j) {
        const property = properties[j];
        if (Object.prototype.hasOwnProperty.call(options, property)) {
          handles[i][property] = options[property];
        }
      }
    } else {
      const descriptor = normalizePointDescriptor(descriptors[i]);
      Object.assign(handles[i], descriptor.options);
    }
  }
}

function markCollectionReady(collection) {
  if (collection.ready === undefined) {
    collection.ready = true;
  }
  return collection;
}
