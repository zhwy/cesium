export default /* glsl */ `
  uniform sampler2D colorTexture;
  uniform sampler2D depthTexture;
  uniform sampler2D noiseMap;
  uniform sampler2D coverageMap;
  uniform float earthRadius;
  uniform vec2 heightRange;

  in vec2 v_textureCoordinates;

  #define CENTER vec3(0.) // 地心

  #define BASE_BRIGHT  vec3(1.00, 1.00, 0.95)    // 基础颜色 -- 亮部
  #define BASE_DARK    vec3(0.31, 0.31, 0.32)    // 基础颜色 -- 暗部
  #define LIGHT_BRIGHT vec3(1.00, 1.00, 0.95)  // 光照颜色 -- 亮部
  #define LIGHT_DARK   vec3(0.7, 0.75, 0.8)      // 光照颜色 -- 暗部

  float getDepth(vec2 uv) {
    return czm_unpackDepth(texture(depthTexture, uv));
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

    if (hSq > radiusSq) {
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

  float remap(float value, float min1, float max1, float min2, float max2) {
    return min2 + (max2 - min2) * ((value - min1) / (max1 - min1));
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
    #define HASH(n) fract(sin(n) * 43758.5453123)

    // 三线性插值混合8个角的值
    return mix(
      mix(mix(HASH(a), HASH(b), u.x), mix(HASH(c), HASH(d), u.x), u.y),
      mix(mix(HASH(e), HASH(f1), u.x), mix(HASH(g), HASH(h), u.x), u.y),
      u.z
    ) * 2.0 - 1.0; // 映射回[-1,1]范围
  }

  vec3 rand3D(vec3 p) {
    float h = fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    return fract(vec3(h * 43758.5453, h * 38746.9213, h * 19283.2371));
  }

  float worleyNoise(vec3 p) {
    // // 当前体素（整数坐标）
    // vec3 i = floor(p);
    // vec3 f = fract(p);

    // float minDist = 1e10; // 最小距离初始化为最大值

    // // 遍历当前体素及其相邻26个体素（3x3x3）
    // for (int x = -1; x <= 1; x++) {
    //   for (int y = -1; y <= 1; y++) {
    //     for (int z = -1; z <= 1; z++) {
    //       // 相邻体素坐标
    //       vec3 neighbor = vec3(x, y, z);
    //       vec3 cell = i + neighbor;

    //       // 为该体素生成一个随机特征点
    //       vec3 point = rand3D(cell);

    //       // 计算当前片段到特征点的距离（欧几里得距离）
    //       float dist = length(neighbor + point - f);

    //       // 更新最小距离
    //       minDist = min(minDist, dist);
    //     }
    //   }
    // }

    // return 1. - smoothstep(0.0, 1.0, minDist);
    float value = cellular2x2x2(p).x;
    return 1. - smoothstep(0.0, 1.0, value);
  }

  #define GRDIENT_NOISE
  // #define WORLEY_NOISE

  float noise(vec3 x) {
    #ifdef GRDIENT_NOISE
    return noise3D(x);
    #endif

    #ifdef WORLEY_NOISE
    return worleyNoise(x);
    #endif

  }

  float noise(vec2 uv) {
    return texture(noiseMap, uv).r * 2.0 - 1.0; // 映射回[-1,1]范围
  }

  float fbm(vec3 p) {
    vec3 q = p + czm_frameNumber * 2e-4 * vec3(1.0, -0.2, -0.0);

    float f = 0.0;
    float scale = 0.5;
    float factor = 2.02;
    float maxScale = 0.;

    for (int i = 0; i < 6; i++) {
      f += scale * noise(q);
      q *= factor;
      factor += 0.21;
      maxScale += scale;
      scale *= 0.5;
    }

    return f / maxScale;
  }

  float perlinFbm(vec3 p) {
    vec3 q = p + czm_frameNumber * 1e-4 * vec3(1.0, -0.2, -0.0);

    float f = 0.0;
    float scale = 0.5;
    float factor = 2.02;
    float maxScale = 0.;

    for (int i = 0; i < 6; i++) {
      f += scale * noise3D(q);
      q *= factor;
      factor += 0.21;
      maxScale += scale;
      scale *= 0.5;
    }

    return f / maxScale;
  }

  float worleyFbm(vec3 p) {
    vec3 q = p; // + czm_frameNumber * 1e-4 * vec3(1.0, -0.2, -0.0);
    return worleyNoise(q) * 0.625 +
           worleyNoise(q * 2.) * 0.25 +
           worleyNoise(q * 4.) * 0.125;
  }

  float fbm(vec2 p) {
    vec2 q = p;

    // 简易fbm
    // float noise = texture(noiseMap, q).r / 2.;
    // noise += texture(noiseMap, q * 3.5).r / 3.5;
    // noise += texture(noiseMap, q * 12.25).r / 12.25;
    // noise += texture(noiseMap, q * 42.87).r / 42.87;
    // noise /= 1.4472;
    // return noise;

    float f = 0.0;
    float scale = 1.;
    float factor = 2.02;
    float maxScale = 0.;

    for (int i = 0; i < 6; i++) {
      f += scale * noise(q);
      q *= factor;
      factor += 0.21;
      maxScale += scale;
      scale *= 0.5;
    }

    return f / maxScale;
  }

  float perlinWorleyNoise(vec3 p) {
    // https://www.shadertoy.com/view/3dVXDc
    float pfbm = mix(1., perlinFbm(p) * 0.5 + 0.5, 0.5);
    pfbm = abs(pfbm * 2. - 1.);

    float wfbm1 = worleyFbm(p);
    // float wfbm2 = worleyFbm(p * 2e-6);
    // float wfbm4 = worleyFbm(p * 4e-6);
    // float wfbm = wfbm1 * 0.625 + wfbm2 * 0.25 + wfbm4 * 0.125;
    float wfbm = wfbm1;

    float value = remap(pfbm, 0., 1., wfbm1, 1.); // perlin-worley
    // value = remap(value, wfbm - 1., 1., 0., 1.);
    // value = remap(value, 0.85, 1., 0., 1.);
    return value;
  }

  #define MODE 1

  float getDensity(vec3 point) {
    // 将世界坐标转换为2D纹理坐标
    vec2 uv = czm_ellipsoidTextureCoordinates(normalize(point / earthRadius));
    float coverage = texture(coverageMap, uv).x;
    float normalizedHeight = (length(point - CENTER) - heightRange.x - earthRadius) / (heightRange.y - heightRange.x);

    #if MODE == 0
    float value = fbm(uv);
    if (value < 0.0)  return 0.0;
    // 底部厚，顶部稀
    float heightFactor = clamp(remap(normalizedHeight, 0.0, coverage, 1., 0.), 0., 1.);
    #endif

    #if MODE == 1
    float value = fbm(point * 1e-4);
    // value = mix(1., value * 0.5 + 0.5, 0.5);
    // value = abs(value * 2. - 1.);
    // 中间厚边缘稀
    float baseHeight = 0.5; // 云层最浓密的相对高度
    float spread = 0.1;     // 云层垂直分布范围
    float heightFactor = exp(-(normalizedHeight - baseHeight) * (normalizedHeight - baseHeight) / (2.0 * spread * spread));
    #endif

    #if MODE == 3
    float value = 1.;
    float noise = perlinWorleyNoise(point * 1e-5);
    // float heightFactor = clamp(remap(normalizedHeight, 0.75, 1.0, 1., 0.), 0., 1.);
    // float heightFactor = normalizedHeight;
    float heightFactor = 1. - normalizedHeight;
    value *= heightFactor;
    value = clamp(remap(value, noise, 1., 0., 1.), 0., 1.) * 0.5 * coverage * coverage;

    #endif

    value = value * heightFactor;
    value = clamp(value, 0.0, 1.0);

    return value;
  }

  vec4 getCloud(vec3 rayOrigin, vec3 rayDirection, vec3 start, float marchDistance, vec3 lightDir) {
    if (marchDistance < 0.1) return vec4(0.);

    float maxStep = marchDistance * 0.1;
    float minStep = marchDistance * 0.05;
    const int maxCount = 32;
    float densityScale = 1.;

    float stepSize = marchDistance / float(maxCount);
    int count = 0;
    vec4 colorSum = vec4(0.); // 积累的颜色
    float stepLength = 0.; // 已经步进的距离
    float startToOriginDistance = length(start - rayOrigin);

    // ray marching
    // for (int i = 0; i < count; i++) {
    while (true) {
      count++;
      if (stepLength > marchDistance) break;

      vec3 point = start + rayDirection * stepLength;
      float density = getDensity(point);
      // // 动态改变步长
      // if (density > 0.05) {
      //   // 高密度区域：减小步长
      //   stepSize = max(minStep, stepSize * 0.5);
      // } else {
      //   // 低密度区域：增大步长
      //   stepSize = min(maxStep, stepSize * 1.05);
      // }
      stepLength += stepSize;
      density *= densityScale;

      // float pointToOriginDistance = startToOriginDistance + stepLength;
      // float distanceFactor = smoothstep(0.01, 1., pointToOriginDistance / 1000.); // 距离衰减，靠近相机时减少云的密度
      // density *= distanceFactor;

      if (density < 0.01) continue;

      vec3 baseColor = mix(BASE_BRIGHT, BASE_DARK, density) * density;

      #ifdef ADD_LIGHT
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
      #else
      vec3 finalColor = baseColor;
      #endif

      vec4 color = vec4(finalColor, density);
      colorSum += color * (1.0 - colorSum.a);

      if (colorSum.a > 0.95) break;
    }

    // // 计算视线方向与地平线方向的夹角
    // vec3 upDirection = normalize(rayOrigin - CENTER);
    // // 地平线因子，越接近地平线越接近0
    // float horizonFactor = abs(dot(rayDirection, upDirection));
    // // 在地平线附近减少云层，增加模糊感
    // colorSum = mix(vec4(0.), colorSum, smoothstep(0.0, 0.1, horizonFactor));

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
    // test
    // vec2 uv = czm_ellipsoidTextureCoordinates(normalize(worldCoordinate / earthRadius));
    // // out_FragColor.rgb = vec3(uv, 0.);
    // float noiseValue = texture(coverageMap, uv).x;
    // if (noiseValue < 0.9) {
    //   noiseValue = 0.;
    // };
    // out_FragColor.rgb = vec3(noiseValue);
    // return;

    vec3 rayOrigin = czm_viewerPositionWC;
    vec3 rayDirection = normalize(worldCoordinate - rayOrigin);

    IntersectInfo info;
    IntersectInfo info2;
    bool intersected = false;
    vec3 start;
    float marchDistance = 0.;

    float radius1 = earthRadius + heightRange.x;
    float radius2 = earthRadius + heightRange.y;

    if (czm_eyeHeight < heightRange.x) {
      // 低于云层
      info = isIntersectSphere(radius1, rayOrigin, rayDirection, worldCoordinate, infinite);
      start = rayOrigin + rayDirection * info.maxDistance;
      if (info.intersected) {
        // 此时是看向天空的，与云层顶部也一定相交
        info2 = isIntersectSphere(radius2, rayOrigin, rayDirection, worldCoordinate, infinite);
        marchDistance = info2.maxDistance - info.maxDistance;
      }
    } else if (czm_eyeHeight < heightRange.y) {
      // 处于云层中
      info = isIntersectSphere(radius1, rayOrigin, rayDirection, worldCoordinate, infinite);
      if (info.intersected) {
        // 透过云层底部
        marchDistance = info.minDistance;
      } else {
        // 在云层中
        info2 = isIntersectSphere(radius2, rayOrigin, rayDirection, worldCoordinate, infinite);
        marchDistance = info2.maxDistance;
      }

      info.intersected = true;
      start = rayOrigin;
    } else {
      // 高于云层
      // if (czm_eyeHeight > 5. * heightRange.y) {
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
      out_FragColor = vec4(out_FragColor.rgb * (1. - color.a) + color.rgb, 1.);
    }
  }
`;
