/*
 * Esri Contribution: This code implements support for I3S (Indexed 3D Scene Layers), an OGC Community Standard.
 * Co-authored-by: Alexandre Jean-Claude ajeanclaude@spiria.com
 * Co-authored-by: Anthony Mirabeau anthony.mirabeau@presagis.com
 * Co-authored-by: Elizabeth Rudkin elizabeth.rudkin@presagis.com
 * Co-authored-by: Tamrat Belayneh tbelayneh@esri.com
 *
 * The I3S format has been developed by Esri and is shared under an Apache 2.0 license and is maintained @ https://github.com/Esri/i3s-spec.
 * This implementation supports loading, displaying, and querying an I3S layer (supported versions include Esri github I3S versions 1.6, 1.7/1.8 -
 * whose OGC equivalent are I3S Community Standard Version 1.1 & 1.2) in the CesiumJS viewer.
 * It enables the user to access an I3S layer via its URL and load it inside of the CesiumJS viewer.
 *
 * When a scene layer is initialized it accomplishes the following:
 *
 * It processes the 3D Scene Layer resource (https://github.com/Esri/i3s-spec/blob/master/docs/1.8/3DSceneLayer.cmn.md) of an I3S dataset
 * and loads the layers data. It does so by creating a Cesium 3D Tileset for the given i3s layer and loads the root node.
 * When the root node is imported, it creates a Cesium 3D Tile that is parented to the Cesium 3D Tileset
 * and loads all children of the root node:
 *  for each children
 *   Create a place holder 3D tile so that the LOD display can use the nodes' selection criteria (maximumScreenSpaceError) to select the appropriate node
 *   based on the current LOD display & evaluation. If the Cesium 3D tile is visible, it invokes requestContent on it.
 *   At that moment, we intercept the call to requestContent, and we load the geometry in I3S format
 *   That geometry is transcoded on the fly to glTF format and ingested by CesiumJS
 *   When the geometry is loaded, we then load all children of this node as placeholders so that the LOD
 *   can know about them too.
 *
 * About transcoding:
 *
 * We use web workers to transcode I3S geometries into glTF
 * The steps are:
 *
 * Decode geometry attributes (positions, normals, etc..) either from DRACO or Binary format.
 * If requested, when creating an I3SDataProvider the user has the option to specify a tiled elevation terrain provider
 * (geoidTiledTerrainProvider) such as the one shown in the sandcastle example based on ArcGISTiledElevationTerrainProvider, that allows
 * conversion of heights for all vertices & bounding boxes of an I3S layer from (typically) gravity related (Orthometric) heights to Ellipsoidal.
 * This step is essential when fusing data with varying height sources (as is the case when fusing the I3S dataset (gravity related) in the sandcastle examples with the cesium world terrain (ellipsoidal)).
 * We then transform vertex coordinates from LONG/LAT/HEIGHT to Cartesian in local space and
 * scale appropriately if specified in the attribute metadata
 * Crop UVs if UV regions are defined in the attribute metadata
 * Create a glTF document in memory that will be ingested as part of a glb payload
 *
 * About GEOID data:
 *
 * We provide the ability to use GEOID data to convert heights from gravity related (orthometric) height systems to ellipsoidal.
 * We employ a service architecture to get the conversion factor for a given long lat values, leveraging existing implementation based on ArcGISTiledElevationTerrainProvider
 * to avoid requiring bloated look up files. The source Data used in this transcoding service was compiled from https://earth-info.nga.mil/#tab_wgs84-data and is based on
 * EGM2008 Gravity Model. The sandcastle examples show how to set the terrain provider service if required.
 */
import Cartesian2 from "../Core/Cartesian2.js";
import Cartographic from "../Core/Cartographic.js";
import Check from "../Core/Check.js";
import Frozen from "../Core/Frozen.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import HeightmapEncoding from "../Core/HeightmapEncoding.js";
import Resource from "../Core/Resource.js";
import RuntimeError from "../Core/RuntimeError.js";
import WebMercatorProjection from "../Core/WebMercatorProjection.js";
import I3SLayer from "./I3SLayer.js";
import I3SStatistics from "./I3SStatistics.js";
import I3SSublayer from "./I3SSublayer.js";
import Lerc from "lerc";
import Rectangle from "../Core/Rectangle.js";

