// https://github.com/shaonianla1997/source/tree/main/20240906

import * as Cesium from "../../../../Build/Cesium/index.js";

const COMMON = /* glsl */ `
  uniform sampler2D heightMap;
  uniform sampler2D normalMap;
  uniform float maxElevation;
  uniform float minElevation;
  uniform float time;
  uniform float frequency;
  uniform float amplitude;  // change to adjust the small random waves
  uniform float waterLevel; // Water level (range: 0.0 - 2.0)
  uniform vec3 sunDirection;

  float height_map(vec2 p) {
    float f = texture(heightMap, p).r;
    return clamp(f, 0., 1.);
  }

  float soft_shadow(vec3 ro, vec3 rd) {
    float hit = 1.0;
    float t = 0.001;

    for(int j = 1; j < 25; j++) {
      vec3 p = ro + t * rd;
      float h = height_map(p.xy);
      float height_diff = p.z - h;

      if(height_diff < 0.0) {
          return 0.0;
      }

      hit = min(hit, 2. * height_diff / t);
      t += 0.01 + height_diff * .02;      
    }
    
    return hit;
  }
`;

const VERTEX_SHADER = /* glsl */ `
  in vec3 positionHigh;
  in vec3 positionLow;
  in vec2 st;
  in vec3 normal;
  in vec3 tangent;
  in vec3 bitangent;

  out vec2 v_st;
  out float v_height;
  out float v_level;
  out vec3 v_positionEC;
  out vec3 v_positionMC;

  void main() {
    vec2 uv = st;
    vec3 positionWC = positionHigh + positionLow;
    vec4 positionEC = czm_translateRelativeToEye(positionHigh, positionLow);

    float height = height_map(uv);

    float fadeFactor = 1.;
    float fade = max(1.0, (length(positionEC.xyz) / 10000000000.0) * frequency * fadeFactor);

    vec4 noise = czm_getWaterNoise(normalMap, uv * frequency, time * 0.1, 0.);
    vec3 normalTangentSpace = noise.xyz * vec3(1.0, 1.0, (1.0 / amplitude));
    normalTangentSpace.xy /= fade;
    normalTangentSpace = normalize(normalTangentSpace);

    float level = waterLevel + normalTangentSpace.z * 0.01;

    float normalizedHeight = max(level, height);
    float heightOffset = (maxElevation - minElevation) * normalizedHeight;

    vec3 dir = normalize(positionHigh + positionLow);
    gl_Position = czm_modelViewProjectionRelativeToEye * (positionEC + vec4(dir * heightOffset, 0.));

    v_height = height;
    v_level = level;

    v_st = st;
    v_positionEC = positionEC.xyz;
    v_positionMC = positionWC;
    
  }
  `;

const FRAGMENT_SHADER = /* glsl */ `

  in vec2 v_st;
  in vec3 v_positionEC;
  in vec3 v_positionMC;

  in float v_height;
  in float v_level;

  void main(){
    vec2 uv = v_st;

    float level = v_level;
    float height = v_height;

    if (height > level) {
      discard;
    }

    float fadeFactor = 1.;
    float fade = max(1.0, (length(v_positionEC) / 10000000000.0) * frequency * fadeFactor);

    vec4 noise = czm_getWaterNoise(normalMap, uv * frequency, time * 0.1, 0.);
    vec3 normalTangentSpace = noise.xyz * vec3(1.0, 1.0, (1.0 / amplitude));
    normalTangentSpace.xy /= fade;

    // attempt to fade out the normal perturbation as we approach non water areas
    // normalTangentSpace = mix(vec3(0.0, 0.0, 50.0), normalTangentSpace, clamp( (level - height) * 100. / level, 0., 1.));
    normalTangentSpace = normalize(normalTangentSpace);
    // get ratios for alignment of the new normal vector with a vector perpendicular to the tangent plane
    float tsPerturbationRatio = clamp(dot(normalTangentSpace, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);

    vec3 normalEC = normalize(czm_normal3D * czm_geodeticSurfaceNormal(v_positionMC, vec3(0.0), vec3(1.0)));
    // normalEC = faceforward(normalEC, vec3(0.0, 0.0, 1.0), -normalEC);
    mat3 tangentToEye = czm_eastNorthUpToEyeCoordinates(v_positionMC, normalEC);

    czm_material material;
    material.diffuse = vec3(0.3, 0.5, 0.9) + (0.1 * tsPerturbationRatio);
    material.specular = 0.5;
    material.shininess = 10.;
    material.normal = normalize(tangentToEye * normalTangentSpace);
    material.emission = vec3(0.0);
    material.alpha = clamp( (level - height) * 100. / level, 0., 0.95);  

    // Convert view vector to world space
    vec3 positionToEyeEC = -v_positionEC;

    out_FragColor = czm_phong(normalize(positionToEyeEC), material, czm_lightDirectionEC);
  }

  `;

