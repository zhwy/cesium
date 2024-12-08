import * as Cesium from "../../../Build/CesiumUnminified/index.js";
import CustomPrimitive from "./CustomPrimitive.js";

window.CESIUM_BASE_URL = "../../../Build/CesiumUnminified/";
Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0MjM4NGQ4Yi05MjAzLTQ3NzMtOTZmYS05ZDE1ZWZhYTk3OWMiLCJpZCI6MTEzNTYsInNjb3BlcyI6WyJhc3IiLCJnYyJdLCJpYXQiOjE1NTg2ODcwMDJ9.I0-TpqepRcWIVUUI8KrhoSZp-a70sRSRveNLBXOwOto";

const COMMON = /* glsl */ `
  const int textureSize = 256;
  // Render
  const vec3 backgroundColor = vec3(0.2);
  // Terrain
  const float transitionTime = 5.0;
  const float transitionPercent = 0.3;
  const int octaves = 7;
  // Water simulation
  const float attenuation = 0.995;
  const float strenght = 0.25;
  const float minTotalFlow = 0.0001;
  const float initialWaterLevel = 0.01;

  mat2 rot(in float ang)
  {
    return mat2(
      cos(ang), -sin(ang),
      sin(ang),  cos(ang)
    );
  }

  // hash from Dave_Hoskins https://www.shadertoy.com/view/4djSRW
  float hash12(vec2 p)
  {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float hash13(vec3 p3)
  {
    p3 = fract(p3 * .1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Box intersection by IQ https://iquilezles.org/articles/boxfunctions

  vec2 boxIntersection( in vec3 ro, in vec3 rd, in vec3 rad, out vec3 oN ) 
  {
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * rad;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;

    float tN = max( max( t1.x, t1.y ), t1.z );
    float tF = min( min( t2.x, t2.y ), t2.z );
    
    if( tN > tF || tF < 0.0) return vec2(-1.0); // no intersection
    
    oN = -sign(rd)*step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);

    return vec2( tN, tF );
  }

  vec2 hitBox(vec3 orig, vec3 dir) {
    const vec3 box_min = vec3(-0.5);
    const vec3 box_max = vec3(0.5);
    vec3 inv_dir = 1.0 / dir;
    vec3 tmin_tmp = (box_min - orig) * inv_dir;
    vec3 tmax_tmp = (box_max - orig) * inv_dir;
    vec3 tmin = min(tmin_tmp, tmax_tmp);
    vec3 tmax = max(tmin_tmp, tmax_tmp);
    float t0 = max(tmin.x, max(tmin.y, tmin.z));
    float t1 = min(tmax.x, min(tmax.y, tmax.z));
    return vec2(t0, t1);
  }

  // Fog by IQ https://iquilezles.org/articles/fog

  vec3 applyFog( in vec3  rgb, vec3 fogColor, in float distance)
  {
    float fogAmount = exp( -distance );
    return mix( fogColor, rgb, fogAmount );
  }
`;

