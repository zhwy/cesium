export default /* glsl */ `
  #define BASE_BRIGHT  vec3(1.20, 1.20, 1.20)    // 基础颜色 -- 亮部
  #define BASE_DARK    vec3(0.31, 0.31, 0.32)    // 基础颜色 -- 暗部
  #define LIGHT_BRIGHT vec3(1.40, 1.40, 1.40)    // 光照颜色 -- 亮部
  #define LIGHT_DARK   vec3(0.70, 0.75, 0.80)    // 光照颜色 -- 暗部

  uniform sampler2D colorTexture;
  uniform sampler2D depthTexture;
  uniform vec3 point1High;
  uniform vec3 point1Low;
  uniform vec3 point2High;
  uniform vec3 point2Low;
  uniform mat4 transform;
  uniform mat4 inverseTransform;
  uniform sampler2D noiseMap;
  uniform sampler2D blueNoiseMap;

  in vec2 v_textureCoordinates;

  float getDepth(vec2 uv) {
    return czm_unpackDepth(texture(czm_globeDepthTexture, uv));
  }

  vec3 getEyeCoordinate(vec2 fragCoord, float depth) {
    vec4 eyeCoordinate4 = czm_windowToEyeCoordinates(fragCoord, depth);
    return eyeCoordinate4.xyz / eyeCoordinate4.w;
  }

  struct OBB {
    vec3 center;      // 中心点
    vec3 halfExtents; // 半长度
    mat3 rotation;    // 旋转矩阵
  };

  struct AABB {
    vec3 min;
    vec3 max;
  };

  // 从两个对角顶点计算OBB，注意OBB局部坐标系是以box中点为0点的ENU坐标系
  OBB createOBBFromPoints(vec3 p1, vec3 p2, mat4 toEye) {
    OBB obb;
    obb.center = (p1 + p2) * 0.5;

    vec4 xAxis4 = toEye * vec4(1.0, 0.0, 0.0, 0.0);
    vec4 yAxis4 = toEye * vec4(0.0, 1.0, 0.0, 0.0);
    vec4 zAxis4 = toEye * vec4(0.0, 0.0, 1.0, 0.0);

    vec3 xAxis = normalize(xAxis4.xyz);
    vec3 yAxis = normalize(yAxis4.xyz);
    vec3 zAxis = normalize(zAxis4.xyz);

    // 计算旋转矩阵，按列填充
    // 最终矩阵的第一列：xAxis.x, xAxis.y, xAxis.z
    // obb.rotation = mat3(
    //   xAxis.x, xAxis.y, xAxis.z,
    //   yAxis.x, yAxis.y, yAxis.z,
    //   zAxis.x, zAxis.y, zAxis.z
    // );
    obb.rotation = mat3(xAxis, yAxis, zAxis);

    // 将点转换到OBB的局部坐标系
    vec3 localP1 = transpose(obb.rotation) * (p1 - obb.center);
    vec3 localP2 = transpose(obb.rotation) * (p2 - obb.center);

    // 计算局部空间中的半长度
    obb.halfExtents = max(abs(localP1), abs(localP2));

    return obb;
  }

  struct IntersectInfo {
    bool hit;
    float tNear;
    float tFar;
  };

  IntersectInfo isIntersect(AABB box, vec3 rayOrigin, vec3 rayDirection) {
    IntersectInfo result;
    result.hit = false;

    vec3 dirInv;
    // 检查每个分量是否平行
    for (int i = 0; i < 3; i++) {
      bool parallel = abs(rayDirection[i]) < 1e-6;

      // 如果平行且射线起点在边界外，立即返回不相交
      if (parallel && (rayOrigin[i] < box.min[i] || rayOrigin[i] > box.max[i])) {
        return result;
      }

      // 安全计算倒数
      dirInv[i] = parallel ? 1e6 : 1.0 / rayDirection[i];
    }

    // 计算与各轴对齐平面的交点
    vec3 t1 = (box.min - rayOrigin) * dirInv;
    vec3 t2 = (box.max - rayOrigin) * dirInv;

    // 获取进入点和离开点的t值
    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);

    // 找到最大的进入t和最小的离开t
    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar = min(min(tMax.x, tMax.y), tMax.z);

    // 判断是否相交
    if (tNear <= tFar && tFar > 0.0) {
      result.hit = true;
      result.tNear = tNear;
      result.tFar = tFar;
    }

    return result;
  }

  IntersectInfo isIntersect(OBB box, vec3 rayOrigin, vec3 rayDirection) {
    // 将射线从眼睛坐标转换到OBB box的局部空间
    vec3 localRayOrigin = transpose(box.rotation) * (rayOrigin - box.center);
    vec3 localRayDirection = transpose(box.rotation) * normalize(rayDirection);

    AABB aabb = AABB(-box.halfExtents, box.halfExtents);
    return isIntersect(aabb, localRayOrigin, localRayDirection);
  }

  float noiseFromMap(vec3 x)
  {
    vec3 p = floor(x);
    vec3 f = fract(x);
    vec3 u = f * f * (3. - 2. * f); // 三次多项式平滑

    vec2 uv = (p.xy + vec2(37.0, 239.0) * p.z) + u.xy;
    vec2 tex = texture(noiseMap,(uv + 0.5) / 512.0, 0.0).yx;

    return mix( tex.x, tex.y, u.z ) * 2.0 - 1.0;
  }

  // 计算梯度
  vec3 grad(vec3 p) {
    // 一个简单的哈希函数
    float h = fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    // 生成随机梯度向量
    return -1.0 + 2.0 * fract(vec3(h * 43758.5453, h * 38746.9213, h * 19283.2371));
  }

  // Perlin噪声实现
  float perlinNoise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);

    // 平滑插值
    vec3 u = f * f * (3.0 - 2.0 * f);

    // 八个角的贡献
    float n000 = dot(grad(p), f);
    float n100 = dot(grad(p + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
    float n010 = dot(grad(p + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
    float n110 = dot(grad(p + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
    float n001 = dot(grad(p + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
    float n101 = dot(grad(p + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
    float n011 = dot(grad(p + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
    float n111 = dot(grad(p + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));

    // 插值混合
    return mix(
      mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
      mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
      u.z
    ); // [-1,1]
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
    vec3 q = p + czm_frameNumber * 0.01 * vec3(1.0, 0., 0.);

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

  float getNoiseSimple(vec2 uv) {
    // 动画
    uv.x += 0.0001 * czm_frameNumber;
    float noise = texture(noiseMap, uv).r;
    noise += texture(noiseMap, uv * 3.5).r / 3.5;
    noise += texture(noiseMap, uv * 12.25).r / 12.25;
    noise += texture(noiseMap, uv * 42.87).r / 42.87;
    noise /= 1.4472;

    return noise;
  }

  float getDensity(AABB box, vec3 point) {
    // return fbm(point * 0.5);

    vec2 uv = ((point - box.min) / (box.max - box.min)).xy;
    return getNoiseSimple(uv * 0.1) * 2. - 1.;
  }

  vec4 getColor(AABB box, vec3 rayOrigin, vec3 rayDirection, IntersectInfo intersectInfo, vec3 lightDir, float offset) {

    vec4 colorSum = vec4(0.); // 积累的颜色

    vec3 point = rayOrigin + rayDirection * intersectInfo.tNear;
    float stepLength = max(max(max(box.max.x, box.max.y), box.max.z) * 0.01, 0.01);
    int count = min(int(length(intersectInfo.tFar - intersectInfo.tNear) / stepLength), 64);
    stepLength = length(intersectInfo.tFar - intersectInfo.tNear) / float(count);

    // ray marching
    for (int i = 0; i < count; i++) {
      if (i == 0) {
        point += rayDirection * stepLength * offset; // 偏移第一个点
      } else {
        point += rayDirection * stepLength;
      }

      float density = getDensity(box, point);
      // density *= 0.2;

      if (density < 0.01) continue;

      vec3 baseColor = mix(vec3(0.), vec3(1.), density);

      vec4 color = vec4(baseColor, density);
      colorSum += color * (1.0 - colorSum.a);
    }

    return colorSum;
  }

  vec4 getColor(OBB box, vec3 rayOrigin, vec3 rayDirection, IntersectInfo intersectInfo, vec3 lightDir, float offset) {
    // 将射线从眼睛坐标转换到OBB box的局部空间
    vec3 localRayOrigin = transpose(box.rotation) * (rayOrigin - box.center);
    vec3 localRayDirection = transpose(box.rotation) * normalize(rayDirection);
    vec3 localLightDir = transpose(box.rotation) * lightDir;

    AABB aabb = AABB(-box.halfExtents, box.halfExtents);

    return getColor(aabb, localRayOrigin, localRayDirection, intersectInfo, localLightDir, offset);
  }

  void main() {
    out_FragColor = texture(colorTexture, v_textureCoordinates);

    // 计算像素点的视口坐标
    float depth = getDepth(v_textureCoordinates);
    if (depth == 0.) depth = 1.; // 天空深度调整
    vec3 pointEC = getEyeCoordinate(gl_FragCoord.xy, depth);

    // 在box的局部坐标系中计算
    // vec4 pointWC4 = (czm_inverseView * vec4(pointEC, 1.)); // 转到世界坐标系
    // vec3 pointWC = pointWC4.xyz / pointWC4.w;
    // vec4 pointLocal4 = inverseTransform * vec4(pointWC, 1.);
    // vec3 pointLocal = pointLocal4.xyz / pointLocal4.w;

    // vec4 rayOriginLocal4 = inverseTransform * vec4(czm_viewerPositionWC, 1.);
    // vec3 rayOrigin = rayOriginLocal4.xyz / rayOriginLocal4.w;

    // vec3 rayDirection = normalize(pointLocal - rayOrigin);

    // vec3 center = (point1 + point2) * 0.5;
    // vec4 rotationCol1 = transform * vec4(1.0, 0.0, 0.0, 0.0);
    // vec4 rotationCol2 = transform * vec4(0.0, 1.0, 0.0, 0.0);
    // vec4 rotationCol3 = transform * vec4(0.0, 0.0, 1.0, 0.0);

    // // obb坐标轴不与世界坐标轴平行，需要计算旋转矩阵
    // mat3 rotation = mat3(
    //   normalize(rotationCol1.xyz),
    //   normalize(rotationCol2.xyz),
    //   normalize(rotationCol3.xyz)
    // );

    // vec3 localP1 = transpose(rotation) * (point1 - center);
    // vec3 localP2 = transpose(rotation) * (point2 - center);

    // vec3 halfExtents = max(abs(localP1), abs(localP2));

    // AABB box = AABB(-halfExtents, halfExtents);

    // 眼睛坐标系计算
    // vec4 point1EC = czm_view * vec4(point1High + point1Low, 1.0);
    // vec4 point2EC = czm_view * vec4(point2High + point2Low, 1.0);
    vec4 point1EC = czm_translateRelativeToEye(point1High, point1Low);
    vec4 point2EC = czm_translateRelativeToEye(point2High, point2Low);
    point1EC = czm_modelViewRelativeToEye * point1EC;
    point2EC = czm_modelViewRelativeToEye * point2EC;

    OBB box = createOBBFromPoints(point1EC.xyz / point1EC.w, point2EC.xyz / point2EC.w, czm_view * transform);

    // 射线原点即眼睛位置
    vec3 rayOrigin = vec3(0.);
    vec3 rayDirection = normalize(pointEC - rayOrigin);

    // 使用屏幕坐标和噪声纹理生成随机偏移
    vec2 screenPos = gl_FragCoord.xy / czm_viewport.zw; // 使用实际分辨率
    float blueNoise = texture(noiseMap, screenPos + czm_frameNumber * 0.0001).r;

    // 使用蓝噪声偏移
    // float offset = fract(blueNoise);
    float offset = 0.;

    IntersectInfo intersectInfo = isIntersect(box, rayOrigin, rayDirection);

    if (intersectInfo.hit && length(pointEC - rayOrigin) >= intersectInfo.tNear) {
      vec3 lightDir = czm_lightDirectionEC;
      vec4 color = getColor(box, rayOrigin, rayDirection, intersectInfo, lightDir, offset);

      out_FragColor = mix(out_FragColor, color, color.a);
    }
  }

`;