export default class Erosion extends Cesium.Primitive {
  constructor(options) {
    super();
    this.viewer = options.viewer;
    this.extent = options.extent;
    this.polygon = options.polygon;
    this.maxElevation = options.maxElevation;
    this.minElevation = options.minElevation;
    this.heightMapUrl = options.heightMapUrl;
    this.noiseMapUrl = options.noiseMapUrl;

    this.amplitude = 30;
    this.frequency = 10000;
    this.waterLevel = 0.5;
    this._showLines = false;
    this.sunDirection = new Cesium.Cartesian3(0, 0, 1);
  }
  createCommand(context) {
    const polygon = new Cesium.PolygonGeometry({
      ellipsoid: Cesium.Ellipsoid.WGS84,
      polygonHierarchy: this.polygon,
      vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
      granularity: Cesium.Math.toRadians(0.001), // 调整这个参数以增加顶点密度
      height: this.minElevation,
    });

    let geometry = Cesium.PolygonGeometry.createGeometry(polygon);
    geometry = Cesium.GeometryPipeline.encodeAttribute(
      geometry,
      "position",
      "positionHigh",
      "positionLow",
    );
    const attributeLocations =
      Cesium.GeometryPipeline.createAttributeLocations(geometry);

    const va = Cesium.VertexArray.fromGeometry({
      context: context,
      geometry: geometry,
      attributeLocations: attributeLocations,
    });

    const shaderProgram = Cesium.ShaderProgram.fromCache({
      context: context,
      vertexShaderSource: COMMON + VERTEX_SHADER,
      fragmentShaderSource: COMMON + FRAGMENT_SHADER,
      attributeLocations: attributeLocations,
    });

    this.heightMap = new Cesium.Texture({
      context,
      width: 1,
      height: 1,
      pixelFormat: Cesium.PixelFormat.RGB,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      flipY: true,
      sampler: new Cesium.Sampler({
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        wrapS: Cesium.TextureWrap.REPEAT,
        wrapT: Cesium.TextureWrap.REPEAT,
      }),
      source: undefined,
    });
    this.normalMap = new Cesium.Texture({
      context,
      width: 1,
      height: 1,
      pixelFormat: Cesium.PixelFormat.RGB,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      flipY: true,
      sampler: new Cesium.Sampler({
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        wrapS: Cesium.TextureWrap.REPEAT,
        wrapT: Cesium.TextureWrap.REPEAT,
      }),
      source: undefined,
    });

    Cesium.Resource.fetchImage({
      url: this.heightMapUrl,
    }).then((image) => {
      this.heightMap = new Cesium.Texture({
        context: context,
        width: image.width,
        height: image.height,
        pixelFormat: Cesium.PixelFormat.RGB,
        pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
        flipY: true,
        sampler: new Cesium.Sampler({
          minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
          magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
          wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
          wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
        }),
        source: image,
      });
    });

    Cesium.Resource.fetchImage({
      url: this.noiseMapUrl,
    }).then((image) => {
      this.normalMap = new Cesium.Texture({
        context: context,
        width: image.width,
        height: image.height,
        pixelFormat: Cesium.PixelFormat.RGB,
        pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
        flipY: true,
        sampler: new Cesium.Sampler({
          minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
          magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
          wrapS: Cesium.TextureWrap.REPEAT,
          wrapT: Cesium.TextureWrap.REPEAT,
        }),
        source: image,
      });
    });

    const uniformMap = {
      heightMap: () => {
        return this.heightMap;
      },
      normalMap: () => {
        return this.normalMap;
      },
      minElevation: () => this.minElevation,
      maxElevation: () => this.maxElevation,
      time: () => this.time,
      amplitude: () => this.amplitude,
      frequency: () => this.frequency,
      waterLevel: () => this.waterLevel,
      sunDirection: () => this.sunDirection,
    };

    const renderState = Cesium.RenderState.fromCache({
      depthTest: { enabled: true },
      depthMask: { enabled: true },
      blending: Cesium.BlendingState.ALPHA_BLEND,
      cull: {
        enabled: false,
      },
    });
    this.drawCommand = new Cesium.DrawCommand({
      modelMatrix: this.modelMatrix,
      vertexArray: va,
      primitiveType: Cesium.PrimitiveType.TRIANGLES, //TRIANGLES LINES
      shaderProgram: shaderProgram,
      uniformMap: uniformMap,
      renderState: renderState,
      pass: Cesium.Pass.OPAQUE,
    });
  }
  set showLines(value) {
    this._showLines = value;
    this.drawCommand.primitiveType = this._showLines
      ? Cesium.PrimitiveType.LINES
      : Cesium.PrimitiveType.TRIANGLES;
  }
  get showLines() {
    return this._showLines;
  }
  get sunDirectionX() {
    return this.sunDirection.x;
  }
  get sunDirectionY() {
    return this.sunDirection.y;
  }
  get sunDirectionZ() {
    return this.sunDirection.z;
  }
  set sunDirectionX(value) {
    this.sunDirection.x = value;
  }
  set sunDirectionY(value) {
    this.sunDirection.y = value;
  }
  set sunDirectionZ(value) {
    this.sunDirection.z = value;
  }

  async update(frameState) {
    const now = performance.now();
    this.deltaTime = (now - this.lastUpdateTime) / 1000.0; // 转换为秒
    this.lastUpdateTime = now;
    this.time = now / 1000;
    this.frame += 0.02;
    if (!this.drawCommand) {
      this.createCommand(frameState.context);
    }
    frameState.commandList.push(this.drawCommand);
  }
  destroy() {
    super.destroy();
    const commondList = [this.drawCommand];
    commondList.forEach((drawCommand) => {
      if (drawCommand) {
        const va = drawCommand.vertexArray,
          sp = drawCommand.shaderProgram;
        if (!va.isDestroyed()) {
          va.destroy();
        }
        if (!sp.isDestroyed || !sp.isDestroyed()) {
          sp.destroy();
        }
        drawCommand.isDestroyed = function returnTrue() {
          return true;
        };
        drawCommand.uniformMap = undefined;
        drawCommand.renderState = Cesium.RenderState.removeFromCache(
          drawCommand.renderState,
        );
      }
    });
    this.drawCommand = null;
  }
}
