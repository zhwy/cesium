export default /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float earthRadius;
uniform float fogHeight;
uniform float maxAlpha;
uniform vec4 fogNearFar;
uniform sampler2D noiseMap;
uniform vec3 point1High;
uniform vec3 point1Low;
uniform vec3 point2High;
uniform vec3 point2Low;
uniform mat4 transform;
uniform float densityFactor;
uniform float noiseUvScale;
uniform float adjust;

in vec2 v_textureCoordinates;

float getDepth(vec2 uv) {
  return czm_unpackDepth(texture(depthTexture, uv));
}

vec3 getEyeCoordinate(vec2 fragCoord, float depth) {
  vec4 eyeCoordinate4 = czm_windowToEyeCoordinates(fragCoord, depth);
  return eyeCoordinate4.xyz / eyeCoordinate4.w;
}

vec3 getWorldCoordinateFromEye(vec3 eyeCoord) {
  vec4 worldCoordinate4 = czm_inverseView * vec4(eyeCoord, 1.);
  return worldCoordinate4.xyz / worldCoordinate4.w;
}

struct FogInfo {
  bool intersected;
  float minDistance;
  float maxDistance;
  float minH;
  float maxH;
  float theta;
  bool inside;
};

FogInfo intersectFog(vec3 rayOrigin, vec3 rayDirection, vec3 pointWC, out vec4 out_FragColor) {
  FogInfo info;
  info.intersected = false;
  float pointH = max(length(pointWC) - earthRadius, 0.);

  vec3 normal = normalize(pointWC / earthRadius);
  float theta = dot(-normal, rayDirection);
  float dist = length(pointWC - rayOrigin);

  float h = czm_eyeHeight - fogHeight;
  if (h < 0.) {
    // 视角在雾中
    info.intersected = true;
    info.minDistance = 0.;
    info.minH = czm_eyeHeight;
    info.maxH = min(pointH, fogHeight);
    info.theta = theta;
    info.inside = true;
    float height = abs(h);
    if (theta > 0.) {
      height = czm_eyeHeight;
      info.minH = pointH;
      info.maxH = czm_eyeHeight;
    }
    info.maxDistance = min(dist, height / max(abs(theta), 0.01));
    // if (info.maxDistance != dist) {
    //   out_FragColor.rgb = vec3(1., 0., 0.);
    // }
    return info;
  }

  float sinTheta = (fogHeight + earthRadius) / (czm_eyeHeight + earthRadius);
  float minTheta = sqrt(1. - sinTheta * sinTheta);
  if (theta < minTheta) { // 不相交
    return info;
  }

  info.minDistance = h / theta;
  info.maxDistance = dist;
  info.intersected = dist > info.minDistance;
  info.theta = theta;
  info.minH = pointH;
  info.maxH = fogHeight;
  info.inside = false;
  return info;
}

float simpleLinearHeightFog(float height) {
  float fog = clamp(1.0 - height / fogHeight, 0.0, maxAlpha);
  return fog;
}

float integrationLinearHeightFog(FogInfo fogInfo) {
  if (!fogInfo.intersected) return 0.;

  float fog = 0.;
  float x1 = fogInfo.minH;
  float x2 = fogInfo.maxH;
  if (abs(fogInfo.theta) < 0.01) { // 雾中平视，积分计算为0
    fog = simpleLinearHeightFog(x1) * (fogInfo.maxDistance - fogInfo.minDistance) * 0.1 * maxAlpha;
  } else {
    float y1 = simpleLinearHeightFog(x1);
    float y2 = simpleLinearHeightFog(x2);
    // 积分
    fog = ((x2 - x1) * y2 + 0.5 * (x2 - x1) * abs(y2 - y1)) / abs(fogInfo.theta) * 0.1 * maxAlpha;
  }
  fog = mix(0.0, maxAlpha, fog / (fog + 1.0));
  return fog;
}

float simpleLinearDistanceFog(vec3 eyeCoord) {
  float startDistance = fogNearFar.x;
  float startValue = fogNearFar.y;
  float endDistance = fogNearFar.z;
  float endValue = fogNearFar.w;
  float dis = length(eyeCoord);
  float disRate = clamp((dis - startDistance) / (endDistance - startDistance), 0.0, 1.0);
  float fog = mix(startValue, endValue, disRate);

  return fog;
}

const float attenuation = 1.;

float exponentialHeightFog(float height, bool integration) {
  float normalizedHeight = height / fogHeight;
  if (integration) {
    return maxAlpha * (exp(-attenuation * normalizedHeight) / -attenuation - exp(-attenuation) * normalizedHeight);
  } else {
    return maxAlpha * (exp(-attenuation * normalizedHeight) - exp(-attenuation));
  }
}