/**
 * @typedef {Object} I3SDataProvider.ConstructorOptions
 *
 * Initialization options for the I3SDataProvider constructor
 *
 * @property {string} [name] The name of the I3S dataset.
 * @property {boolean} [show=true] Determines if the dataset will be shown.
 * @property {ArcGISTiledElevationTerrainProvider|Promise<ArcGISTiledElevationTerrainProvider>} [geoidTiledTerrainProvider] Tiled elevation provider describing an Earth Gravitational Model. If defined, geometry will be shifted based on the offsets given by this provider. Required to position I3S data sets with gravity-related height at the correct location.
 * @property {Cesium3DTileset.ConstructorOptions} [cesium3dTilesetOptions] Object containing options to pass to an internally created {@link Cesium3DTileset}. See {@link Cesium3DTileset} for list of valid properties. All options can be used with the exception of <code>url</code> and <code>show</code> which are overridden by values from I3SDataProvider.
 * @property {boolean} [showFeatures=false] Determines if the features will be shown.
 * @property {boolean} [adjustMaterialAlphaMode=false] The option to adjust the alpha mode of the material based on the transparency of the vertex color. When <code>true</code>, the alpha mode of the material (if not defined) will be set to BLEND for geometry with any transparency in the color vertex attribute.
 * @property {boolean} [applySymbology=false] Determines if the I3S symbology will be parsed and applied for the layers.
 * @property {boolean} [calculateNormals=false] Determines if the flat normals will be generated for I3S geometry without normals.
 *
 * @example
 * // Increase LOD by reducing SSE
 * const cesium3dTilesetOptions = {
 *   maximumScreenSpaceError: 1,
 * };
 * const i3sOptions = {
 *   cesium3dTilesetOptions: cesium3dTilesetOptions,
 * };
 *
 * @example
 * // Set a custom outline color to replace the color defined in I3S symbology
 * const cesium3dTilesetOptions = {
 *   outlineColor: Cesium.Color.BLUE,
 * };
 * const i3sOptions = {
 *   cesium3dTilesetOptions: cesium3dTilesetOptions,
 *   applySymbology: true,
 * };
 */

/**
 * An I3SDataProvider is the main public class for I3S support. The url option
 * should return a scene object. Currently supported I3S versions are 1.6 and
 * 1.7/1.8 (OGC I3S 1.2). I3SFeature and I3SNode classes implement the
 * Object Model for I3S entities, with public interfaces.
 *
 * <div class="notice">
 * This object is normally not instantiated directly, use {@link I3SDataProvider.fromUrl}.
 * </div>
 *
 * @alias I3SDataProvider
 * @constructor
 *
 * @param {I3SDataProvider.ConstructorOptions} options An object describing initialization options
 *
 * @see I3SDataProvider.fromUrl
 * @see ArcGISTiledElevationTerrainProvider
 *
 * @example
 * try {
 *   const i3sData = await I3SDataProvider.fromUrl(
 *     "https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/Frankfurt2017_vi3s_18/SceneServer/layers/0"
 *   );
 *   viewer.scene.primitives.add(i3sData);
 * } catch (error) {
 *   console.log(`There was an error creating the I3S Data Provider: ${error}`);
 * }
 *
 * @example
 * try {
 *   const geoidService = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
 *     "https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/EGM2008/ImageServer"
 *   );
 *   const i3sData = await I3SDataProvider.fromUrl(
 *     "https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/Frankfurt2017_vi3s_18/SceneServer/layers/0", {
 *       geoidTiledTerrainProvider: geoidService
 *   });
 *   viewer.scene.primitives.add(i3sData);
 * } catch (error) {
 *   console.log(`There was an error creating the I3S Data Provider: ${error}`);
 * }
 */
