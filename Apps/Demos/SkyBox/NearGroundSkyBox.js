/**
 * NearGroundSkyBox - 近地天空盒
 *
 * 解决标准 SkyBox 在近地时因使用 TEME 惯性坐标系而导致的倾斜问题。
 * 每帧根据相机当前位置计算本地 ENU（东北天）旋转矩阵，
 * 使天空盒始终与本地地平面保持对齐。
 *
 * 用法:
 *   import NearGroundSkyBox from "./NearGroundSkyBox.js";
 *   const skyBox = new NearGroundSkyBox(Cesium, {
 *     sources: { positiveX, negativeX, positiveY, negativeY, positiveZ, negativeZ }
 *   });
 *   viewer.scene.skyBox = skyBox;
 *
 * 图像坐标约定（ENU 框架）：
 *   positiveZ / negativeZ → 天顶 / 地面
 *   positiveY / negativeY → 北 / 南
 *   positiveX / negativeX → 东 / 西
 */
export default class NearGroundSkyBox {
  /**
   * @param {object} Cesium - Cesium 命名空间对象
   * @param {object} options
   * @param {object} options.sources - 六面体贴图 URL，键为 positiveX/negativeX/positiveY/negativeY/positiveZ/negativeZ
   * @param {boolean} [options.show=true] - 是否显示
   */
  constructor(Cesium, options) {
    this._Cesium = Cesium;

    // 每帧复用的矩阵，避免 GC 压力
    this._enuMatrix4 = new Cesium.Matrix4();
    this._enuMatrix3 = new Cesium.Matrix3();

    // 用一个可变对象持有当前变换，uniform 闭包会读取同一个引用
    this._currentTransform = new Cesium.Matrix3();

    this._panorama = new Cesium.CubeMapPanorama({
      sources: options.sources,
      show: options.show ?? true,
      returnCommand: true,
      // 提供初始 transform 以触发 CubeMapPanoramaVS 着色器路径
      transform: this._currentTransform,
    });
  }

  /** 天空盒贴图资源 */
  get sources() {
    return this._panorama.sources;
  }
  set sources(value) {
    this._panorama.sources = value;
  }

  /** 是否显示 */
  get show() {
    return this._panorama.show;
  }
  set show(value) {
    this._panorama.show = value;
  }

  /**
   * Scene 每帧调用此方法获取绘制命令。
   * 在此处更新 ENU 旋转矩阵，消除倾斜。
   * @param {FrameState} frameState
   * @param {boolean} useHdr
   * @returns {DrawCommand|undefined}
   */
  update(frameState, useHdr) {
    const { _Cesium: Cesium, _panorama: panorama } = this;

    if (!this.show) {
      return undefined;
    }

    const cameraPosition = frameState.camera.position;

    // 计算相机所在位置的 ENU（东北天）本地坐标系
    Cesium.Transforms.eastNorthUpToFixedFrame(
      cameraPosition,
      Cesium.Ellipsoid.WGS84,
      this._enuMatrix4,
    );

    // 提取旋转部分（3×3），丢弃平移
    Cesium.Matrix4.getMatrix3(this._enuMatrix4, this._enuMatrix3);

    // 将结果复制到 _currentTransform（uniform 读取同一对象）
    Cesium.Matrix3.clone(this._enuMatrix3, this._currentTransform);

    // 直接更新 CubeMapPanorama 内部的 _transform，使 uniform 拾取新值
    // （CubeMapPanorama 的 u_cubeMapPanoramaTransform uniform 通过闭包读取 _transform）
    panorama._transform = this._currentTransform;

    return panorama.update(frameState, useHdr);
  }

  /** @returns {boolean} */
  isDestroyed() {
    return false;
  }

  /**
   * 释放 WebGL 资源。
   * @example
   *   skyBox = skyBox && skyBox.destroy();
   */
  destroy() {
    this._panorama = this._panorama && this._panorama.destroy();
    return this._Cesium.destroyObject(this);
  }
}
