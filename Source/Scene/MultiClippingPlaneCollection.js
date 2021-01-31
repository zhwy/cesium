import AttributeCompression from "../Core/AttributeCompression.js";
import Cartesian2 from "../Core/Cartesian2.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Cartesian4 from "../Core/Cartesian4.js";
import Check from "../Core/Check.js";
import Color from "../Core/Color.js";
import defaultValue from "../Core/defaultValue.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import DeveloperError from "../Core/DeveloperError.js";
import Event from "../Core/Event.js";
import Intersect from "../Core/Intersect.js";
import Matrix4 from "../Core/Matrix4.js";
import PixelFormat from "../Core/PixelFormat.js";
import Plane from "../Core/Plane.js";
import ContextLimits from "../Renderer/ContextLimits.js";
import PixelDatatype from "../Renderer/PixelDatatype.js";
import Sampler from "../Renderer/Sampler.js";
import Texture from "../Renderer/Texture.js";
import ClippingPlane from "./ClippingPlane.js";
import ClippingPlaneCollection from "./ClippingPlaneCollection.js";

function MultiClippingPlaneCollection(options) {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT);

    this._multiCollections = [];

    this._dataArrayBuffer = null;
    this._lengthArrayBuffer = null;

    this._dataTexture = null;
    this._lengthTexture = null;

    this._dirty = false;

    this._maxCollectionLength = 0;

    this._totalPlanesCount = 0;

    /**
     * The 4x4 transformation matrix specifying an additional transform relative to the clipping planes
     * original coordinate system.
     *
     * @type {Matrix4}
     * @default Matrix4.IDENTITY
     */
    this.modelMatrix = Matrix4.clone(
        defaultValue(options.modelMatrix, Matrix4.IDENTITY)
    );

    /**
     * The color applied to highlight the edge along which an object is clipped.
     *
     * @type {Color}
     * @default Color.WHITE
     */
    this.edgeColor = Color.clone(defaultValue(options.edgeColor, Color.WHITE));

    /**
     * The width, in pixels, of the highlight applied to the edge along which an object is clipped.
     *
     * @type {Number}
     * @default 0.0
     */
    this.edgeWidth = defaultValue(options.edgeWidth, 0.0);

}

Object.defineProperties(MultiClippingPlaneCollection.prototype, {
    length: {
        get: function() {
            return this._multiCollections.length;
        }
    },

    dataTexture: {
        get: function() {
            return this._dataTexture
        }
    },

    lengthTexture: {
        get: function() {
            return this._lengthTexture;
        }
    },

    collectionsState: {
        get: function() {
            var state = '';
            this._multiCollections.forEach((p, i) => {
                state += `${p.enabled ? '+' : '-'}${i}${p.clippingPlanesState}`
            })
            return state;
        }
    },

    maxCollectionLength: {
        get: function() {
            return this._maxCollectionLength;
        }
    },

    totalPlanesCount: {
        get: function() {
            return this._totalPlanesCount;
        }
    },
})

MultiClippingPlaneCollection.prototype.add = function(collection) {

    this._multiCollections.push(collection);
    this._dirty = true;
};

MultiClippingPlaneCollection.prototype.get = function(index) {
    //>>includeStart('debug', pragmas.debug);
    Check.typeOf.number("index", index);
    //>>includeEnd('debug');

    return this._multiCollections[index];
};

MultiClippingPlaneCollection.prototype.contains = function(collection) {
    return this._multiCollections.findIndex(p => p === collection) !== -1;
};

MultiClippingPlaneCollection.prototype.remove = function(collection) {
    var collections = this._multiCollections;
    var index = collections.findIndex(p => p === collection);

    if (index === -1) {
        return false;
    }

    collections.splice(index, 1);

    if (collection instanceof ClippingPlaneCollection) {
        collection.destroy();
    }

    this._dirty = true;

    return true;
};

MultiClippingPlaneCollection.prototype.removeAll = function() {
    this._multiCollections.forEach(collection => {
        if (collection instanceof ClippingPlaneCollection) {
            collection.destroy();
        }
    });
    this._multiCollections = [];
    this._dirty = true;
};

