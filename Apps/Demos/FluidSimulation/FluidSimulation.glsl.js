const COMMON = /* glsl */ `
  uniform ivec2 textureSize;
  // Terrain
  const float transitionTime = 5.0;
  const float transitionPercent = 0.3;
  const int octaves = 7;
  // Water simulation
  const float attenuation = 0.999;
  const float strenght = 0.25;
  const float minTotalFlow = 0.0001;
  const float initialWaterLevel = 1.;
  const vec4 waterColor = vec4(0.0, 0.0, 0.4, 1.0);

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

  vec4 applyFog( in vec4 color, vec4 fogColor, in float distance)
  {
    float fogAmount = exp( -distance );
    return mix( fogColor, color, fogAmount );
  }
`;

// compute Terrain and update water level 1st pass
const BUFFER_A = /* glsl */ `
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;
  uniform sampler2D heightMap;
  uniform float iTime;
  uniform float iFrame;
  uniform vec2 iResolution;
  uniform vec3 mousePosition;
  uniform bool addWater;

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
    p = clamp(p, ivec2(0), textureSize - 1);
    return texelFetch(iChannel0, p, 0).xy;
  }

  vec4 readOutFlow(ivec2 p)
  {
    if(p.x < 0 || p.y < 0 || p.x >= textureSize.x || p.y >= textureSize.y)
      return vec4(0);
    return texelFetch(iChannel1, p, 0);
  }

  void main( )
  {
    // Outside ?
    if( gl_FragCoord.x > float(textureSize.x) || gl_FragCoord.y > float(textureSize.y) )
      discard;

    // Terrain
    // vec2 uv = gl_FragCoord.xy / float(textureSize);
    // float t = iTime / transitionTime;
    // float terrainElevation = mix(Terrain(uv * 4.0, floor(t), octaves), Terrain(uv * 4.0, floor(t) + 1.0, octaves), smoothstep(1.0 - transitionPercent, 1.0, fract(t))) * 0.5;
    float pixel_x = gl_FragCoord.x * iResolution.x / float(textureSize.x);
    // float pixel_y = (float(textureSize.y) - 1. - gl_FragCoord.y) * iResolution.y / float(textureSize.y);
    float pixel_y = gl_FragCoord.y * iResolution.y / float(textureSize.y);
    float terrainElevation = texelFetch(heightMap, ivec2(pixel_x, pixel_y), 0).x;
    // Water
    float waterDept = 0.;

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

    if (addWater) {
      vec2 center = vec2(mousePosition.x + 0.5, 0.5 - mousePosition.y) * iResolution;
      if (length(center - vec2(pixel_x, pixel_y)) < (iResolution.x / 50.) ) waterDept += initialWaterLevel;
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
    p = clamp(p, ivec2(0), textureSize - 1);
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
    if( p.x > textureSize.x || p.y > textureSize.y ) discard;

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
    p = clamp(p, ivec2(0), textureSize - 1);
    return texelFetch(iChannel0, p, 0).xy;
  }

  vec4 readOutFlow(ivec2 p)
  {
    if(p.x < 0 || p.y < 0 || p.x >= textureSize.x || p.y >= textureSize.y)
      return vec4(0);

    return texelFetch(iChannel1, p, 0);
  }

  void main()
  {
    // Outside ?
    if( gl_FragCoord.x > float(textureSize.x) || gl_FragCoord.y > float(textureSize.y) )
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
    p = clamp(p, ivec2(0), textureSize - 1);
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
    if( p.x > textureSize.x || p.y > textureSize.y ) discard;

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
  out vec3 vp;

  void main()
  {
    vo = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
    vd = position - vo;
    vp = position;
    gl_Position = czm_modelViewProjection * vec4(position, 1.0);
  }
`;

// Created by David Gallardo - xjorma/2021
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0
const RENDER_SHADER_FRAGMENT_SOURCE = /* glsl */ `
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;

  in vec3 vo;
  in vec3 vd;
  in vec3 vp;

  const vec3 light = vec3(0., 4, 2.);

  vec2 getHeight(in vec3 p)
  {
    vec2 uv = p.xz + 0.5;
    vec2 h = texture(iChannel0, uv).xy;
    h.y += h.x;
    return h - 0.5; // 0 ~ 1转为-0.5 ~ 0.5
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

  vec4 render(in vec3 ro, in vec3 rd) {
    vec3 up = vec3(0., 1., 0.);
    vec2 ret = hitBox(ro, rd);
    if (ret.x > ret.y || ret.x <= 0.) discard;

    vec3 pi = ro + rd * ret.x;
    vec3 pe = ro + rd * ret.y;
    int marchCount = 80;
    float stepLength = 0.4;
    vec2 h = getHeight(pi);

    vec4 tc = vec4(0.);
    vec3 tn;
    float tt = ret.x;
    float spec;

    if (pi.y < h.x) {
      // 地底部分
      discard;
      tn = up;
      tc = vec4(undergroundColor(h.x - pi.y), 1.);
    } else {
      // 找到地上贴近地形的点
      for (int i = 0; i < marchCount; i++) {
        vec3 p = ro + rd * tt;
        float ih = p.y - getHeight(p).x;
        if ((ih >= 0. && ih < 0.0002) || tt > ret.y) break;
        tt += ih * stepLength;
      }

      // tn = getNormal(ro + rd * tt, 0);
      // tc = vec4(terrainColor(ro + rd * tt, tn, spec), 1.);
    }

    // vec3 lightDir = normalize(light - (ro + rd * tt));
    // tc.rgb *= (max( 0.0, dot(lightDir, tn)) + 0.3);
    // spec *= pow(max(0., dot(lightDir, reflect(rd, tn))), 10.0);
    // tc += spec;

    if (tt > ret.y) {
      tc = waterColor;
    }
    float twh = getHeight(ro + rd * tt).y;

    float wt = ret.x;
    float maxStep = min(tt, ret.y);
    // float maxStep = ret.y;
    vec3 waterNormal;

    if (pi.y < h.y) {
      // 水下部分
      waterNormal = up;
    } else {
      // 找到水面上贴近水面的点
      for (int i = 0; i < marchCount; i++) {
        vec3 p = ro + rd * wt;
        float ih = p.y - getHeight(p).y;
        if ((ih >= 0. && ih < 0.0002) || wt > maxStep) break;
        wt += ih * stepLength;
      }
      waterNormal = getNormal(ro + rd * wt, 1);
    }

    if (wt < maxStep) {
      vec3 p = ro + rd * wt;
      float dist = maxStep - wt;
      vec3 lightDir = normalize(light - p);
      tc = applyFog( tc, waterColor, dist * 15.0);
      float spec = pow(max(0., dot(lightDir, reflect(rd, waterNormal))), 20.0);
      tc.rgb += 0.5 * spec * smoothstep(0.0, 0.1, dist);
      // tc = waterColor;
      // if (wt >= tt) tc = vec4(1., 0., 0., 1.);
      // tc.a = 0.5;
    } else {
      discard;
    }

    return tc;
  }

  void main()
  {
    vec3 rayDir = normalize(vd);
    vec4 col = render(vo, rayDir);
    col.xyz *= 2.;
    out_FragColor = col;

    // out_FragColor = vec4(vec3(texture(iChannel1, (vp + 0.5).xz).r), 1);
    // out_FragColor = vec4(vp + 0.5, 1.);
  }
`;

export {
  COMMON,
  BUFFER_A,
  BUFFER_B,
  BUFFER_C,
  BUFFER_D,
  RENDER_SHADER_VERTEX_SOURCE,
  RENDER_SHADER_FRAGMENT_SOURCE,
};
