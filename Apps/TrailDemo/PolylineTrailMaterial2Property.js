// 作者：happy_port
// 链接：https://www.jianshu.com/p/193b8ea734cd

/* eslint-disable */
export class PolylineTrailMaterial2Property {

    constructor(options) {

        options = Cesium.defaultValue(options, Cesium.defaultValue.EMPTY_OBJECT);

        this._definitionChanged = new Cesium.Event();

        this._color = undefined;

        this._colorSubscription = undefined;

        this.color = options.color;

        this.duration = options.duration;

        this.trailImage = options.trailImage;

        this._time = performance.now();

        this.repeat = options.repeat;

    }

}

Cesium.defineProperties(PolylineTrailMaterial2Property.prototype, {

    isConstant: {

        get: function() {

            return false;

        }

    },

    definitionChanged: {

        get: function() {

            return this._definitionChanged;

        }

    },

    color: Cesium.createPropertyDescriptor('color')

});

PolylineTrailMaterial2Property.prototype.getType = function(time) {

    return 'PolylineTrail2';

}

PolylineTrailMaterial2Property.prototype.getValue = function(time, result) {

    if (!Cesium.defined(result)) {

        result = {};

    }

    result.color = Cesium.Property.getValueOrClonedDefault(this._color, time, Cesium.Color.WHITE, result.color);

    result.image = Cesium.Material.PolylineTrailImage2;

    // result.image = this.trailImage;

    result.time = ((performance.now() - this._time) % this.duration) / this.duration;

    return result;

}

PolylineTrailMaterial2Property.prototype.equals = function(other) {

    return this === other ||

        (other instanceof PolylineTrailMaterial2Property &&

            Cesium.Property.equals(this._color, other._color))

}

Cesium.Material.PolylineTrailType2 = 'PolylineTrail2';

Cesium.Material.PolylineTrailImage2 = "./red.png";

Cesium.Material.PolylineTrailSource2 = `czm_material czm_getMaterial(czm_materialInput materialInput)    
{

    czm_material material = czm_getDefaultMaterial(materialInput); 

    vec2 st = materialInput.st; 

    float _time = ( time - (duration * floor(time / duration) ) ) / duration;

    vec4 colorImage = texture2D(image, vec2(fract(st.s * repeat - _time * repeat), st.t));        

    material.alpha = colorImage.a + color.a;

    material.diffuse = (colorImage.rgb + color.rgb) / 2.0; 

    return material; 

} `;

Cesium.Material._materialCache.addMaterial(Cesium.Material.PolylineTrailType2, {

    fabric: {

        type: Cesium.Material.PolylineTrailType2,

        uniforms: {

            color: new Cesium.Color(1.0, 0.0, 0.0, 1),

            image: Cesium.Material.PolylineTrailImage2,

            time: 0,

            duration: 1000,

            repeat: 1

        },

        source: Cesium.Material.PolylineTrailSource2

    },

    translucent: function(material) {

        return true;

    }

});

Cesium.PolylineTrailMaterial2Property = PolylineTrailMaterial2Property;