// compute Terrain and update water level 1st pass
const BUFFER_A = /* glsl */ `
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;
  uniform sampler2D heightMap;
  uniform float     iTime;
  uniform float iFrame;
  float boxNoise( in vec2 p, in float z )
  {
    vec2 fl = floor(p);
    vec2 fr = fract(p);
    fr = smoothstep(0.0, 1.0, fr);
    float res = mix(mix( hash13(vec3(fl, z)),             hash13(vec3(fl + vec2(1,0), z)),fr.x),
                    mix( hash13(vec3(fl + vec2(0,1), z)), hash13(vec3(fl + vec2(1,1), z)),fr.x),fr.y);
    return res;
  }

  float Terrain( in vec2 p, in float z, in int octaveNum)
  {
    float a = 1.0;
    float f = .0;
    for (int i = 0; i < octaveNum; i++)
    {
      f += a * boxNoise(p, z);
      a *= 0.45;
      p = 2.0 * rot(radians(41.0)) * p;
    }
    return f;
  }

  vec2 readHeight(ivec2 p)
  {
    p = clamp(p, ivec2(0), ivec2(textureSize - 1));
    return texelFetch(iChannel0, p, 0).xy;
  }

  vec4 readOutFlow(ivec2 p)
  {
    if(p.x < 0 || p.y < 0 || p.x >= textureSize || p.y >= textureSize)
      return vec4(0);
    return texelFetch(iChannel1, p, 0);
  }

  void main( )
  {
    // Outside ?
    if( max(gl_FragCoord.x, gl_FragCoord.y) > float(textureSize) )
      discard;
            
    // Terrain
    vec2 uv = gl_FragCoord.xy / float(textureSize);
    float t = iTime / transitionTime;
    // float terrainElevation = mix(Terrain(uv * 4.0, floor(t), octaves), Terrain(uv * 4.0, floor(t) + 1.0, octaves), smoothstep(1.0 - transitionPercent, 1.0, fract(t))) * 0.5;
    float terrainElevation = texelFetch(heightMap, ivec2(gl_FragCoord.xy * 8.), 0).x * 0.5;
    // Water
    float waterDept = initialWaterLevel;
    if(iFrame != 0.)
    {
      ivec2 p = ivec2(gl_FragCoord.xy);
      vec2 height = readHeight(p);
      vec4 OutFlow = texelFetch(iChannel1, p, 0);
      float totalOutFlow = OutFlow.x + OutFlow.y + OutFlow.z + OutFlow.w;
      float totalInFlow = 0.0;
      totalInFlow += readOutFlow(p  + ivec2( 1,  0)).z;
      totalInFlow += readOutFlow(p  + ivec2( 0,  1)).w;
      totalInFlow += readOutFlow(p  + ivec2(-1,  0)).x;
      totalInFlow += readOutFlow(p  + ivec2( 0, -1)).y;
      waterDept = height.y - totalOutFlow + totalInFlow;
    }
    out_FragColor = vec4(terrainElevation, waterDept, 0, 1);
  }
`;

// Update Outflow 1st pass
const BUFFER_B = /* glsl */ `
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;
  uniform float iFrame;
  vec2 readHeight(ivec2 p)
  {
    p = clamp(p, ivec2(0), ivec2(textureSize - 1));
    return texelFetch(iChannel0, p, 0).xy;
  } 

  float computeOutFlowDir(vec2 centerHeight, ivec2 pos)
  {
    vec2 dirHeight = readHeight(pos);
    return max(0.0f, (centerHeight.x + centerHeight.y) - (dirHeight.x + dirHeight.y));
  }

  void main()
  {
    ivec2 p = ivec2(gl_FragCoord.xy);
    // Init to zero at frame 0
    if(iFrame == 0.)
    {
      out_FragColor = vec4(0);
      return;
    }    
    
    // Outside ?
    if( max(p.x, p.y) > textureSize ) discard;
    
    vec4 oOutFlow = texelFetch(iChannel1, p, 0);
    vec2 height = readHeight(p);
    vec4 nOutFlow;        
    nOutFlow.x = computeOutFlowDir(height, p + ivec2( 1,  0));
    nOutFlow.y = computeOutFlowDir(height, p + ivec2( 0,  1));
    nOutFlow.z = computeOutFlowDir(height, p + ivec2(-1,  0));
    nOutFlow.w = computeOutFlowDir(height, p + ivec2( 0, -1));
    nOutFlow = attenuation * oOutFlow + strenght * nOutFlow;
    float totalFlow = nOutFlow.x + nOutFlow.y + nOutFlow.z + nOutFlow.w;
    if(totalFlow > minTotalFlow)
    {
      if(height.y < totalFlow)
      {
          nOutFlow = nOutFlow * (height.y / totalFlow);
      }
    }
    else
    {
        nOutFlow = vec4(0);
    }


    out_FragColor = nOutFlow;
  }
`;

// water level 2nd pass
const BUFFER_C = /* glsl */ `
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;

  vec2 readHeight(ivec2 p)
  {
    p = clamp(p, ivec2(0), ivec2(textureSize - 1));
    return texelFetch(iChannel0, p, 0).xy;
  }

  vec4 readOutFlow(ivec2 p)
  {
    if(p.x < 0 || p.y < 0 || p.x >= textureSize || p.y >= textureSize)
      return vec4(0);
    
    return texelFetch(iChannel1, p, 0);
  } 

  void main()
  {
    // Outside ?
    if( max(gl_FragCoord.x, gl_FragCoord.y) > float(textureSize) )
      discard;
            
    // Water
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 height = readHeight(p);
    vec4 OutFlow = texelFetch(iChannel1, p, 0);
    float totalOutFlow = OutFlow.x + OutFlow.y + OutFlow.z + OutFlow.w;
    float totalInFlow = 0.0;
    totalInFlow += readOutFlow(p  + ivec2( 1,  0)).z;
    totalInFlow += readOutFlow(p  + ivec2( 0,  1)).w;
    totalInFlow += readOutFlow(p  + ivec2(-1,  0)).x;
    totalInFlow += readOutFlow(p  + ivec2( 0, -1)).y;
    float waterDept = height.y - totalOutFlow + totalInFlow;

    out_FragColor = vec4(height.x, waterDept, 0, 1);
  }
`;

