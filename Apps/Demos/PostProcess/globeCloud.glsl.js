export default /* glsl */ `
  uniform sampler2D colorTexture;
  uniform sampler2D noiseMap;
  uniform float earthRadius;

  in vec2 v_textureCoordinates;

  #define MIN_HEIGHT 10000.
  #define MAX_HEIGHT 20000.

  #define CENTER vec3(0.) // 地心

  #define BASE_BRIGHT  vec3(1.00, 1.00, 0.95)    // 基础颜色 -- 亮部
  #define BASE_DARK    vec3(0.31, 0.31, 0.32)    // 基础颜色 -- 暗部
  #define LIGHT_BRIGHT vec3(1.00, 1.00, 0.95)  // 光照颜色 -- 亮部
  #define LIGHT_DARK   vec3(0.7, 0.75, 0.8)      // 光照颜色 -- 暗部

  float getDepth(vec2 uv) {
    return czm_unpackDepth(texture(czm_globeDepthTexture, uv));
  }

  vec3 getWorldCoordinate(vec2 fragCoord, float depth) {
    vec4 eyeCoordinate4 = czm_windowToEyeCoordinates(fragCoord, depth);
    vec4 worldCoordinate4 = czm_inverseView * vec4(eyeCoordinate4.xyz / eyeCoordinate4.w, 1.);
    return worldCoordinate4.xyz / worldCoordinate4.w;
  }

  struct IntersectInfo {
    bool intersected;
    bool inside;
    float minDistance;
    float maxDistance;
  };

  IntersectInfo isIntersectSphere(float radius, vec3 rayOrigin, vec3 rayDirection, vec3 point, bool infinite) {
    vec3 c2o = CENTER - rayOrigin;
    float c2oDistance = length(c2o);
    float d = c2oDistance * dot(normalize(c2o), rayDirection);
    float h = sqrt(c2oDistance * c2oDistance - d * d);
    float c2oDistanceSq = c2oDistance * c2oDistance;
    float radiusSq = radius * radius;
    float hSq = c2oDistanceSq - d * d;

    IntersectInfo info;
    info.intersected = false;
    info.inside = false;
    info.minDistance = -1.0;
    info.maxDistance = -1.0;

    if (hSq >= radiusSq) {
      // 射线错过了球体，相切也算错过，因为步进距离为0
      return info;
    }

    float halfDis = sqrt(radiusSq - hSq);
    float minDistance = d - halfDis;
    float maxDistance = d + halfDis;

    float distance = length(point - rayOrigin);

    if (minDistance > 0.0) {
      // 射线原点在球外部
      info.intersected = distance >= minDistance || infinite;
      info.inside = distance >= minDistance && distance <= maxDistance;
      info.minDistance = minDistance;
      info.maxDistance = maxDistance;
    } else if (maxDistance > 0.0) {
      // 射线原点在球内部
      info.intersected = distance >= maxDistance || infinite;
      info.inside = distance <= maxDistance;
      info.minDistance = 0.0;
      info.maxDistance = maxDistance;
    }

    return info;
  }

  float noiseFromTexture(vec3 x)
  {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = smoothstep(0.0, 1.0, f);

    vec2 uv = (p.xy + vec2(37.0, 17.0) * p.z) + f.xy;
    float v1 = texture( noiseMap, (uv) / 512.0, -100.0 ).x;
    float v2 = texture( noiseMap, (uv + vec2(37.0, 17.0)) / 512.0, -100.0 ).x;
    return mix(v1, v2, f.z);
  }

  // 简单高效的3D噪声
  float noise(vec3 x) {
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
    #define HASH(n) fract(sin(n) * 43758.5453123)

    // 三线性插值混合8个角的值
    return mix(
      mix(mix(HASH(a), HASH(b), u.x), mix(HASH(c), HASH(d), u.x), u.y),
      mix(mix(HASH(e), HASH(f1), u.x), mix(HASH(g), HASH(h), u.x), u.y),
      u.z
    ) * 2.0 - 1.0; // 映射回[-1,1]范围
  }

  float fbm(vec3 p) {
    vec3 q = p + czm_frameNumber * 1e-4 * vec3(1.0, -0.2, -0.0);

    float f = 0.0;
    float scale = 0.5;
    float factor = 2.02;

    for (int i = 0; i < 6; i++) {
      f += scale * noise(q);
      q *= factor;
      factor += 0.21;
      scale *= 0.5;
    }

    return f;
  }

  float getDensity(vec3 point) {
    float noise = fbm(point * 1e-5);

    // 高度衰减
    float normalizedHeight = (length(point - CENTER) - MIN_HEIGHT - earthRadius) / (MAX_HEIGHT - MIN_HEIGHT);
    // 使用更自然的高度分布曲线（类似高斯分布）
    float baseHeight = 0.5; // 云层最浓密的相对高度
    float spread = 0.4;     // 云层垂直分布范围
    float heightFactor = exp(-(normalizedHeight - baseHeight) * (normalizedHeight - baseHeight) / (2.0 * spread * spread));

    // vec2 uv = czm_ellipsoidTextureCoordinates(normalize(point - CENTER)) * 100.;
    // uv.x += 0.00001 * czm_frameNumber;
    // float noise = texture(noiseMap, uv).r;
    // noise += texture(noiseMap, uv * 3.5).r / 3.5;
    // noise += texture(noiseMap, uv * 12.25).r / 12.25;
    // noise += texture(noiseMap, uv * 42.87).r / 42.87;
    // noise /= 1.4472;

    noise = noise * heightFactor;
    // if(noise < 0.4) noise = 0.;

    return noise;
  }

  vec4 getCloud(vec3 rayOrigin, vec3 rayDirection, vec3 start, float marchDistance, vec3 lightDir) {
    float maxStep = marchDistance * 0.05;
    float minStep = marchDistance * 0.01;
    int maxCount = 32;
    float densityScale = 0.5;

    float stepSize = marchDistance / float(maxCount);
    int count = 0;
    vec4 colorSum = vec4(0.); // 积累的颜色
    float stepLength = 0.; // 已经步进的距离


    // ray marching
    // for (int i = 0; i < count; i++) {
    while (count < maxCount) {
      count++;
      if (stepLength > marchDistance) break;
      // IntersectInfo infoLow = isIntersectSphere(earthRadius + MIN_HEIGHT, rayOrigin, rayDirection, point, false);
      // IntersectInfo infoHigh = isIntersectSphere(earthRadius + MAX_HEIGHT, rayOrigin, rayDirection, point, false);
      // if (infoLow.inside || !infoHigh.inside) break;

      vec3 point = start + rayDirection * stepLength;

      float density = getDensity(point);
      // 计算新步长
      // stepSize = clamp(maxStep * pow(1. - density, 0.1), minStep, maxStep);
      stepSize = minStep;
      stepLength += stepSize;

      density *= densityScale;

      if (density < 0.01) continue;
      vec3 baseColor = mix(BASE_BRIGHT, BASE_DARK, density) * density;

      // 计算光照衰减
      float lightTransmittance = 1.0;
      vec3 lightSamplePoint = point;
      const int lightSteps = 2; // 光线步数

      // 计算视线方向与光线方向的夹角余弦值
      float cosAngle = dot(rayDirection, lightDir);

      // 散射系数 (Henyey-Greenstein相位函数简化版)
      float g = 0.2; // 散射非对称参数 (0.0-0.9)
      float phase = 0.5 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosAngle, 1.5);

      // 强化前向散射 (当视线方向接近光线方向时)
      float forwardScatter = pow(max(0.0, cosAngle), 200.0); // 后面的数值越大，透过云层的阳光越聚焦

      for (int j = 0; j < lightSteps; j++) {
        lightSamplePoint += lightDir * marchDistance / float(lightSteps);
        float lightSampleDensity = getDensity(lightSamplePoint);
        lightSampleDensity *= densityScale;
        if (j == 0) {
          // 朝向光源的更亮，背向光源的更暗
          float diffuse = clamp(density - lightSampleDensity, 0.0, 1.0 );
          vec3 lin = LIGHT_DARK * 1.1 + 0.8 * LIGHT_BRIGHT * diffuse;
          baseColor *= lin;
        }
        lightTransmittance *= exp(-lightSampleDensity);
      }

      // 应用光照 - 结合直射光和散射光，环境光
      vec3 scatteredLight = LIGHT_BRIGHT * (phase + forwardScatter) * lightTransmittance;
      vec3 finalColor = baseColor + scatteredLight * 0.01;

      vec4 color = vec4(finalColor, density);
      colorSum += color * (1.0 - colorSum.a);

      if (colorSum.a > 0.95) break;
    }

    // 计算视线方向与地平线方向的夹角
    vec3 upDirection = normalize(rayOrigin - CENTER);
    // 地平线因子，越接近地平线越接近0
    float horizonFactor = abs(dot(rayDirection, upDirection));
    // 在地平线附近减少云层，增加模糊感
    colorSum = mix(vec4(0.), colorSum, smoothstep(0.0, 0.1, horizonFactor));

    return colorSum;
  }


  void main() {
    out_FragColor = texture(colorTexture, v_textureCoordinates);

    float depth = getDepth(v_textureCoordinates);
    bool infinite = depth == 0.; // 是否无限远处
    if (infinite) {
      depth = 1.;
    }
    // 如果想要实现云层中的效果，下方需要注释掉
    // else {
    //   return;
    // }

    vec3 worldCoordinate = getWorldCoordinate(gl_FragCoord.xy, depth);

    vec3 rayOrigin = czm_viewerPositionWC;
    vec3 rayDirection = normalize(worldCoordinate - rayOrigin);

    IntersectInfo info;
    IntersectInfo info2;
    bool intersected = false;
    vec3 start;
    float marchDistance = 0.;

    float radius1 = earthRadius + MIN_HEIGHT;
    float radius2 = earthRadius + MAX_HEIGHT;

    if (czm_eyeHeight < MIN_HEIGHT) {
      // 低于云层
      info = isIntersectSphere(radius1, rayOrigin, rayDirection, worldCoordinate, infinite);
      start = rayOrigin + rayDirection * info.maxDistance;
      if (info.intersected) {
        // 此时是看向天空的，与云层顶部也一定相交
        info2 = isIntersectSphere(radius2, rayOrigin, rayDirection, worldCoordinate, infinite);
        marchDistance = info2.maxDistance - info.maxDistance;
      }
    } else if (czm_eyeHeight < MAX_HEIGHT) {
      // 处于云层中
      info = isIntersectSphere(radius1, rayOrigin, rayDirection, worldCoordinate, infinite);
      if (info.intersected) {
        // 透过云层底部
        marchDistance = info.minDistance;
      } else {
        // 在云层中
        info2 = isIntersectSphere(radius2, rayOrigin, rayDirection, worldCoordinate, infinite);
        marchDistance = info2.maxDistance;
        // out_FragColor = vec4(marchDistance / 300000.);
        // return;
      }

      info.intersected = true;
      start = rayOrigin;
    } else {
      // 高于云层
      // if (czm_eyeHeight > 5. * MAX_HEIGHT) {
      //   return;
      // }

      info = isIntersectSphere(radius2, rayOrigin, rayDirection, worldCoordinate, infinite);
      start = rayOrigin + rayDirection * info.minDistance;
      if (info.intersected) {
        info2 = isIntersectSphere(radius1, rayOrigin, rayDirection, worldCoordinate, infinite);
        if (info2.intersected) {
          // 透过云层底部
          marchDistance = info2.minDistance - info.minDistance;
        } else {
          // 在云层中
          marchDistance = info.maxDistance - info.minDistance;
        }

      }
    }

    if (info.intersected) {
      vec4 color = getCloud(rayOrigin, rayDirection, start, marchDistance, czm_lightDirectionWC);
      out_FragColor = vec4(out_FragColor.xyz * (1. - color.a) + color.xyz, 1.);
    }
  }
`;
