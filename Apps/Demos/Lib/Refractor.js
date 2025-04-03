import * as Cesium from "../../../../Build/CesiumUnminified/index.js";

let modifiedProjection; // 会在多个实例中共享，因此场景中只能有一个折射平面

function prePassesUpdate(scene) {
  scene._jobScheduler.resetBudgets();

  const frameState = scene._frameState;
  scene.primitives.prePassesUpdate(frameState);

  if (Cesium.defined(scene.globe)) {
    scene.globe.update(frameState);
  }

  scene._picking.update();
  frameState.creditDisplay.update();
}

function postPassesUpdate(scene) {
  scene.primitives.postPassesUpdate(scene._frameState);
  Cesium.RequestScheduler.update();
}

const preloadTilesetPassState = new Cesium.Cesium3DTilePassState({
  pass: Cesium.Cesium3DTilePass.PRELOAD,
});

function updatePreloadPass(scene) {
  const frameState = scene._frameState;
  preloadTilesetPassState.camera = frameState.camera;
  preloadTilesetPassState.cullingVolume = frameState.cullingVolume;

  const primitives = scene.primitives;
  primitives.updateForPass(frameState, preloadTilesetPassState);
}

const renderTilesetPassState = new Cesium.Cesium3DTilePassState({
  pass: Cesium.Cesium3DTilePass.RENDER,
});

function executeOverlayCommands(scene, passState) {
  scene.context.uniformState.updatePass(Cesium.Pass.OVERLAY);

  const context = scene.context;
  const commandList = scene._overlayCommandList;
  for (let i = 0; i < commandList.length; ++i) {
    commandList[i].execute(context, passState);
  }
}

const scratchBackgroundColor = new Cesium.Color();

function render(scene) {
  const frameState = scene._frameState;

  const context = scene.context;
  const { uniformState } = context;

  const view = scene._defaultView;
  scene._view = view;

  scene.updateFrameState();
  frameState.passes.offscreen = true; // updateFrameState会重置passes，这里需要再设置一次
  frameState.passes.render = true;
  frameState.passes.postProcess = scene.postProcessStages.hasSelected;
  frameState.tilesetPassState = renderTilesetPassState;

  let backgroundColor = Cesium.defaultValue(
    scene.backgroundColor,
    Cesium.Color.BLACK,
  );
  if (scene._hdr) {
    backgroundColor = Cesium.Color.clone(
      backgroundColor,
      scratchBackgroundColor,
    );
    backgroundColor.red = Cesium.Math.pow(backgroundColor.red, scene.gamma);
    backgroundColor.green = Cesium.Math.pow(backgroundColor.green, scene.gamma);
    backgroundColor.blue = Cesium.Math.pow(backgroundColor.blue, scene.gamma);
  }
  frameState.backgroundColor = backgroundColor;

  // frameState.atmosphere = scene.atmosphere;
  // scene.fog.update(frameState);

  uniformState.update(frameState);

  // const shadowMap = scene.shadowMap;
  // if (Cesium.defined(shadowMap) && shadowMap.enabled) {
  //   if (
  //     !Cesium.defined(scene.light) ||
  //     scene.light instanceof Cesium.SunLight
  //   ) {
  //     // Negate the sun direction so that it is from the Sun, not to the Sun
  //     Cesium.Cartesian3.negate(
  //       uniformState.sunDirectionWC,
  //       scene._shadowMapCamera.direction,
  //     );
  //   } else {
  //     Cesium.Cartesian3.clone(
  //       scene.light.direction,
  //       scene._shadowMapCamera.direction,
  //     );
  //   }
  //   frameState.shadowMaps.push(shadowMap);
  // }

  scene._computeCommandList.length = 0;
  scene._overlayCommandList.length = 0;

  const viewport = view.viewport;
  viewport.x = 0;
  viewport.y = 0;
  viewport.width = context.drawingBufferWidth;
  viewport.height = context.drawingBufferHeight;

  const passState = view.passState;
  // passState.framebuffer = undefined;
  // passState.blendingEnabled = undefined;
  // passState.scissorTest = undefined;
  // passState.viewport = Cesium.BoundingRectangle.clone(
  //   viewport,
  //   passState.viewport,
  // );

  if (Cesium.defined(scene.globe)) {
    scene.globe.beginFrame(frameState);
  }

  scene.updateEnvironment();
  scene.updateAndExecuteCommands(passState, backgroundColor);

  scene.resolveFramebuffers(passState);

  // passState.framebuffer = undefined;
  executeOverlayCommands(scene, passState);

  if (Cesium.defined(scene.globe)) {
    scene.globe.endFrame(frameState);

    if (!scene.globe.tilesLoaded) {
      scene._renderRequested = true;
    }
  }

  context.endFrame();
}