// Update Outflow 2nd pass
const BUFFER_D = /* glsl */ `
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;
  vec2 readHeight(ivec2 p)
  {
    p = clamp(p, ivec2(0), ivec2(textureSize - 1));
    return texelFetch(iChannel0, p, 0).xy;
  } 

  float computeOutFlowDir(vec2 centerHeight, ivec2 pos)
  {
    vec2 dirHeight = readHeight(pos);
    return max(0.0f, (centerHeight.x + centerHeight.y) - (dirHeight.x + dirHeight.y));
  }

  void main( )
  {
    ivec2 p = ivec2(gl_FragCoord.xy);
    
    // Outside ?
    if( max(p.x, p.y) > textureSize )
      discard;
    
    vec4 oOutFlow = texelFetch(iChannel1, p, 0);
    vec2 height = readHeight(p);
    vec4 nOutFlow;        
    nOutFlow.x = computeOutFlowDir(height, p + ivec2( 1,  0));
    nOutFlow.y = computeOutFlowDir(height, p + ivec2( 0,  1));
    nOutFlow.z = computeOutFlowDir(height, p + ivec2(-1,  0));
    nOutFlow.w = computeOutFlowDir(height, p + ivec2( 0, -1));
    nOutFlow = attenuation * oOutFlow + strenght * nOutFlow;
    float totalFlow = nOutFlow.x + nOutFlow.y + nOutFlow.z + nOutFlow.w;
    if(totalFlow > minTotalFlow)
    {
      if(height.y < totalFlow)
      {
        nOutFlow = nOutFlow * (height.y / totalFlow);
      }
    }
    else
    {
      nOutFlow = vec4(0);
    }

    out_FragColor = nOutFlow;
  }
`;

const RENDER_SHADER_VERTEX_SOURCE = /* glsl */ `
  in vec3 position;
  in vec2 st;
  
  out vec3 vo;
  out vec3 vd;

  void main()
  {    
    vo = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
    vd = position - vo;
    gl_Position = czm_modelViewProjection * vec4(position, 1.0);
  }
`;