function I3SDataProvider(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  // All public configuration is defined as ES5 properties
  // These are just the "private" variables and their defaults.
  this._name = options.name;
  this._show = options.show ?? true;
  this._geoidTiledTerrainProvider = options.geoidTiledTerrainProvider;
  this._showFeatures = options.showFeatures ?? false;
  this._adjustMaterialAlphaMode = options.adjustMaterialAlphaMode ?? false;
  this._applySymbology = options.applySymbology ?? false;
  this._calculateNormals = options.calculateNormals ?? false;

  this._cesium3dTilesetOptions =
    options.cesium3dTilesetOptions ?? Frozen.EMPTY_OBJECT;

  this._layers = [];
  this._sublayers = [];
  this._data = undefined;
  this._extent = undefined;
  this._geoidDataPromise = undefined;
  this._geoidDataList = undefined;
  this._decoderTaskProcessor = undefined;
  this._taskProcessorReadyPromise = undefined;
  this._attributeStatistics = [];
  this._layersExtent = [];
}

Object.defineProperties(I3SDataProvider.prototype, {
  /**
   * Gets a human-readable name for this dataset.
   * @memberof I3SDataProvider.prototype
   * @type {string}
   * @readonly
   */
  name: {
    get: function () {
      return this._name;
    },
  },

  /**
   * Determines if the dataset will be shown.
   * @memberof I3SDataProvider.prototype
   * @type {boolean}
   */
  show: {
    get: function () {
      return this._show;
    },
    set: function (value) {
      //>>includeStart('debug', pragmas.debug);
      Check.defined("value", value);
      //>>includeEnd('debug');

      if (this._show !== value) {
        this._show = value;
        for (let i = 0; i < this._layers.length; i++) {
          this._layers[i]._updateVisibility();
        }
      }
    },
  },

  /**
   * The terrain provider referencing the GEOID service to be used for orthometric to ellipsoidal conversion.
   * @memberof I3SDataProvider.prototype
   * @type {ArcGISTiledElevationTerrainProvider}
   * @readonly
   */
  geoidTiledTerrainProvider: {
    get: function () {
      return this._geoidTiledTerrainProvider;
    },
  },

  /**
   * Gets the collection of layers.
   * @memberof I3SDataProvider.prototype
   * @type {I3SLayer[]}
   * @readonly
   */
  layers: {
    get: function () {
      return this._layers;
    },
  },

  /**
   * Gets the collection of building sublayers.
   * @memberof I3SDataProvider.prototype
   * @type {I3SSublayer[]}
   * @readonly
   */
  sublayers: {
    get: function () {
      return this._sublayers;
    },
  },

  /**
   * Gets the I3S data for this object.
   * @memberof I3SDataProvider.prototype
   * @type {object}
   * @readonly
   */
  data: {
    get: function () {
      return this._data;
    },
  },

  /**
   * Gets the extent covered by this I3S.
   * @memberof I3SDataProvider.prototype
   * @type {Rectangle}
   * @readonly
   */
  extent: {
    get: function () {
      return this._extent;
    },
  },

  /**
   * The resource used to fetch the I3S dataset.
   * @memberof I3SDataProvider.prototype
   * @type {Resource}
   * @readonly
   */
  resource: {
    get: function () {
      return this._resource;
    },
  },

  /**
   * Determines if the features will be shown.
   * @memberof I3SDataProvider.prototype
   * @type {boolean}
   * @readonly
   */
  showFeatures: {
    get: function () {
      return this._showFeatures;
    },
  },

  /**
   * Determines if the alpha mode of the material will be adjusted depending on the color vertex attribute.
   * @memberof I3SDataProvider.prototype
   * @type {boolean}
   * @readonly
   */
  adjustMaterialAlphaMode: {
    get: function () {
      return this._adjustMaterialAlphaMode;
    },
  },

  /**
   * Determines if the I3S symbology will be parsed and applied for the layers.
   * @memberof I3SDataProvider.prototype
   * @type {boolean}
   * @readonly
   */
  applySymbology: {
    get: function () {
      return this._applySymbology;
    },
  },

  /**
   * Determines if the flat normals will be generated for I3S geometry without normals.
   * @memberof I3SDataProvider.prototype
   * @type {boolean}
   * @readonly
   */
  calculateNormals: {
    get: function () {
      return this._calculateNormals;
    },
  },
});