export default class Refractor {
  get refractorTexture() {
    return this.fbManager?.framebuffer?.getColorTexture(0);
  }
  get refractorDepthTexture() {
    return this.view2.globeDepth.depthStencilTexture;
  }
  constructor({ viewer, height }) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.camera = viewer.camera;
    this.height = height;

    this.camera2 = new Cesium.Camera(viewer.scene);
    this.encodedRefractorCameraPosition = new Cesium.EncodedCartesian3();
    this.camera2.name = "refractor-camera";
    this.view2 = new Cesium.View(
      viewer.scene,
      this.camera2,
      viewer.scene._defaultView.viewport,
    );

    this.originView = viewer.scene._defaultView;

    this.textureMatrix = Cesium.Matrix4.IDENTITY;
    this.fbManager = undefined;
    this.initialized = false;

    this._initialize(viewer.scene.context);
  }
  update(frameState) {}
  isDestroyed() {
    return false;
  }
  _initialize(context) {
    // 不需要创建深度纹理，在Scene渲染时实际的frambuffer会由view.globeDepth.framebuffer替代
    this.fbManager = new Cesium.FramebufferManager({
      createDepthAttachments: false,
    });
    // 需要先更新一下，创建纹理
    this.fbManager.update(
      context,
      context.drawingBufferWidth,
      context.drawingBufferHeight,
    );

    // 强制更改投影矩阵
    const originalUniformStateUpdateFrustum =
      context.uniformState.updateFrustum;
    context.uniformState.updateFrustum = function (frustum) {
      if (modifiedProjection) {
        Cesium.Matrix4.clone(modifiedProjection, frustum.projectionMatrix);
      }

      originalUniformStateUpdateFrustum.call(this, frustum);
    };

    this.scene.preUpdate.addEventListener((scene) => {
      this.fbManager.update(
        scene.context,
        scene.context.drawingBufferWidth,
        scene.context.drawingBufferHeight,
      );
      // this.view2.sceneFramebuffer.update();
      this.renderTexture();
    });

    this.initialized = true;
  }
  renderTexture() {
    // 更新虚拟相机位置
    this.camera2.position = this.camera.position.clone();
    this.camera2.direction = this.camera.direction.clone();
    this.camera2.up = this.camera.up.clone();
    this.camera2.right = this.camera.right.clone();
    this.encodedRefractorCameraPosition =
      Cesium.EncodedCartesian3.fromCartesian(this.camera2.position);

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

    /** 优化投影矩阵，仅渲染折射平面以下的物体 http://www.terathon.com/lengyel/Lengyel-Oblique.pdf */
    // 原始投影矩阵
    const { top, bottom, right, left, near, far } =
      this.camera.frustum._offCenterFrustum;
    modifiedProjection = Cesium.Matrix4.computeInfinitePerspectiveOffCenter(
      left,
      right,
      bottom,
      top,
      near,
      // far,
      new Cesium.Matrix4(),
    );

    // 平面上某点
    const pointOnPlane = Cesium.Cartesian3.fromRadians(
      this.camera.positionCartographic.longitude,
      this.camera.positionCartographic.latitude,
      this.height,
    );
    // 折射平面
    const refractorPlane = new Cesium.Plane(new Cesium.Cartesian3(0, 0, 1), 0);
    Cesium.Plane.transform(
      refractorPlane,
      Cesium.Transforms.eastNorthUpToFixedFrame(pointOnPlane),
      refractorPlane,
    );

    // 折射平面转换到相机坐标系
    Cesium.Plane.transform(
      refractorPlane,
      this.camera2.viewMatrix,
      refractorPlane,
    );

    const plane = new Cesium.Cartesian4(
      refractorPlane.normal.x,
      refractorPlane.normal.y,
      refractorPlane.normal.z,
      refractorPlane.distance,
    );

    // Cesium.Cartesian4.negate(plane, plane);

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
    /** 优化投影矩阵，仅渲染折射平面之上的物体 - end */

    const { scene } = this;
    scene.logarithmicDepthBuffer = false; // 需要禁用对数深度缓冲区，修改投影矩阵才能生效
    scene._defaultView = this.view2;
    scene.camera = this.camera2;

    const frameState = scene.frameState;
    frameState.passes.offscreen = true;
    frameState.camera = this.camera2;
    const globeVisible = scene.globe.show;
    // scene.globe.show = false;

    const passState = this.view2.passState;
    passState.framebuffer = this.fbManager.framebuffer; // 在Scene渲染时实际的frambuffer会由view.globeDepth.framebuffer替代，并将结果拷贝到fbManager.framebuffer中

    frameState.newFrame = false;
    prePassesUpdate(scene);
    updatePreloadPass(scene);
    render(scene);
    postPassesUpdate(scene);
    frameState.newFrame = true;

    scene._defaultView = this.originView;
    scene.camera = this.camera;
    modifiedProjection = undefined;
    scene.globe.show = globeVisible;
    scene.logarithmicDepthBuffer = true;
  }
}