// Created by David Gallardo - xjorma/2021
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0
const RENDER_SHADER_FRAGMENT_SOURCE = /* glsl */ `
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;
  uniform vec2 iResolution;
  uniform float heightScale;
  in vec3 vo;
  in vec3 vd;
  const vec3 light = vec3(0., 4., 2.);
  const float boxHeight = 0.45;

  vec2 getHeight(in vec3 p)
  {
    p = (p + 1.0) * 0.5;
    vec2 p2 = p.xz * vec2(float(textureSize)) / iResolution.xy;
    p2 = min(p2, vec2(float(textureSize) - 0.5) / iResolution.xy);
    vec2 h = texture(iChannel0, p2).xy;
    h.y += h.x;
    // h.y = 0.;
    return h - boxHeight;
  }

  vec3 getNormal(in vec3 p, int comp)
  {
    float d = 2.0 / float(textureSize);
    float hMid = getHeight(p)[comp];
    float hRight = getHeight(p + vec3(d, 0, 0))[comp];
    float hTop = getHeight(p + vec3(0, 0, d))[comp];
    return normalize(cross(vec3(0, hTop - hMid, d), vec3(d, hRight - hMid, 0)));
  }

  vec3 terrainColor(in vec3 p, in vec3 n, out float spec)
  {
    spec = 0.1;
    vec3 c = vec3(0.21, 0.50, 0.07);
    float cliff = smoothstep(0.8, 0.3, n.y);
    c = mix(c, vec3(0.25), cliff);
    spec = mix(spec, 0.3, cliff);
    float snow = smoothstep(0.05, 0.25, p.y) * smoothstep(0.5, 0.7, n.y);
    c = mix(c, vec3(0.95, 0.95, 0.85), snow);
    spec = mix(spec, 0.4, snow);
    vec3 t = texture(iChannel1, p.xz * 5.0).xyz;
    return mix(c, c * t, 0.75);
  }

  vec3 undergroundColor(float d)
  {
    vec3 color[4] = vec3[](vec3(0.5, 0.45, 0.5), vec3(0.40, 0.35, 0.25), vec3(0.55, 0.50, 0.4), vec3(0.45, 0.30, 0.20));
    d *= 6.0;
    d = min(d, 3.0 - 0.001);
    float fr = fract(d);
    float fl = floor(d);
    return mix(color[int(fl)], color[int(fl) + 1], fr);
  }

  vec3 Render(in vec3 ro, in vec3 rd) {
    vec3 n;
    vec3 rayDir = normalize(rd);
    vec2 ret = hitBox(ro, rayDir);
    if (ret.x > ret.y) discard;
    ret.x = max(ret.x, 0.0);
    vec3 p = ro + ret.x * rayDir;
    
    if (ret.x > 0.0) {
      vec3 pi = ro + rd * ret.x;
      vec3 tc;
      vec3 tn;
      float tt = ret.x;
      vec2 h = getHeight(pi);
      float spec;
      if (pi.y < h.x) {
        discard;
        tn = n;
        tc = undergroundColor(h.x - pi.y);
      }
      else {
        for (int i = 0; i < 80; i++) {
          vec3 p = ro + rd * tt;
          float h = p.y - getHeight(p).x;
          if (h < 0.0002 || tt > ret.y)
          break;
          tt += h * 0.4;
        }
        tn = getNormal(ro + rd * tt, 0);
        tc = terrainColor(ro + rd * tt, tn, spec);
      }
      {
        vec3 lightDir = normalize(light - (ro + rd * tt));
        tc = tc * (max( 0.0, dot(lightDir, tn)) + 0.3);
        spec *= pow(max(0., dot(lightDir, reflect(rd, tn))), 10.0);
        tc += spec;
      }
      if (tt > ret.y) {
        tc = vec3(0, 0, 0.4);
      }
      float wt = ret.x;
      h = getHeight(pi);
      vec3 waterNormal;
      if (pi.y < h.y) {
        waterNormal = n;
      }
      else {
        for (int i = 0; i < 80; i++) {
          vec3 p = ro + rd * wt;
          float h = p.y - getHeight(p).y;
          if (h < 0.0002 || wt > min(tt, ret.y))
          break;
          wt += h * 0.4;
        }
        waterNormal = getNormal(ro + rd * wt, 1);
      }
      if (wt < ret.y) {
        float dist = (min(tt, ret.y) - wt);
        vec3 p = waterNormal;
        vec3 lightDir = normalize(light - (ro + rd * wt));
        tc = applyFog( tc, vec3(0, 0, 0.4), dist * 15.0);
        float spec = pow(max(0., dot(lightDir, reflect(rd, waterNormal))), 20.0);
        tc += 0.5 * spec * smoothstep(0.0, 0.1, dist);
      } else {
        discard;
      }
      return tc;
    }
    discard;
  }

  vec3 vignette(vec3 color, vec2 q, float v)
  {
    color *= 0.3 + 0.8 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), v);
    return color;
  }
  
  void main()
  {
    vec3 tot = vec3(0.0);
    vec3 rayDir = normalize(vd);
    vec3 col = Render(vo, rayDir);
    tot += col;
    out_FragColor = vec4( tot, 1.0 );
  }
`;

function generateModelMatrix(
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
) {
  const rotationX = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(rotation[0])),
  );

  const rotationY = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.fromRotationY(Cesium.Math.toRadians(rotation[1])),
  );

  const rotationZ = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(rotation[2])),
  );
  if (!(position instanceof Cesium.Cartesian3)) {
    position = Cesium.Cartesian3.fromDegrees(...position);
  }
  const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  Cesium.Matrix4.multiply(enuMatrix, rotationX, enuMatrix);
  Cesium.Matrix4.multiply(enuMatrix, rotationY, enuMatrix);
  Cesium.Matrix4.multiply(enuMatrix, rotationZ, enuMatrix);
  const scaleMatrix = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(...scale));
  const modelMatrix = Cesium.Matrix4.multiply(
    enuMatrix,
    scaleMatrix,
    new Cesium.Matrix4(),
  );

  return modelMatrix;
}

const viewer = new Cesium.Viewer("cesiumContainer");
window._viewer = viewer;

viewer.scene.globe.depthTestAgainstTerrain = true;

viewer.camera.setView({
  destination: {
    x: -2771064.6756677167,
    y: 4781829.550624459,
    z: 3179130.042667584,
  },
  orientation: {
    heading: Cesium.Math.toRadians(48.72529042457395),
    pitch: Cesium.Math.toRadians(-10.899276751527792),
    roll: Cesium.Math.toRadians(0.0014027234956804583),
  },
});

