import * as Cesium from "../../../../Build/CesiumUnminified/index.js";

let modifiedProjection; // 会在多个实例中共享，因此场景中只能有一个反射平面

export default class Reflector {
  constructor({ viewer, height }) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.camera = viewer.camera;
    this.height = height;

    this.camera2 = new Cesium.Camera(viewer.scene);
    this.encodedReflectorCameraPosition = new Cesium.EncodedCartesian3();
    this.camera2.name = "reflector-camera";
    this.view2 = new Cesium.View(
      viewer.scene,
      this.camera2,
      viewer.scene._defaultView.viewport,
    );

    this.originView = viewer.scene._defaultView;

    this.texureRenderState = Cesium.RenderState.fromCache({});

    this.textureMatrix = Cesium.Matrix4.IDENTITY;
    this.reflectorTexture = undefined;
    this.framebuffer = undefined;
    this.drawCommand = undefined;
    this.initialized = false;

    this._initialize(viewer.scene.context);
  }
  update(frameState) {}
  isDestroyed() {
    return false;
  }
  debugCameras() {
    if (this._debugCamera1) {
      this.viewer.scene.primitives.remove(this._debugCamera1);
      this.viewer.scene.primitives.remove(this._debugCamera2);
    }

    this._debugCamera1 = this.viewer.scene.primitives.add(
      new Cesium.DebugCameraPrimitive({
        camera: Cesium.Camera.clone(this.camera),
        color: Cesium.Color.RED,
      }),
    );
    this._debugCamera2 = this.viewer.scene.primitives.add(
      new Cesium.DebugCameraPrimitive({
        camera: Cesium.Camera.clone(this.camera2),
        color: Cesium.Color.BLUE,
      }),
    );
  }
  _initialize(context) {
    this.reflectorTexture = new Cesium.Texture({
      width: context.drawingBufferWidth,
      height: context.drawingBufferHeight,
      context,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      flipX: false,
      flipY: false,
    });

    this.framebuffer = new Cesium.Framebuffer({
      context,
      colorTextures: [this.reflectorTexture],
      depthStencilTexture: new Cesium.Texture({
        context: context,
        width: context.drawingBufferWidth,
        height: context.drawingBufferHeight,
        pixelFormat: Cesium.PixelFormat.DEPTH_STENCIL,
        pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT_24_8,
      }),
    });

    this.view2.passState.framebuffer = this.framebuffer;

    // 强制更改投影矩阵
    const originalUniformStateUpdateFrustum =
      context.uniformState.updateFrustum;
    context.uniformState.updateFrustum = function (frustum) {
      if (modifiedProjection) {
        Cesium.Matrix4.clone(modifiedProjection, frustum.projectionMatrix);
      }

      originalUniformStateUpdateFrustum.call(this, frustum);
    };

    /** 由于Cesium的scene渲染流程特性，_overlayCommandList绑在了scene上，在渲染流程中共享，开始渲染时需清空数组，所以目前只能将反射面渲染放在场景渲染之前。 */
    this.scene.preUpdate.addEventListener(() => {
      this.renderTexture();
    });

    this.initialized = true;
  }
  renderTexture() {
    const planeNormal = Cesium.Cartesian3.normalize(
      this.camera.positionWC,
      new Cesium.Cartesian3(),
    );
    const cameraToPlaneDistance =
      this.camera.positionCartographic.height - this.height;

    const dotProduct = Cesium.Cartesian3.dot(
      this.camera.direction,
      planeNormal,
    );
    const scaledNormal = Cesium.Cartesian3.multiplyByScalar(
      planeNormal,
      2.0 * dotProduct,
      new Cesium.Cartesian3(),
    );
    const reflection = Cesium.Cartesian3.subtract(
      this.camera.direction,
      scaledNormal,
      new Cesium.Cartesian3(),
    );

    // 反射相机位置
    const reflectorPosition = Cesium.Cartesian3.subtract(
      this.camera.position,
      Cesium.Cartesian3.multiplyByScalar(
        planeNormal,
        2 * cameraToPlaneDistance,
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );

    const rightDir = Cesium.Cartesian3.cross(
      reflection,
      Cesium.Cartesian3.normalize(reflectorPosition, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(rightDir, rightDir);

    const up = Cesium.Cartesian3.cross(
      rightDir,
      reflection,
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(up, up);

    this.camera2.position = reflectorPosition;
    this.camera2.direction = reflection;
    this.camera2.up = up;
    this.camera2.right = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(reflection, up, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    this.encodedReflectorCameraPosition =
      Cesium.EncodedCartesian3.fromCartesian(reflectorPosition);

    // 计算纹理矩阵
    const textureMatrix = Cesium.Matrix4.fromArray([
      // 列1
      0.5, 0.0, 0.0, 0.0,
      //
      0.0, 0.5, 0.0, 0.0,
      //
      0.0, 0.0, 0.5, 0.0,
      //
      0.5, 0.5, 0.5, 1.0,
    ]);
    Cesium.Matrix4.multiply(
      textureMatrix,
      this.camera2.frustum.projectionMatrix,
      textureMatrix,
    );
    const modelViewRelativeToEye = this.camera2.viewMatrix.clone(); // modelMatrix是单位矩阵
    modelViewRelativeToEye[12] = 0;
    modelViewRelativeToEye[13] = 0;
    modelViewRelativeToEye[14] = 0;
    Cesium.Matrix4.multiply(
      textureMatrix,
      modelViewRelativeToEye,
      textureMatrix,
    );
    this.textureMatrix = textureMatrix;

    /** 优化投影矩阵，仅渲染反射平面之上的物体 http://www.terathon.com/lengyel/Lengyel-Oblique.pdf */
    // 原始投影矩阵
    const { top, bottom, right, left, near, far } =
      this.camera.frustum._offCenterFrustum;
    modifiedProjection = Cesium.Matrix4.computePerspectiveOffCenter(
      left,
      right,
      bottom,
      top,
      near,
      far,
      new Cesium.Matrix4(),
    );

    // 平面上某点
    const pointOnPlane = Cesium.Cartesian3.fromRadians(
      this.camera.positionCartographic.longitude,
      this.camera.positionCartographic.latitude,
      this.height,
    );
    // 反射平面
    const reflectorPlane = new Cesium.Plane(new Cesium.Cartesian3(0, 0, 1), 0);
    Cesium.Plane.transform(
      reflectorPlane,
      Cesium.Transforms.eastNorthUpToFixedFrame(pointOnPlane),
      reflectorPlane,
    );

    // 反射平面转换到相机坐标系
    Cesium.Plane.transform(
      reflectorPlane,
      this.camera2.viewMatrix,
      reflectorPlane,
    );

    const plane = new Cesium.Cartesian4(
      reflectorPlane.normal.x,
      reflectorPlane.normal.y,
      reflectorPlane.normal.z,
      reflectorPlane.distance,
    );

    // 这里参考threejs中的反射，减少逆矩阵运算
    // 裁剪空间q
    const q = new Cesium.Cartesian4();
    q.x = (Math.sign(plane.x) + modifiedProjection[8]) / modifiedProjection[0];
    q.y = (Math.sign(plane.y) + modifiedProjection[9]) / modifiedProjection[5];
    q.z = -1;
    q.w = (1 + modifiedProjection[10]) / modifiedProjection[14];

    // Calculate the scaled plane vector
    Cesium.Cartesian4.multiplyByScalar(
      plane,
      2 / Cesium.Cartesian4.dot(plane, q),
      plane,
    );

    // 替换矩阵第三行
    modifiedProjection[2] = plane.x;
    modifiedProjection[6] = plane.y;
    modifiedProjection[10] = plane.z + 1.0;
    modifiedProjection[14] = plane.w;
    /** 优化投影矩阵，仅渲染反射平面之上的物体 - end */

    const { scene } = this;
    scene.logarithmicDepthBuffer = false; // 需要禁用对数深度缓冲区，修改投影矩阵才能生效
    scene._defaultView = this.view2;
    scene._view = this.view2;
    scene.camera = this.camera2;

    const frameState = scene.frameState;
    frameState.passes.offscreen = true;
    frameState.camera = this.camera2;
    const globeVisible = scene.globe.show;
    scene.globe.show = false;

    const passState = this.view2.passState;

    /** 渲染scene */
    scene.updateFrameState();
    frameState.passes.offscreen = true; // updateFrameState会重置passes，这里需要再设置一次
    frameState.passes.render = true;
    frameState.passes.postProcess = scene.postProcessStages.hasSelected;
    frameState.tilesetPassState = new Cesium.Cesium3DTilePassState({
      pass: Cesium.Cesium3DTilePass.RENDER,
    });

    frameState.backgroundColor = new Cesium.Color(0, 0, 0, 0);

    // frameState.atmosphere = scene.atmosphere;
    // scene.fog.update(frameState);

    scene.context.uniformState.update(frameState);

    scene._computeCommandList.length = 0;
    scene._overlayCommandList.length = 0;

    // if (scene.globe) {
    //   scene.globe.beginFrame(scene._frameState);
    // }

    scene.updateEnvironment();
    scene.updateAndExecuteCommands(
      passState,
      new Cesium.Color(0.0, 0.0, 0.0, 0.0),
    );
    scene.resolveFramebuffers(passState);

    scene.context.uniformState.updatePass(Cesium.Pass.OVERLAY);
    const commandList = scene._overlayCommandList;
    for (let i = 0; i < commandList.length; ++i) {
      commandList[i].execute(scene.context, passState);
    }

    // if (scene.globe) {
    //   scene.globe.endFrame(scene._frameState);

    //   if (!scene.globe.tilesLoaded) {
    //     scene._renderRequested = true;
    //   }
    // }

    scene.context.endFrame();
    /** 渲染scene - end */

    scene._defaultView = this.originView;
    scene.camera = this.camera;
    modifiedProjection = undefined;
    scene.globe.show = globeVisible;
    scene.logarithmicDepthBuffer = true;
  }
}
