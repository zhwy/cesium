import * as Cesium from "../../../Build/CesiumUnminified/index.js";
class PickFromRay {
  constructor(viewer, objectsToExclude) {
    this.viewer = viewer;
    this.originExcluded = objectsToExclude;
    this.objectsToExclude = this.originExcluded.slice(); //记录长度

    this.draw = true;
    this.visible = false;
    this.parentEntity = null;

    const dataSource = new Cesium.CustomDataSource("pick-from-ray");
    this.drawEntities = dataSource.entities;

    viewer.dataSources.add(dataSource);
  }
  /**
   * 监测交点
   * @param {*} viewPoint
   * @param {*} destPoints
   * @param {*} draw
   */
  pickFromRay(viewPoint, destPoints) {
    this.drawEntities.removeAll();
    this.objectsToExclude = this.originExcluded.slice();

    if (this.draw) {
      this.parentEntity = this.drawEntities.add({
        position: viewPoint,
        show: this.visible,
        point: {
          pixelSize: 10,
          color: Cesium.Color.GREEN,
        },
      });
      this.objectsToExclude.push(this.parentEntity);
    }

    const intersectedPos = new Array(destPoints.length);
    for (let i = 0; i < destPoints.length; i++) {
      // 计算射线的方向，目标点left 视域点right
      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(
          destPoints[i],
          viewPoint,
          new Cesium.Cartesian3()
        ),
        new Cesium.Cartesian3()
      );
      // 建立射线
      const ray = new Cesium.Ray(viewPoint, direction);
      const result = this.viewer.scene.pickFromRay(ray, this.objectsToExclude); // 计算交互点，返回第一个
      intersectedPos[i] = result;

      if (this.draw) {
        this._showIntersection(result, destPoints[i], viewPoint);
      }
    }

    return intersectedPos;
  }
  /**
   * 结果可视化
   * @param {*} result
   * @param {*} destPoint
   * @param {*} viewPoint
   */
  _showIntersection(result, destPoint, viewPoint) {
    if (Cesium.defined(result) && Cesium.defined(result.object)) {
      // 可视区域
      this._drawLine(
        result.position,
        viewPoint,
        new Cesium.Color(0, 1, 0, 0.5)
      );
      // 不可视区域
      this._drawLine(
        result.position,
        destPoint,
        new Cesium.Color(0.5, 0.5, 0.5, 0.5)
      );
      // 交点
      this.objectsToExclude.push(
        this.drawEntities.add({
          position: result.position,
          parent: this.parentEntity,
          point: {
            pixelSize: 10,
            color: Cesium.Color.RED,
          },
        })
      );
    } else {
      this._drawLine(viewPoint, destPoint, Cesium.Color.GREEN);
    }
    this.objectsToExclude.push(
      this.drawEntities.add({
        position: destPoint,
        parent: this.parentEntity,
        point: {
          pixelSize: 10,
          color: Cesium.Color.BLUE,
        },
      })
    );
  }
  _drawLine(leftPoint, secPoint, color) {
    this.drawEntities.add({
      parent: this.parentEntity,
      polyline: {
        positions: [leftPoint, secPoint],
        arcType: Cesium.ArcType.NONE,
        width: 5,
        material: color,
        depthFailMaterial: color,
      },
    });
  }
}
export default PickFromRay;