float remap(float value, float oldMin, float oldMax, float newMin, float newMax) {
  return newMin + (newMax - newMin) * ((value - oldMin) / (oldMax - oldMin));
}

float integrationExponentialHeightFog(FogInfo fogInfo, vec3 pointEC, out vec4 out_FragColor, float depth) {
  if (!fogInfo.intersected) return 0.;

  float fog = 0.;
  float x1 = fogInfo.minH;
  float x2 = fogInfo.maxH;
  // 平滑过渡范围
  const float transitionThreshold = 0.002;
  const float pixel = 10.; // 根据transitionThreshold来确定范围
  float thetaAbs = abs(fogInfo.theta);
  float cameraHeight = mix(x1, x2, step(0., fogInfo.theta));
  float density = exponentialHeightFog(cameraHeight, false);

  // 想通过采样transitionThreshold附近像素点来平滑过渡积分接近0的情况，但是效果不理想，最终还是采用射线步进
  if (thetaAbs < transitionThreshold) {
    // 雾中平视，积分计算接近0
    float scale = remap(fogInfo.theta, -transitionThreshold, transitionThreshold, 0., 1.);
    float pixelUp = scale * pixel;
    float pixelDown = pixel - pixelUp;

    // 向上采样
    vec3 pointEC1 = getEyeCoordinate(gl_FragCoord.xy + vec2(0., pixelUp), getDepth((gl_FragCoord.xy + vec2(0., pixelUp)) / czm_viewport.zw));
    vec3 worldEC1 = getWorldCoordinateFromEye(pointEC1);
    float height1 = max(length(worldEC1) - earthRadius, 0.);
    // 向下采样
    vec3 pointEC2 = getEyeCoordinate(gl_FragCoord.xy - vec2(0., pixelDown), getDepth((gl_FragCoord.xy - vec2(0., pixelDown)) / czm_viewport.zw));
    vec3 worldEC2 = getWorldCoordinateFromEye(pointEC2);
    float height2 = max(length(worldEC2) - earthRadius, 0.);

    float ymax = exponentialHeightFog(height1, true);
    float ymin = exponentialHeightFog(height2, true);
    float ycam = exponentialHeightFog(cameraHeight, true);

    float up = (ymax - ycam) * 1. / transitionThreshold;
    up = mix(0.0, maxAlpha, up / (up + 1.0));

    float down = (ycam - ymin) * 1. / transitionThreshold;
    down = mix(0.0, maxAlpha, down / (down + 1.0));

    fog = mix(up, down, scale);
    // fog = exponentialHeightFog(height1, false);
    // fog = scale;
    // fog = 1.;
  }
  else {
    float y1 = exponentialHeightFog(x1, true);
    float y2 = exponentialHeightFog(x2, true);
    fog = (y2 - y1) / thetaAbs;
    fog = mix(0.0, maxAlpha, fog / (fog + 1.0));
  }

  // out_FragColor.rgb = vec3(fog);
  return fog;
}

// 简化3D梯度噪声
float noise3D(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);

  // 平滑插值
  vec3 u = f * f * (3.0 - 2.0 * f);

  // 哈希查找8个格点值
  vec3 r = vec3(127.1, 311.7, 74.7);
  float a = dot(i, r);
  float b = dot(i + vec3(1.0, 0.0, 0.0), r);
  float c = dot(i + vec3(0.0, 1.0, 0.0), r);
  float d = dot(i + vec3(1.0, 1.0, 0.0), r);
  float e = dot(i + vec3(0.0, 0.0, 1.0), r);
  float f1 = dot(i + vec3(1.0, 0.0, 1.0), r);
  float g = dot(i + vec3(0.0, 1.0, 1.0), r);
  float h = dot(i + vec3(1.0, 1.0, 1.0), r);

  // 哈希函数
  #define HASH(n) fract(sin(n) * 43758.5453123) // 0..1

  // 三线性插值混合8个角的值
  return mix(
    mix(mix(HASH(a), HASH(b), u.x), mix(HASH(c), HASH(d), u.x), u.y),
    mix(mix(HASH(e), HASH(f1), u.x), mix(HASH(g), HASH(h), u.x), u.y),
    u.z
  ) * 2.0 - 1.0; // -1..1
}

float noise(vec3 p) {

  // vec2 uv = czm_ellipsoidTextureCoordinates(normalize(p / earthRadius));
  // return texture(noiseMap, uv).r * 2.0 - 1.0; // 映射回[-1,1]范围
  return noise3D(p);
}

