import * as Cesium from "/Source/Cesium.js";
class LineRoamingHelper {
  constructor(viewer) {
    this.viewer = viewer;
    this.roamPath = null; // 漫游路径
    this.clock = new Cesium.Clock();
    this.clock.startTime = Cesium.JulianDate.fromDate(new Date(1900, 1, 1, 0));
    this.viewer.scene.preRender.addEventListener(() => {
      this.clock.tick();
    });
    this.tickHandler = null;
  }
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
  startRoaming() {
    if (this.tickHandler) this.tickHandler(); // 移除
    const camera = this.viewer.camera;
    this.clock.currentTime = this.clock.startTime.clone();
    const pos1 = this.roamPath.position.getValue(this.clock.currentTime);
    const pos2 = this.roamPath.position.getValue(
      Cesium.JulianDate.addSeconds(
        this.clock.startTime,
        1,
        new Cesium.JulianDate()
      )
    );
    const direction = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(pos2, pos1, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    camera.direction = direction;
    console.log({ direction: direction, heading: camera.heading });
    camera.setView({
      destination: pos1,
      orientation: {
        roll: 0,
        pitch: 0,
        heading: camera.heading,
      },
    });
    setTimeout(() => {
      this.tickHandler = this.clock.onTick.addEventListener((clock) => {
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
        }
      });
    }, 200);
  }
}
export default LineRoamingHelper;