/**
 * Destroys the WebGL resources held by this object. Destroying an object allows for deterministic
 * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
 * <p>
 * Once an object is destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception. Therefore,
 * assign the return value (<code>undefined</code>) to the object as done in the example.
 * </p>
 *
 * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
 *
 * @see I3SDataProvider#isDestroyed
 */
I3SDataProvider.prototype.destroy = function () {
  for (let i = 0; i < this._layers.length; i++) {
    if (defined(this._layers[i]._tileset)) {
      this._layers[i]._tileset.destroy();
    }
  }

  return destroyObject(this);
};

/**
 * Returns true if this object was destroyed; otherwise, false.
 * <p>
 * If this object was destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
 * </p>
 *
 * @returns {boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 *
 * @see I3SDataProvider#destroy
 */
I3SDataProvider.prototype.isDestroyed = function () {
  return false;
};

/**
 * @private
 */
I3SDataProvider.prototype.update = function (frameState) {
  for (let i = 0; i < this._layers.length; i++) {
    if (defined(this._layers[i]._tileset)) {
      this._layers[i]._tileset.update(frameState);
    }
  }
};

/**
 * @private
 */
I3SDataProvider.prototype.prePassesUpdate = function (frameState) {
  for (let i = 0; i < this._layers.length; i++) {
    if (defined(this._layers[i]._tileset)) {
      this._layers[i]._tileset.prePassesUpdate(frameState);
    }
  }
};

/**
 * @private
 */
I3SDataProvider.prototype.postPassesUpdate = function (frameState) {
  for (let i = 0; i < this._layers.length; i++) {
    if (defined(this._layers[i]._tileset)) {
      this._layers[i]._tileset.postPassesUpdate(frameState);
    }
  }
};

/**
 * @private
 */
I3SDataProvider.prototype.updateForPass = function (frameState, passState) {
  for (let i = 0; i < this._layers.length; i++) {
    if (defined(this._layers[i]._tileset)) {
      this._layers[i]._tileset.updateForPass(frameState, passState);
    }
  }
};

function buildLayerUrl(provider, layerId) {
  const dataProviderUrl = provider.resource.getUrlComponent();

  let layerUrl = "";
  if (dataProviderUrl.match(/layers\/\d/)) {
    layerUrl = `${dataProviderUrl}`.replace(/\/+$/, "");
  } else {
    // Add '/' to url if needed + `$layers/${layerId}/` if tilesetUrl not already in ../layers/[id] format
    layerUrl = `${dataProviderUrl}`
      .replace(/\/?$/, "/")
      .concat(`layers/${layerId}`);
  }
  return layerUrl;
}

async function addLayers(provider, data, options) {
  if (data.layerType === "Building") {
    if (!defined(options.showFeatures)) {
      // The Building Scene Layer requires features to be shown to support filtering
      provider._showFeatures = true;
    }
    if (!defined(options.adjustMaterialAlphaMode)) {
      // The Building Scene Layer enables transparency by default
      provider._adjustMaterialAlphaMode = true;
    }
    if (!defined(options.applySymbology)) {
      // The Building Scene Layer applies symbology by default
      provider._applySymbology = true;
    }
    if (!defined(options.calculateNormals)) {
      // The Building Scene Layer calculates flat normals by default
      provider._calculateNormals = true;
    }

    const buildingLayerUrl = buildLayerUrl(provider, data.id);
    if (defined(data.sublayers)) {
      const promises = [];
      for (let i = 0; i < data.sublayers.length; i++) {
        const promise = I3SSublayer._fromData(
          provider,
          buildingLayerUrl,
          data.sublayers[i],
          provider,
        );
        promises.push(promise);
      }
      const sublayers = await Promise.all(promises);
      for (let i = 0; i < sublayers.length; i++) {
        const sublayer = sublayers[i];
        provider._sublayers.push(sublayer);
        provider._layers.push(...sublayer._i3sLayers);
      }
    }

    if (defined(data.statisticsHRef)) {
      const uri = buildingLayerUrl.concat(`/${data.statisticsHRef}`);
      const statistics = new I3SStatistics(provider, uri);
      await statistics.load();
      provider._attributeStatistics.push(statistics);
    }

    if (defined(data.fullExtent)) {
      const extent = Rectangle.fromDegrees(
        data.fullExtent.xmin,
        data.fullExtent.ymin,
        data.fullExtent.xmax,
        data.fullExtent.ymax,
      );
      provider._layersExtent.push(extent);
    }
  } else if (
    data.layerType === "3DObject" ||
    data.layerType === "IntegratedMesh"
  ) {
    if (
      !defined(options.calculateNormals) &&
      !defined(data.textureSetDefinitions)
    ) {
      // I3S Layers without textures should calculate flat normals by default
      provider._calculateNormals = true;
    }

    const newLayer = new I3SLayer(provider, data, provider);
    provider._layers.push(newLayer);
    if (defined(newLayer._extent)) {
      provider._layersExtent.push(newLayer._extent);
    }
  } else {
    // Filter other scene layer types out
    console.log(
      `${data.layerType} layer ${data.name} is skipped as not supported.`,
    );
  }
}

