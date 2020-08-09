import * as Cesium from "../../../Source/Cesium.js";
class PickFromRay {
  constructor(viewer, objectsToExclude) {
    this.viewer = viewer;
    this.objectsToExclude = objectsToExclude;
    this.shownRay = new Cesium.EntityCollection();
    this.hiddenRay = new Cesium.EntityCollection();
    this.notIntersected = new Cesium.EntityCollection();
    this.draw = null;
  }

  pickFromRay(viewPoint, draw = true) {
    this.draw = draw;
    var destPoints = this._getDestPoints(viewPoint);
    var intersectedPos;
    for (var i = 0; i < destPoints.length; i++) {
      // 计算射线的方向，目标点left 视域点right
      var direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(
          destPoints[i],
          viewPoint,
          new Cesium.Cartesian3()
        ),
        new Cesium.Cartesian3()
      );
      // 建立射线
      var ray = new Cesium.Ray(viewPoint, direction);
      // var objectsToExclude = this.objectsToExclude.concat(this.shownRay._entities._array,this.hiddenRay._entities._array,this.notIntersected._entities._array);
      var result = this.viewer.scene.pickFromRay(ray, this.objectsToExclude); // 计算交互点，返回第一个
      if (i === Math.floor(destPoints.length / 2)) {
        // eslint-disable-next-line no-debugger
        // debugger;
        if (this.draw) {
          this._showIntersection(
            result,
            destPoints[i],
            viewPoint,
            new Cesium.Color(1, 1, 0, 0.5)
          );
        }
        intersectedPos = result;
      } else if (this.draw) {
        this._showIntersection(result, destPoints[i], viewPoint);
      }
    }
    return intersectedPos;
  }
  _removeEntities() {
    var me = this;
    this.shownRay.values.forEach((item) => {
      me.viewer.entities.remove(item);
    });
    this.hiddenRay.values.forEach((item) => {
      me.viewer.entities.remove(item);
    });
    this.notIntersected.values.forEach((item) => {
      me.viewer.entities.remove(item);
    });
    this.shownRay.removeAll();
    this.hiddenRay.removeAll();
    this.notIntersected.removeAll();
  }
  _getDestPoints(viewPoint) {
    // 清空已有射线
    this._removeEntities();
    // 世界坐标转换为投影坐标
    var webMercatorProjection = new Cesium.WebMercatorProjection(
      this.viewer.scene.globe.ellipsoid
    );
    var viewPointWebMercator = webMercatorProjection.project(
      Cesium.Cartographic.fromCartesian(viewPoint)
    );

    // 目标点集合
    var destPoints = [];

    // 视域点和目标点的距离
    var radius = 20;

    // 位于xz平面
    // for (var i = 260; i <= 280; i++) {
    //     // 度数转弧度
    //     var radians = Cesium.Math.toRadians(i);
    //     // 计算目标点
    //     var toPoint = new Cesium.Cartesian3(
    //     viewPointWebMercator.x + radius * Math.cos(radians),
    //     viewPointWebMercator.y,
    //     Cesium.Cartographic.fromCartesian(viewPoint).height + radius * Math.sin(radians)
    //     );
    //     // 投影坐标转世界坐标
    //     toPoint = webMercatorProjection.unproject(toPoint);
    //     destPoints.push(Cesium.Cartographic.toCartesian(toPoint.clone()));
    //
    // radius = 100;
    // xy平面上
    // for (var i = 0; i < 360; i+=45) {
    //     // 度数转弧度
    //     var radians = Cesium.Math.toRadians(i);
    //     // 计算目标点
    //     var toPoint = new Cesium.Cartesian3(
    //       viewPointWebMercator.x + radius * Math.cos(radians),
    //       viewPointWebMercator.y + radius * Math.sin(radians),
    //       30
    //     );
    //     // 投影坐标转世界坐标
    //     toPoint = webMercatorProjection.unproject(toPoint);
    //     destPoints.push(Cesium.Cartographic.toCartesian(toPoint.clone()));
    // }
    // yz平面上
    for (var i = 270; i < 271; i += 1) {
      // 度数转弧度
      var radians = Cesium.Math.toRadians(i);
      // 计算目标点
      var toPoint = new Cesium.Cartesian3(
        viewPointWebMercator.x,
        viewPointWebMercator.y + radius * Math.cos(radians),
        Cesium.Cartographic.fromCartesian(viewPoint).height +
        radius * Math.sin(radians)
      );
      // 投影坐标转世界坐标
      toPoint = webMercatorProjection.unproject(toPoint);
      destPoints.push(Cesium.Cartographic.toCartesian(toPoint.clone()));
    }

    return destPoints;
  }
  _showIntersection(result, destPoint, viewPoint, color) {
    // 如果是场景模型的交互点，排除交互点是地球表面
    if (Cesium.defined(result) && Cesium.defined(result.object)) {
      this.shownRay.add(
        this.viewer.entities.add({
          polyline: {
            positions: [result.position, viewPoint],
            arcType: Cesium.ArcType.NONE,
            width: 5,
            material: color || new Cesium.Color(0, 1, 0, 0.5),
            depthFailMaterial: color || new Cesium.Color(0, 1, 0, 0.5),
          },
        })
      );
      this.hiddenRay.add(
        this.viewer.entities.add({
          polyline: {
            positions: [result.position, destPoint],
            arcType: Cesium.ArcType.NONE,
            width: 5,
            material: new Cesium.Color(1, 0, 0, 0.5),
            depthFailMaterial: new Cesium.Color(1, 0, 0, 0.5),
          },
        })
      );
    } else {
      this.notIntersected.add(
        this.viewer.entities.add({
          polyline: {
            positions: [viewPoint, destPoint],
            arcType: Cesium.ArcType.NONE,
            width: 5,
            material: Cesium.Color.GREEN,
            depthFailMaterial: Cesium.Color.GREEN,
          },
        })
      );
    }
  }
}
export default PickFromRay;
