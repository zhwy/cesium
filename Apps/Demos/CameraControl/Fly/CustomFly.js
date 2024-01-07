//设置相机视角
function _setCamera(camera, deltaX, deltaY, deltaZ, deltaH, deltaP, set) {
  camera.setView({
    orientation: {
      heading: camera.heading + deltaH / set,
      pitch: camera.pitch + deltaP / set,
      roll: 0,
    },
  });
  camera.move(new Cesium.Cartesian3(deltaX, deltaY, deltaZ), 1 / set);
}
//获取相机视角
function _getCameraView(camera) {
  let cameraCart = camera.positionCartographic;
  return {
    lng: Cesium.Math.toDegrees(cameraCart.longitude),
    lat: Cesium.Math.toDegrees(cameraCart.latitude),
    height: cameraCart.height,
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
    time: 10,
  };
}
//飞行时禁止鼠标事件
function _enableMouseEvt(scene, enable) {
  scene.screenSpaceCameraController.enableRotate = enable;
  scene.screenSpaceCameraController.enableTranslate = enable;
  scene.screenSpaceCameraController.enableZoom = enable;
  scene.screenSpaceCameraController.enableTilt = enable;
  scene.screenSpaceCameraController.enableLook = enable;
}
class CustomFly {
  constructor(viewer) {
    let me = this;
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.camera = viewer.camera;
    this.viewList = [];
    this.l = 0;
    this.count = 0;
    this.isStop = true; //用于判断执行的时暂停还是停止

    this.intervalHandler = null;
    this.deltaX = 0;
    this.deltaY = 0;
    this.deltaZ = 0;
    this.deltaH = 0;
    this.deltaP = 0;

    this.pauseView = {}; //储存暂停时的视角

    this.helperEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (me.viewList.length > 1) {
            return me.viewList.map((view) => {
              return Cesium.Cartesian3.fromDegrees(
                view.lng,
                view.lat,
                view.height
              );
            });
          } else {
            return null;
          }
        }, false),
      },
    });
  }
  /**
   * 添加视角
   */
  addView() {
    let view = _getCameraView(this.camera);
    this.viewList.push(view);
  }
  /**
   * 开始飞行
   */
  fly() {
    if (this.viewList.length > 1) {
      _enableMouseEvt(this.scene, false);
      let nowView;
      if (this.isStop) {
        nowView = this.viewList[this.l];
      } else {
        //暂停
        nowView = this.pauseView;
        this.isStop = true;
      }
      this.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          nowView.lng,
          nowView.lat,
          nowView.height
        ),
        orientation: {
          heading: nowView.heading,
          pitch: nowView.pitch,
          roll: 0,
        },
      });
      this._interval();
    }
  }
  /**
   * 停止飞行
   */
  stop() {
    clearInterval(this.intervalHandler);
    this.intervalHandler = null;

    this.l = 0;
    this.isStop = true;
    _enableMouseEvt(this.scene, true);
  }
  /**
   * 暂停飞行
   */
  pause() {
    clearInterval(this.intervalHandler);
    this.intervalHandler = null;
    this.isStop = false;

    //获取暂停时相机视角
    this.pauseView = _getCameraView(this.camera);
  }
  /**
   * 飞行至指定视角
   * todo 停止
   * @param {*} view
   */
  static flyTo(camera, view) {
    let nowView = _getCameraView(camera);
    let nextView = view;
    let set = (nextView.time * 1000) / 20;
    let count = set;
    let now = Cesium.Cartesian3.fromDegrees(
      nowView.lng,
      nowView.lat,
      nowView.height
    );
    let next = Cesium.Cartesian3.fromDegrees(
      nextView.lng,
      nextView.lat,
      nextView.height
    );
    let deltaX = next.x - now.x;
    let deltaY = next.y - now.y;
    let deltaZ = next.z - now.z;
    let deltaP = nextView.pitch - nowView.pitch;
    let deltaH = nextView.heading - nowView.heading;
    _enableMouseEvt(camera._scene, false);
    let handler = setInterval(() => {
      _setCamera(camera, deltaX, deltaY, deltaZ, deltaH, deltaP, set);
      count--;
      if (count == 0) {
        clearInterval(handler);
        _enableMouseEvt(camera._scene, true);
        handler = null;
        camera = null;
      }
    }, 20);
  }
  _interval() {
    let me = this;
    let l = this.l;

    if (this.viewList[l + 1]) {
      let nowView = this.viewList[l];
      let nextView = this.viewList[l + 1];
      let set = (nextView.time * 1000) / 20;
      this.count = set;
      let now = Cesium.Cartesian3.fromDegrees(
        nowView.lng,
        nowView.lat,
        nowView.height
      );
      let next = Cesium.Cartesian3.fromDegrees(
        nextView.lng,
        nextView.lat,
        nextView.height
      );
      let deltaX = next.x - now.x;
      let deltaY = next.y - now.y;
      let deltaZ = next.z - now.z;
      let deltaP = nextView.pitch - nowView.pitch;
      let deltaH = nextView.heading - nowView.heading;
      this.intervalHandler = setInterval(() => {
        _setCamera(me.camera, deltaX, deltaY, deltaZ, deltaH, deltaP, set);
        me.count--;
        if (me.count == 0) {
          clearInterval(me.intervalHandler);
          me.intervalHandler = null;
          me.l++; //进入下一段
          me._interval();
        }
      }, 20);
    } else {
      this.stop();
    }
  }
}