/**
 * Creates an I3SDataProvider. Currently supported I3S versions are 1.6 and
 * 1.7/1.8 (OGC I3S 1.2).
 *
 * @param {string|Resource} url The url of the I3S dataset, which should return an I3S scene object
 * @param {I3SDataProvider.ConstructorOptions} options An object describing initialization options
 * @returns {Promise<I3SDataProvider>}
 *
 * @example
 * try {
 *   const i3sData = await I3SDataProvider.fromUrl(
 *     "https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/Frankfurt2017_vi3s_18/SceneServer/layers/0"
 *   );
 *   viewer.scene.primitives.add(i3sData);
 * } catch (error) {
 *   console.log(`There was an error creating the I3S Data Provider: ${error}`);
 * }
 *
 * @example
 * try {
 *   const geoidService = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
 *     "https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/EGM2008/ImageServer"
 *   );
 *   const i3sData = await I3SDataProvider.fromUrl(
 *     "https://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/Frankfurt2017_vi3s_18/SceneServer/layers/0", {
 *       geoidTiledTerrainProvider: geoidService
 *   });
 *   viewer.scene.primitives.add(i3sData);
 * } catch (error) {
 *   console.log(`There was an error creating the I3S Data Provider: ${error}`);
 * }
 */
I3SDataProvider.fromUrl = async function (url, options) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("url", url);
  //>>includeEnd('debug');

  options = options ?? Frozen.EMPTY_OBJECT;

  const resource = Resource.createIfNeeded(url);
  // Set a query parameter for json to avoid failure on html pages
  resource.setQueryParameters({ f: "pjson" }, true);
  const data = await I3SDataProvider.loadJson(resource);

  const provider = new I3SDataProvider(options);
  provider._resource = resource;
  provider._data = data;

  // Success
  if (defined(data.layers)) {
    const promises = [];
    for (let layerIndex = 0; layerIndex < data.layers.length; layerIndex++) {
      const promise = addLayers(provider, data.layers[layerIndex], options);
      promises.push(promise);
    }
    await Promise.all(promises);
  } else {
    await addLayers(provider, data, options);
  }

  provider._computeExtent();

  // Start loading all of the tiles
  const layerPromises = [];
  for (let i = 0; i < provider._layers.length; i++) {
    layerPromises.push(
      provider._layers[i].load(options.cesium3dTilesetOptions),
    );
  }

  await Promise.all(layerPromises);
  return provider;
};

/**
 * @private
 */
I3SDataProvider._fetchJson = function (resource) {
  return resource.fetchJson();
};

/**
 * @private
 *
 * @param {Resource} resource The JSON resource to request
 * @returns {Promise<object>} The fetched data
 */