float fbm(vec3 p) {
  vec3 q = p;

  float f = 0.0;
  float scale = 0.5;
  float factor = 2.;
  float maxScale = 0.;

  for (int i = 0; i < 6; i++) {
    f += scale * noise(q);
    q *= factor;
    // factor += 0.21;
    maxScale += scale;
    scale *= 0.5;
  }

  return f / maxScale; // -1..1
}

float getDensity(vec3 p) {
  // 分别计算每个轴的边界因子
  vec3 absP = abs(p);
  float edgeThickness = 0.3;

  // 对每个轴应用平滑过渡
  vec3 edgeFactors;
  edgeFactors.x = smoothstep(1.0, 1.0 - edgeThickness, absP.x);
  edgeFactors.y = smoothstep(1.0, 1.0 - edgeThickness, absP.y);
  edgeFactors.z = 0.5 - p.z * 0.5;// smoothstep(1.0, 1.0 - edgeThickness, absP.z);

  // 组合边界因子
  float edgeFactor = edgeFactors.x * edgeFactors.y * edgeFactors.z;

  vec3 q = p * 10.;

  float value = fbm(q);

  return clamp(value * edgeFactor, 0., 1.);
}

#define METHOD 4

#define FOG_COLOR vec3(1.)

void main() {
  out_FragColor = texture(colorTexture, v_textureCoordinates);

  float depth = getDepth(v_textureCoordinates);
  if (depth == 0.) return;

  vec3 pointEC = getEyeCoordinate(gl_FragCoord.xy, depth);
  vec3 targetWC = getWorldCoordinateFromEye(pointEC);
  vec3 normalWC = normalize(targetWC);
  float dist = length(pointEC);

  // 扰动
  float noise = fbm(normalize(targetWC) * noiseUvScale + czm_frameNumber * 0.01 * vec3(1., -0.2, 0.));
                // + 0.5 * fbm(targetWC * 2e-2 + czm_frameNumber * 0.01 * vec3(-0.2, 1., 0.));
  // noise = abs(noise);
  // noise = noise * 0.5 + 0.5;
  noise *= mix(1., 0., clamp(-pointEC.z / 5000., 0., 1.));
  // targetWC += normalWC * noise * 1000.;
  // out_FragColor.rbg = vec3(noise) * 0.8 + out_FragColor.rbg * 0.2;// * 0.5 + out_FragColor.rgb * 0.5;
  // return;

  vec3 rayOrigin = czm_viewerPositionWC;
  vec3 rayDirection = normalize(targetWC - czm_viewerPositionWC);
  FogInfo fogInfo = intersectFog(rayOrigin, rayDirection, targetWC, out_FragColor);
  vec4 colorSum = vec4(0.);
  float distanceScale = smoothstep(50., 500., dist);

  #if METHOD == 1 // 线性高度雾
  float fog = integrationLinearHeightFog(fogInfo);
  colorSum = vec4(FOG_COLOR, fog);

  #elif METHOD == 2 // 指数高度雾
  float fog = integrationExponentialHeightFog(fogInfo, pointEC, out_FragColor, depth);
  // return;
  // fog += noise * step(0.01, fog) * 0.5;
  // fog = clamp(fog, 0., maxAlpha);
  colorSum = vec4(FOG_COLOR, fog);

  #elif METHOD == 3 // 线性深度雾
  float fog = simpleLinearDistanceFog(pointEC);
  colorSum = vec4(FOG_COLOR, fog);

  #elif METHOD == 4 // 射线步进
  float marchDistance = fogInfo.maxDistance - fogInfo.minDistance;
  const int marchCount = 5;
  float marchStep = max(marchDistance / float(marchCount), 0.1);
  vec3 start = rayOrigin + rayDirection * fogInfo.minDistance;
  float fog = 0.;

  if (fogInfo.intersected) {
    for(int i = 0; i < marchCount; i++) {
      float marched = marchStep * float(i);
      if (marched > marchDistance) break;
      vec3 point = rayDirection * marched + start;
      float height = max(length(point) - earthRadius, 0.);
      fog += exponentialHeightFog(height, false) * distanceScale;
    }
    fog = mix(0.0, maxAlpha, fog / (fog + 0.1));
  }
  colorSum = vec4(FOG_COLOR, fog);

  #endif

  out_FragColor.rgb = out_FragColor.rgb * (1.0 - colorSum.a) + colorSum.rgb * colorSum.a;
}
`;