MultiClippingPlaneCollection.prototype.update = function(frameState) {

    var collections = this._multiCollections;
    collections.forEach(p => {
        if (p.enabled) p.update(frameState);
    })

    if (this._dirty) {
        var context = frameState.context;
        // concat each collection's arraybuffer 
        var useFloatTexture = ClippingPlaneCollection.useFloatTexture(context);
        var widthTotal = 0, height;
        var updateTexture = true;
        var totalPlanes = 0;
        var maxLength = 0;
        for (var i = 0; i < collections.length; i++) {
            var collection = collections[i];
            totalPlanes += collections.length;
            maxLength = Math.max(maxLength, collection.length);
            // if (collection.enabled) {
            height = collection.texture.height; // should be the same for all collections
            widthTotal += collection.texture.width;
            // }
            if (!defined(collection.texture)) {
                updateTexture = false;
            }

        }

        this._totalPlanesCount = totalPlanes;
        this._maxCollectionLength = maxLength;

        if (updateTexture && collections.length > 0) {
            this._dataArrayBuffer = useFloatTexture ? new Float32Array(widthTotal * height * 4) : new Uint8Array(widthTotal * height * 4);
            this._lengthArrayBuffer = new Float32Array(collections.length * 4);
            var arrayBuffer = this._dataArrayBuffer;
            var lengthArrayBuffer = this._lengthArrayBuffer;

            var startIndex = 0;
            collections.forEach((p, i) => {

                // if (p.enabled) {
                // var nowDataBuffer = useFloatTexture ? p._float32View : p._uint8View;
                p.concatArrayBufferView(context, arrayBuffer, startIndex);
                // var nowDataIndex = 0;
                // exclude zeros (data with height = 1)
                // for (var j = 0; j < p.length; ++j) {

                //     arrayBuffer[startIndex] = nowDataBuffer[nowDataIndex];
                //     arrayBuffer[startIndex + 1] = nowDataBuffer[nowDataIndex + 1];
                //     arrayBuffer[startIndex + 2] = nowDataBuffer[nowDataIndex + 2];
                //     arrayBuffer[startIndex + 3] = nowDataBuffer[nowDataIndex + 3];

                //     nowDataIndex += 4; // each plane is 4 floats
                //     startIndex += 4;
                // }
                startIndex += p.texture.width * 4;
                lengthArrayBuffer[i * 4 + 3] = p.length;
                // }
            })

            if (useFloatTexture) {
                this._dataTexture = new Texture({
                    context: context,
                    width: widthTotal,
                    height: height,
                    pixelFormat: PixelFormat.RGBA,
                    pixelDatatype: PixelDatatype.FLOAT,
                    sampler: Sampler.NEAREST,
                    flipY: false,
                });
            } else {
                this._dataTexture = new Texture({
                    context: context,
                    width: widthTotal,
                    height: height,
                    pixelFormat: PixelFormat.RGBA,
                    pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
                    sampler: Sampler.NEAREST,
                    flipY: false,
                    source: {
                        width: widthTotal,
                        height: height,
                        arrayBufferView: arrayBuffer,
                    }
                });
            }
            this._dataTexture.copyFrom({
                width: widthTotal,
                height: height,
                arrayBufferView: arrayBuffer,
            })

            this._lengthTexture = new Texture({
                context: context,
                width: collections.length,
                height: 1,
                pixelFormat: PixelFormat.RGBA,
                pixelDatatype: PixelDatatype.FLOAT,
                sampler: Sampler.NEAREST,
                flipY: false,
            });
            this._lengthTexture.copyFrom({
                width: collections.length,
                height: 1,
                arrayBufferView: lengthArrayBuffer
            })
        }

        this._dirty = false;
    }
};

MultiClippingPlaneCollection.prototype.destroy = function() {

    this._multiCollections.forEach(collection => {
        if (collection instanceof ClippingPlaneCollection) {
            collection.destroy();
        }
    });
    this._multiCollections = undefined

    this._dataTexture = this._dataTexture && this._dataTexture.destroy();

    this._lengthTexture = this._lengthTexture && this._dataTexture.destroy();

    return destroyObject(this);;
};

export default MultiClippingPlaneCollection;