I3SDataProvider.loadJson = async function (resource) {
  const data = await I3SDataProvider._fetchJson(resource);
  if (defined(data.error)) {
    console.error("Failed to fetch I3S ", resource.url);
    if (defined(data.error.message)) {
      console.error(data.error.message);
    }
    if (defined(data.error.details)) {
      for (let i = 0; i < data.error.details.length; i++) {
        console.log(data.error.details[i]);
      }
    }

    throw new RuntimeError(data.error);
  }

  return data;
};

/**
 * @private
 */
I3SDataProvider.prototype._loadBinary = async function (resource) {
  const buffer = await resource.fetchArrayBuffer();
  if (buffer.byteLength > 0) {
    // Check if we have a JSON response with 404
    const array = new Uint8Array(buffer);
    if (array[0] === "{".charCodeAt(0)) {
      const textContent = new TextDecoder();
      const str = textContent.decode(buffer);
      if (str.includes("404")) {
        throw new RuntimeError(`Failed to load binary: ${resource.url}`);
      }
    }
  }
  return buffer;
};

/**
 * @private
 */
I3SDataProvider.prototype._binarizeGltf = function (rawGltf) {
  const encoder = new TextEncoder();
  const rawGltfData = encoder.encode(JSON.stringify(rawGltf));
  const binaryGltfData = new Uint8Array(rawGltfData.byteLength + 20);
  const binaryGltf = {
    magic: new Uint8Array(binaryGltfData.buffer, 0, 4),
    version: new Uint32Array(binaryGltfData.buffer, 4, 1),
    length: new Uint32Array(binaryGltfData.buffer, 8, 1),
    chunkLength: new Uint32Array(binaryGltfData.buffer, 12, 1),
    chunkType: new Uint32Array(binaryGltfData.buffer, 16, 1),
    chunkData: new Uint8Array(
      binaryGltfData.buffer,
      20,
      rawGltfData.byteLength,
    ),
  };

  binaryGltf.magic[0] = "g".charCodeAt();
  binaryGltf.magic[1] = "l".charCodeAt();
  binaryGltf.magic[2] = "T".charCodeAt();
  binaryGltf.magic[3] = "F".charCodeAt();

  binaryGltf.version[0] = 2;
  binaryGltf.length[0] = binaryGltfData.byteLength;
  binaryGltf.chunkLength[0] = rawGltfData.byteLength;
  binaryGltf.chunkType[0] = 0x4e4f534a; // JSON
  binaryGltf.chunkData.set(rawGltfData);

  return binaryGltfData;
};

const scratchCartesian2 = new Cartesian2();

function getCoveredTiles(terrainProvider, extent) {
  const tilingScheme = terrainProvider.tilingScheme;

  // Sort points into a set of tiles
  const tileRequests = []; // Result will be an Array as it's easier to work with
  const tileRequestSet = {}; // A unique set

  const maxLevel = terrainProvider._lodCount;

  const topLeftCorner = Cartographic.fromRadians(extent.west, extent.north);
  const bottomRightCorner = Cartographic.fromRadians(extent.east, extent.south);
  const minCornerXY = tilingScheme.positionToTileXY(topLeftCorner, maxLevel);
  const maxCornerXY = tilingScheme.positionToTileXY(
    bottomRightCorner,
    maxLevel,
  );

  // Get all the tiles in between
  for (let x = minCornerXY.x; x <= maxCornerXY.x; x++) {
    for (let y = minCornerXY.y; y <= maxCornerXY.y; y++) {
      const xy = Cartesian2.fromElements(x, y, scratchCartesian2);
      const key = xy.toString();
      if (!tileRequestSet.hasOwnProperty(key)) {
        // When tile is requested for the first time
        const value = {
          x: xy.x,
          y: xy.y,
          level: maxLevel,
          tilingScheme: tilingScheme,
          terrainProvider: terrainProvider,
          positions: [],
        };
        tileRequestSet[key] = value;
        tileRequests.push(value);
      }
    }
  }

  // Send request for each required tile
  const tilePromises = [];
  for (let i = 0; i < tileRequests.length; ++i) {
    const tileRequest = tileRequests[i];
    const requestPromise = tileRequest.terrainProvider.requestTileGeometry(
      tileRequest.x,
      tileRequest.y,
      tileRequest.level,
    );

    tilePromises.push(requestPromise);
  }

  return Promise.all(tilePromises).then(function (heightMapBuffers) {
    const heightMaps = [];
    for (let i = 0; i < heightMapBuffers.length; i++) {
      const options = {
        tilingScheme: tilingScheme,
        x: tileRequests[i].x,
        y: tileRequests[i].y,
        level: tileRequests[i].level,
      };
      const heightMap = heightMapBuffers[i];

      let projectionType = "Geographic";
      if (tilingScheme._projection instanceof WebMercatorProjection) {
        projectionType = "WebMercator";
      }

      const heightMapData = {
        projectionType: projectionType,
        projection: tilingScheme._projection,
        nativeExtent: tilingScheme.tileXYToNativeRectangle(
          options.x,
          options.y,
          options.level,
        ),
        height: heightMap._height,
        width: heightMap._width,
        scale: heightMap._structure.heightScale,
        offset: heightMap._structure.heightOffset,
      };

      if (heightMap._encoding === HeightmapEncoding.LERC) {
        const result = Lerc.decode(heightMap._buffer);
        heightMapData.buffer = result.pixels[0];
      } else {
        heightMapData.buffer = heightMap._buffer;
      }

      heightMaps.push(heightMapData);
    }

    return heightMaps;
  });
}

