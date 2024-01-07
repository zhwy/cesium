import * as Cesium from "/Build/CesiumUnminified/index.js";

class LineRoamingHelper {
  constructor(viewer) {
    this.viewer = viewer;
    this.roamPath = null; // 漫游路径
    this.clock = new Cesium.Clock();
    this.clock.startTime = Cesium.JulianDate.fromDate(new Date(1900, 1, 1, 0));
    this.viewer.scene.preRender.addEventListener(() => {
      this.clock.tick();
    });
    this.removeTickHandler = null;
    this.roaming = false;
    this.multiplier = 600; // 行进速度
    this.cameraDirection = 1;
    this.whenStopRoaming = () => {};

    this.rotateCtrls = this.viewer.scene.screenSpaceCameraController.rotateEventTypes;
    this.tiltCtrls = this.viewer.scene.screenSpaceCameraController.tiltEventTypes;

    document.addEventListener("keydown", (e) => {
      this._keydown(e);
    });
    document.addEventListener("keyup", (e) => {
      this._keyup(e);
    });
  }
  /**
   * 设置漫游路径
   * @param {*} positions
   */
  setRoamPath(positions) {
    if (positions.length > 1) {
      const cartographic = [];
      positions.forEach((p) => {
        p[2] = p[2] || 0;
        cartographic.push(Cesium.Cartographic.fromDegrees(p[0], p[1], p[2]));
      });
      const sampledPos = new Cesium.SampledPositionProperty();

      let startTime = this.clock.startTime.clone();
      sampledPos.addSample(
        startTime,
        Cesium.Cartesian3.fromDegrees(
          positions[0][0],
          positions[0][1],
          positions[0][2]
        )
      );

      let endTime = new Cesium.JulianDate();
      for (let i = 1; i < cartographic.length; i++) {
        const pos = positions[i];
        // 计算点距离
        const geodesic = new Cesium.EllipsoidGeodesic(
          cartographic[i - 1],
          cartographic[i]
        );
        // 考虑高度差
        const deltah = positions[i][2] - positions[i - 1][2];
        const distance = Math.sqrt(
          geodesic.surfaceDistance * geodesic.surfaceDistance + deltah * deltah
        );
        sampledPos.addSample(
          Cesium.JulianDate.addSeconds(startTime, distance, endTime),
          Cesium.Cartesian3.fromDegrees(pos[0], pos[1], pos[2])
        );
        startTime = endTime.clone();
      }

      this.clock.stopTime = endTime.clone();
      // 路径entity
      this.roamPath = this.viewer.entities.add({
        show: false,
        name: "roam-path",
        id: "roam-path",
        position: sampledPos,
        orientation: new Cesium.VelocityOrientationProperty(sampledPos),
      });
    } else {
      alert("至少需要两个点！");
    }
  }
  /**
   * 激活漫游
   */
  activateRoaming() {
    const me = this;
    this.roaming = true;

    if (this.removeTickHandler) this.removeTickHandler(); // 移除
    const camera = this.viewer.camera;
    this.clock.currentTime = this.clock.startTime.clone();
    const pos1 = this.roamPath.position.getValue(this.clock.startTime);
    const pos2 = this.roamPath.position.getValue(
      Cesium.JulianDate.addSeconds(
        this.clock.startTime,
        1,
        new Cesium.JulianDate()
      )
    );
    const geodesic = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromCartesian(pos1),
      Cesium.Cartographic.fromCartesian(pos2)
    );
    this.viewer.scene.screenSpaceCameraController.enableRotate = false;
    this.viewer.scene.screenSpaceCameraController.enableTilt = false;
    this.viewer.scene.screenSpaceCameraController.enableZoom = false;
    camera.flyTo({
      destination: pos1,
      orientation: {
        heading: geodesic.startHeading,
        pitch: 0,
        roll: 0,
      },
      maximumHeight: geodesic.start.height,
      duration: 2,
      complete: () => {
        this.removeTickHandler = this.clock.onTick.addEventListener((clock) => {
          const pos = this.roamPath.position.getValue(clock.currentTime);
          if (pos) {
            camera.setView({
              destination: pos,
              orientation: {
                roll: camera.roll,
                pitch: camera.pitch,
                heading: camera.heading,
              },
            });
            let nowPos = pos.clone();
            let nextpos = me.roamPath.position.getValue(
              Cesium.JulianDate.addSeconds(
                clock.currentTime,
                1,
                new Cesium.JulianDate()
              )
            );
            if (typeof nextpos === "undefined") {
              nextpos = pos.clone();
              nowPos = me.roamPath.position.getValue(
                Cesium.JulianDate.addSeconds(
                  clock.currentTime,
                  -1,
                  new Cesium.JulianDate()
                )
              );
            }
            const direction = Cesium.Cartesian3.subtract(
              nextpos,
              nowPos,
              new Cesium.Cartesian3()
            );
            const angle = Cesium.Cartesian3.angleBetween(
              direction,
              camera.direction
            );
            if (angle > -Math.PI / 2 && angle < Math.PI / 2) {
              me.cameraDirection = 1;
            } else {
              me.cameraDirection = -1;
            }
          }
        });
      },
    });
  }
  /**
   * 退出漫游
   */
  deactivateRoaming() {
    this.clock.shouldAnimate = false;
    this.roaming = false;
    if (this.removeTickHandler) this.removeTickHandler(); // 移除

    this.viewer.scene.screenSpaceCameraController.enableRotate = true;
    this.viewer.scene.screenSpaceCameraController.enableTilt = true;
    this.viewer.scene.screenSpaceCameraController.enableZoom = true;
    this.whenStopRoaming();
  }
  _keydown(e) {
    if (this.roaming) {
      switch (e.code) {
        case "KeyW":
          this.clock.shouldAnimate = true;
          this.clock.multiplier = this.multiplier * this.cameraDirection;
          break;
        case "KeyS":
          this.clock.shouldAnimate = true;
          this.clock.multiplier = this.multiplier * this.cameraDirection * -1;
          break;
        case "Escape": //esc
          this.deactivateRoaming();
          break;
        default:
          break;
      }
    }
  }
  _keyup(e) {
    switch (e.code) {
      case "KeyW":
        this.clock.shouldAnimate = false;
        break;
      case "KeyS":
        this.clock.shouldAnimate = false;
        break;
      default:
        break;
    }
  }
}
export default LineRoamingHelper;
