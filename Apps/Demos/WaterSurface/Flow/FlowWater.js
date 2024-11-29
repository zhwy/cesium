// https://github.com/shaonianla1997/source/tree/main/20240906

import * as Cesium from "../../../../Build/Cesium/index.js";

const COMMON = /* glsl */ `
  uniform sampler2D heightMap;
  uniform sampler2D normalMap;
  uniform sampler2D normalMap1;
  uniform sampler2D normalMap2;
  uniform float maxElevation;
  uniform float minElevation;
  uniform float time;
  uniform float frequency;
  uniform float amplitude;  // change to adjust the small random waves
  uniform float waterLevel; // Water level (range: 0.0 - 1.0)
  uniform vec3 sunDirection;
  uniform float xyRatio;
  uniform vec4 flowMapConfig;
  uniform vec2 flowDirection;
  uniform sampler2D marchingMap;

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

    // float fadeFactor = 1.;
    // float fade = max(1.0, (length(positionEC.xyz) / 10000000000.0) * frequency * fadeFactor);

    // vec4 noise = czm_getWaterNoise(normalMap, uv * frequency, time * 0.1, 0.);
    // vec3 normalTangentSpace = noise.xyz * vec3(1.0, 1.0, (1.0 / amplitude));
    // normalTangentSpace.xy /= fade;
    // normalTangentSpace = normalize(normalTangentSpace);

    // float level = waterLevel + normalTangentSpace.z * 0.1;

    float level = waterLevel * texture(marchingMap, uv).r;

    float normalizedHeight = level; // max(level, height);
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

    float flowMapOffset0 = flowMapConfig.x;
    float flowMapOffset1 = flowMapConfig.y;
    float halfCycle = flowMapConfig.z;
    float scale = flowMapConfig.w;

    bool isHide = texture(marchingMap, uv).a < 0.5;
    if (isHide) discard;

    // 水未覆盖区域
    // if (height > level) {
    //   discard;
    // }

    // flow
    // sample normal maps (distort uvs with flowdata)
    vec2 flow = flowDirection * vec2(-1., -1.);
    vec4 normalColor0 = texture( normalMap1, ( uv * scale ) + flow * flowMapOffset0 );
    vec4 normalColor1 = texture( normalMap2, ( uv * scale ) + flow * flowMapOffset1 );

    // linear interpolate to get the final normal color
    float flowLerp = abs( halfCycle - flowMapOffset0 ) / halfCycle;
    vec4 normalColor = mix( normalColor0, normalColor1, flowLerp );

    // calculate normal vector
    vec3 normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.g * 2.0 - 1.0,  normalColor.b / amplitude ) );

    float fadeFactor = 1.;
    float fade = max(1.0, (length(v_positionEC) / 10000000000.0) * frequency * fadeFactor);

    // cesium water normal
    vec4 noise = czm_getWaterNoise(normalMap, uv * vec2(1., 1. / xyRatio) * frequency, time * 0.5, 0.79);
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
    material.diffuse = vec3(0.3, 0.5, 0.9); // + (0.1 * tsPerturbationRatio);
    material.specular = 0.5;
    material.shininess = 10.;
    material.normal = normalize(tangentToEye * normal);
    material.emission = vec3(0.0);
    material.alpha =  0.8; // clamp( (level - height) * 100. / level, 0., 0.95);

    // Convert view vector to world space
    vec3 positionToEyeEC = -v_positionEC;

    out_FragColor = czm_phong(normalize(positionToEyeEC), material, czm_lightDirectionEC);
  }

  `;

export default class Erosion extends Cesium.Primitive {
  get showLines() {
    return this._showLines;
  }

  set showLines(value) {
    this._showLines = value;
    this.drawCommand.primitiveType = this._showLines
      ? Cesium.PrimitiveType.LINES
      : Cesium.PrimitiveType.TRIANGLES;
  }

  get halfCycle() {
    return this.cycle / 2;
  }

  get frequency() {
    return this.flowMapConfig.w;
  }

  set frequency(value) {
    this.flowMapConfig.w = value;
  }

  constructor(options) {
    super();
    this.viewer = options.viewer;
    this.polygon = options.polygon;
    this.textureCoordinates = options.textureCoordinates;
    this.xyRatio = options.xyRatio;
    this.maxElevation = options.maxElevation;
    this.minElevation = options.minElevation;
    this.heightMapUrl = options.heightMapUrl;
    this.noiseMapUrl = options.noiseMapUrl;

    this.amplitude = 5;
    this.waterLevel = 0.3;
    this._showLines = false;
    this.sunDirection = new Cesium.Cartesian3(0, 0, 1);

    this.flowDirection = new Cesium.Cartesian2(0.1, -0.9);
    this.cycle = 0.3;
    this.flowSpeed = 1;
    this.flowMapConfig = new Cesium.Cartesian4(
      0,
      this.halfCycle,
      this.halfCycle,
      10
    );
  }