async function loadGeoidData(provider) {
  // Load tiles from arcgis
  const geoidTerrainProvider = provider._geoidTiledTerrainProvider;

  if (!defined(geoidTerrainProvider)) {
    return;
  }

  try {
    const heightMaps = await getCoveredTiles(
      geoidTerrainProvider,
      provider._extent,
    );
    provider._geoidDataList = heightMaps;
  } catch (error) {
    console.log(
      "Error retrieving Geoid Terrain tiles - no geoid conversion will be performed.",
    );
  }
}

/**
 * @private
 */
I3SDataProvider.prototype.loadGeoidData = async function () {
  if (defined(this._geoidDataPromise)) {
    return this._geoidDataPromise;
  }

  this._geoidDataPromise = loadGeoidData(this);
  return this._geoidDataPromise;
};

/**
 * @private
 */
I3SDataProvider.prototype._computeExtent = function () {
  let rectangle;

  // Compute the extent from all layers
  for (
    let layerIndex = 0;
    layerIndex < this._layersExtent.length;
    layerIndex++
  ) {
    const layerExtent = this._layersExtent[layerIndex];
    if (!defined(rectangle)) {
      rectangle = Rectangle.clone(layerExtent);
    } else {
      Rectangle.union(rectangle, layerExtent, rectangle);
    }
  }

  this._extent = rectangle;
};

/**
 * Returns the collection of names for all available attributes
 * @returns {string[]} The collection of attribute names
 */
I3SDataProvider.prototype.getAttributeNames = function () {
  const attributes = [];
  for (let i = 0; i < this._attributeStatistics.length; ++i) {
    attributes.push(...this._attributeStatistics[i].names);
  }
  return attributes;
};

/**
 * Returns the collection of values for the attribute with the given name
 * @param {string} name The attribute name
 * @returns {string[]} The collection of attribute values
 */
I3SDataProvider.prototype.getAttributeValues = function (name) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("name", name);
  //>>includeEnd('debug');

  for (let i = 0; i < this._attributeStatistics.length; ++i) {
    const values = this._attributeStatistics[i]._getValues(name);
    if (defined(values)) {
      return values;
    }
  }
  return [];
};

/**
 * Filters the drawn elements of a scene to specific attribute names and values
 * @param {I3SNode.AttributeFilter[]} [filters=[]] The collection of attribute filters
 * @returns {Promise<void>} A promise that is resolved when the filter is applied
 */
I3SDataProvider.prototype.filterByAttributes = function (filters) {
  const promises = [];
  for (let i = 0; i < this._layers.length; i++) {
    const promise = this._layers[i].filterByAttributes(filters);
    promises.push(promise);
  }
  return Promise.all(promises);
};

export default I3SDataProvider;