const resolution = new Cesium.Cartesian2(256, 256);
const context = viewer.scene.context;

const WIDTH = 256;
const HEIGHT = 256;

let time = 1;
let frame = 0;

const texA = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

const texB = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

const texC = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

const texD = new Cesium.Texture({
  context,
  width: WIDTH,
  height: HEIGHT,
  pixelFormat: Cesium.PixelFormat.RGBA,
  pixelDatatype: Cesium.PixelDatatype.FLOAT,
  source: {
    arrayBufferView: new Float32Array(WIDTH * HEIGHT * 4),
  },
});

let heightMap = new Cesium.Texture({
  context,
  width: 1,
  height: 1,
});
Cesium.Resource.fetchImage({
  url: "./Erosion/1724136544296.png",
}).then((image) => {
  // resolution.x = image.width;
  // resolution.y = image.height;

  heightMap = new Cesium.Texture({
    context: context,
    width: image.width,
    height: image.height,
    pixelFormat: Cesium.PixelFormat.RGBA,
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

const computeA = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    iTime: () => {
      return time;
    },
    iFrame: () => {
      return frame;
    },
    resolution: () => {
      return resolution;
    },
    iChannel0: () => {
      return texC;
    },
    iChannel1: () => {
      return texD;
    },
    heightMap: () => {
      return heightMap;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_A,
  outputTexture: texA,
  preExecute: function () {
    computeA.command.outputTexture = texA;
  },
});

const computeB = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    iFrame: () => {
      return frame;
    },
    resolution: () => {
      return resolution;
    },
    iChannel0: () => {
      return texA;
    },
    iChannel1: () => {
      return texD;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_B,
  outputTexture: texB,
  preExecute: function () {
    computeB.command.outputTexture = texB;
  },
});

const computeC = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    resolution: () => {
      return resolution;
    },
    iChannel0: () => {
      return texA;
    },
    iChannel1: () => {
      return texB;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_C,
  outputTexture: texC,
  preExecute: function () {
    computeC.command.outputTexture = texC;
  },
});

const computeD = new CustomPrimitive({
  commandType: "Compute",
  uniformMap: {
    resolution: () => {
      return resolution;
    },
    iChannel0: () => {
      return texC;
    },
    iChannel1: () => {
      return texB;
    },
  },
  fragmentShaderSource: COMMON + BUFFER_D,
  outputTexture: texD,
  preExecute: function () {
    computeD.command.outputTexture = texD;
  },
});

let terrainMap = new Cesium.Texture({
  context,
  width: 1,
  height: 1,
});
Cesium.Resource.fetchImage({
  url: "https://www.shadertoy.com/media/a/8979352a182bde7c3c651ba2b2f4e0615de819585cc37b7175bcefbca15a6683.jpg",
}).then((image) => {
  terrainMap = new Cesium.Texture({
    context,
    width: image.width,
    height: image.height,
    pixelFormat: Cesium.PixelFormat.RGBA,
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

const boxGeometry = Cesium.BoxGeometry.fromDimensions({
  vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
  dimensions: new Cesium.Cartesian3(1, 1, 1),
});
const geometry = Cesium.BoxGeometry.createGeometry(boxGeometry);

const modelMatrix = generateModelMatrix(
  [120.20998865783179, 30.13650797533829, 300],
  [90, 0, 0],
  [2000, 600, 1700],
);

const drawPrimitive = new CustomPrimitive({
  commandType: "Draw",
  uniformMap: {
    iResolution: () => {
      return resolution;
    },
    iChannel0: () => {
      return texC;
    },
    iChannel1: () => {
      return terrainMap;
    },
    heightScale: () => {
      return 1000;
    },
  },
  geometry: geometry,
  modelMatrix: modelMatrix,
  vertexShaderSource: RENDER_SHADER_VERTEX_SOURCE,
  fragmentShaderSource: COMMON + RENDER_SHADER_FRAGMENT_SOURCE,
});

viewer.scene.postRender.addEventListener(() => {
  const now = performance.now();
  time = now / 1000;
  frame += 0.02;
});

viewer.scene.primitives.add(computeA);
viewer.scene.primitives.add(computeB);
viewer.scene.primitives.add(computeC);
viewer.scene.primitives.add(computeD);
viewer.scene.primitives.add(drawPrimitive);