  createCommand(context) {
    const polygon = new Cesium.PolygonGeometry({
      ellipsoid: Cesium.Ellipsoid.WGS84,
      polygonHierarchy: this.polygon,
      vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
      granularity: Cesium.Math.toRadians(0.0001), // 调整这个参数以增加顶点密度
      height: this.minElevation,
      textureCoordinates: this.textureCoordinates,
    });

    let geometry = Cesium.PolygonGeometry.createGeometry(polygon);
    geometry = Cesium.GeometryPipeline.encodeAttribute(
      geometry,
      "position",
      "positionHigh",
      "positionLow"
    );
    const attributeLocations = Cesium.GeometryPipeline.createAttributeLocations(
      geometry
    );

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
        wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
        wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
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
    this.normalMap1 = new Cesium.Texture({
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
    this.normalMap2 = new Cesium.Texture({
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
    this.marchingMap = new Cesium.Texture({
      context,
      width: 1,
      height: 1,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.FLOAT,
      flipY: true,
      sampler: new Cesium.Sampler({
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
        wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
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

      this.marchingMap = new Cesium.Texture({
        context,
        width: image.width,
        height: image.height,
        pixelFormat: Cesium.PixelFormat.RGBA,
        pixelDatatype: Cesium.PixelDatatype.FLOAT,
        flipY: false,
        sampler: new Cesium.Sampler({
          minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
          magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
          wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
          wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
        }),
        source: undefined,
      });
    });

    Cesium.Resource.fetchImage({
      url: "./Water_1_M_Normal.jpg",
    }).then((image) => {
      this.normalMap1 = new Cesium.Texture({
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

    Cesium.Resource.fetchImage({
      url: "./Water_2_M_Normal.jpg",
    }).then((image) => {
      this.normalMap2 = new Cesium.Texture({
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

    // 计算水头演进纹理
    this.computeCommand = new Cesium.ComputeCommand({
      outputTexture: this.marchingMap,
      uniformMap: {
        time: () => this.time,
        flowDirection: () => this.flowDirection,
        heightMap: () => this.heightMap,
        startPoint: () => new Cesium.Cartesian2(0.78, 0.73),
      },
      fragmentShaderSource: /* glsl */ `
        in vec2 v_textureCoordinates;

        uniform sampler2D heightMap;
        uniform vec2 startPoint;
        uniform float time;
        uniform vec2 flowDirection;

        void main() {
          vec2 uv = v_textureCoordinates;
          vec2 flow = normalize(flowDirection * vec2(1., 1.));

          // float height = texture(heightMap, uv).r;
          // if (height > 0.) {
          //   // 非水域
          //   out_FragColor = vec4(0.);
          //   return;
          // }

          vec2 toStart = normalize(uv - startPoint);
          float toStartDistance = length(uv - startPoint);
          float cosValue = dot(toStart, flow);
          float distanceAlongFlowDirection = cosValue * toStartDistance;
          float head = time * 0.01;

          if (distanceAlongFlowDirection <= head) {
            // 水流过
            out_FragColor = vec4(clamp((head - distanceAlongFlowDirection) * 5., 0., 1.) , 0., 0., 1. );
          } else {
            // 还没流到
            out_FragColor = vec4(0.);
          }

          // out_FragColor = vec4(vec3(distanceAlongFlowDirection), 1.);

        }
      `,
      preExecute: () => {
        const nextTexture = new Cesium.Texture({
          width: this.marchingMap.width,
          height: this.marchingMap.height,
          context: context,
          pixelFormat: Cesium.PixelFormat.RGBA,
          pixelDatatype: Cesium.PixelDatatype.FLOAT,
          flipX: false,
          flipY: false,
        });
        this.computeCommand.outputTexture = nextTexture;
      },
      postExecute: (outputTexture) => {
        this.marchingMap = outputTexture;
      },
    });

    const uniformMap = {
      heightMap: () => this.heightMap,
      normalMap: () => this.normalMap,
      normalMap1: () => this.normalMap1,
      normalMap2: () => this.normalMap2,
      marchingMap: () => this.marchingMap,
      flowSpeed: () => this.flowSpeed,
      flowMapConfig: () => this.flowMapConfig,
      flowDirection: () => this.flowDirection,
      minElevation: () => this.minElevation,
      maxElevation: () => this.maxElevation,
      time: () => this.time,
      amplitude: () => this.amplitude,
      frequency: () => this.frequency,
      waterLevel: () => this.waterLevel,
      sunDirection: () => this.sunDirection,
      xyRatio: () => this.xyRatio,
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
      pass: Cesium.Pass.TRANSLUCENT,
    });
  }

  async update(frameState) {
    const now = performance.now();
    this.deltaTime = (now - this.lastUpdateTime) / 1000.0; // 转换为秒
    this.lastUpdateTime = now;
    this.time = now / 1000;
    this._updateFlow(0.001);
    if (!this.drawCommand) {
      this.createCommand(frameState.context);
    }
    frameState.commandList.push(this.computeCommand);
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
          drawCommand.renderState
        );
      }
    });
    this.drawCommand = null;
  }

  _updateFlow(delta) {
    this.flowMapConfig.x += this.flowSpeed * delta; // flowMapOffset0
    this.flowMapConfig.y = this.flowMapConfig.x + this.halfCycle; // flowMapOffset1

    // Important: The distance between offsets should be always the value of "halfCycle".
    // Moreover, both offsets should be in the range of [ 0, cycle ].
    // This approach ensures a smooth water flow and avoids "reset" effects.

    if (this.flowMapConfig.x >= this.cycle) {
      this.flowMapConfig.x = 0;
      this.flowMapConfig.y = this.halfCycle;
    } else if (this.flowMapConfig.y >= this.cycle) {
      this.flowMapConfig.y = this.flowMapConfig.y - this.cycle;
    }
  }
}
