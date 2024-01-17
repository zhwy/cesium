/*** 来源 https://www.jianshu.com/p/4a97d3ed4a06 ***/

//空间两点距离计算函数
function getSpaceDistance(positions) {
  let distance = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    let point1cartographic = Cesium.Cartographic.fromCartesian(positions[i]);
    let point2cartographic = Cesium.Cartographic.fromCartesian(
      positions[i + 1]
    );
    /**根据经纬度计算出距离**/
    let geodesic = new Cesium.EllipsoidGeodesic();
    geodesic.setEndPoints(point1cartographic, point2cartographic);
    let s = geodesic.surfaceDistance;
    //console.log(Math.sqrt(Math.pow(distance, 2) + Math.pow(endheight, 2)));
    //返回两点之间的距离
    s = Math.sqrt(
      Math.pow(s, 2) +
        Math.pow(point2cartographic.height - point1cartographic.height, 2)
    );
    distance = distance + s;
  }
  return distance;
}

/*方向*/
function getBearing(from, to) {
  let lat1 = from.lat;
  let lon1 = from.lon;
  let lat2 = to.lat;
  let lon2 = to.lon;
  let angle = -Math.atan2(
    Math.sin(lon1 - lon2) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2)
  );
  if (angle < 0) {
    angle += Math.PI * 2.0;
  }
  angle = Cesium.Math.toDegrees(angle); //角度
  return angle;
}

/*角度*/
function getAngle(p1, p2, p3) {
  let bearing21 = getBearing(p2, p1);
  let bearing23 = getBearing(p2, p3);
  let angle = bearing21 - bearing23;
  if (angle < 0) {
    angle += 360;
  }
  return angle;
}

//计算多边形面积
function getArea(positions) {
  if (positions.length < 4) {
    return 0;
  }
  let points = positions.map((pos) => {
    let coord = Cesium.Cartographic.fromCartesian(pos);
    return {
      lon: coord.longitude,
      lat: coord.latitude,
    };
    // return [
    //   Cesium.Math.toDegrees(coord.longitude),
    //   Cesium.Math.toDegrees(coord.latitude),
    // ];
  });
  // let polygon = turf.polygon([points]);
  // return turf.area(polygon);
  let res = 0;
  //拆分三角曲面
  for (let i = 0; i < points.length - 2; i++) {
    let j = (i + 1) % points.length;
    let k = (i + 2) % points.length;
    let totalAngle = getAngle(points[i], points[j], points[k]);

    let dis_temp1 = distance(positions[i], positions[j]);
    let dis_temp2 = distance(positions[j], positions[k]);
    res += dis_temp1 * dis_temp2 * Math.abs(Math.sin(totalAngle));
  }
  return res;
}

//多点距离
function distance(point1, point2) {
  let point1cartographic = Cesium.Cartographic.fromCartesian(point1);
  let point2cartographic = Cesium.Cartographic.fromCartesian(point2);
  /**根据经纬度计算出距离**/
  let geodesic = new Cesium.EllipsoidGeodesic();
  geodesic.setEndPoints(point1cartographic, point2cartographic);
  let s = geodesic.surfaceDistance;
  //console.log(Math.sqrt(Math.pow(distance, 2) + Math.pow(endheight, 2)));
  //返回两点之间的距离
  s = Math.sqrt(
    Math.pow(s, 2) +
      Math.pow(point2cartographic.height - point1cartographic.height, 2)
  );
  return s;
}

const MeasureType = {
  DISTANCE: 0,
  AREA: 1,
};

/**
 * 测量基类
 */
class MeasureTool {
  constructor(viewer) {
    this.viewer = viewer;
    this.positions = null;
    this.pointer = null; //鼠标点
    this.pointerPos = null;
    this.measureEntity = null;
    this.label = null;
    this.handler = null;
    this.measureOptions = null;
    this.pointerOptions = null;
    this.labelOptions = null;
    this.lastCompleted = true; //上次测量已完成
    this.orginLeftDblEvt = null; //原有鼠标左键事件

    const me = this;
    this.pointerOptions = {
      name: "measure-pointer",
      position: new Cesium.CallbackProperty(() => {
        return me.pointerPos;
      }, false),
      point: {
        pixelSize: 5,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      clampToGround: false,
    };
  }
  /**
   * 开始一次测量
   */
  activate() {
    const me = this;
    const viewer = this.viewer;

    this.measureEntity = viewer.entities.add(this.measureOptions);
    this.pointer = viewer.entities.add(this.pointerOptions);
    this.label = viewer.entities.add(this.labelOptions);

    this.orginLeftDblEvt = viewer.screenSpaceEventHandler.getInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );
    // 取消双击事件-追踪该位置
    viewer.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );

    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    this.positions = [];

    let cartesian = null;

    this.handler.setInputAction(function (evt) {
      if (me.viewer.scene.mode != Cesium.SceneMode.MORPHING) {
        if (me.viewer.scene.pickPositionSupported) {
          cartesian = me.getPickPosition(evt.endPosition);

          if (cartesian) me.pointerPos = cartesian.clone();
          if (cartesian && !me.lastCompleted) {
            if (me.positions.length <= 1) {
              me.positions.push(cartesian);
            } else {
              me.positions.pop();
              me.positions.push(cartesian);
            }
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    this.handler.setInputAction(function (evt) {
      if (me.lastCompleted) {
        me.clear();
        me.lastCompleted = false;
      }

      if (me.viewer.scene.mode !== Cesium.SceneMode.MORPHING) {
        if (me.viewer.scene.pickPositionSupported) {
          cartesian = me.getPickPosition(evt.position);

          if (cartesian) {
            me.positions.push(cartesian);
            // let cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            // let lng = Cesium.Math.toDegrees(cartographic.longitude);
            // let lat = Cesium.Math.toDegrees(cartographic.latitude);
            // let height = cartographic.height;
            // let mapPosition = { lng: lng, lat: lat, height: height };
            // console.log("measure position", mapPosition);
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    this.handler.setInputAction(function (evt) {
      me.lastCompleted = true;
      //添加最后一个点
      // let ray = viewer.camera.getPickRay(evt.position);
      // cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      // if (cartesian) {
      //     me.positions.push(cartesian);
      // }
      // me.pointer.show = false;
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }
  /**
   * 清除标记
   */
  clear() {
    this.positions = [];
  }
  /**
   * 停止
   */
  deactivate() {
    this.viewer.entities.remove(this.pointer);
    this.viewer.entities.remove(this.measureEntity);
    this.viewer.entities.remove(this.label);
    this.pointer = null;
    this.measureEntity = null;
    this.label = null;
    this.positions = [];
    this.lastCompleted = true;
    if (this.handler && !this.handler.isDestroyed()) {
      this.handler.destroy();
      this.handler = null;
    }

    this.viewer.screenSpaceEventHandler.setInputAction(
      this.orginLeftDblEvt,
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    ); //添加回双击事件
  }
  getPickPosition(pos) {
    let cartesian;
    const viewer = this.viewer;

    if (this.pickMode === "scene") {
      cartesian = viewer.scene.pickPosition(pos); // 此法在地表透明时获取坐标会有问题
      if (!cartesian) {
        const ray = viewer.camera.getPickRay(pos);
        const result = viewer.scene.pickFromRay(ray, [this.pointer]);
        if (result) return result.position;
      }
    } else {
      const ray = viewer.camera.getPickRay(pos);
      cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    }
    return cartesian;
  }
  /**
   * 销毁
   */
  destroy() {
    this.deactivate();
    this.viewer = null;
    this.positions = null;
    this.pointer = null;
    this.measureEntity = null;
    this.handler = null;
    this.measureOptions = null;
    this.pointerOptions = null;
  }
}

/**
 * 测量距离
 */
class MeasureDistance extends MeasureTool {
  constructor(viewer) {
    super(viewer);
    let me = this;
    this.measureOptions = {
      name: "measure-line",
      polyline: {
        show: true,
        positions: new Cesium.CallbackProperty(() => {
          return me.positions;
        }, false),
        material: Cesium.Color.CHARTREUSE,
        width: 3,
        depthFailMaterial: Cesium.Color.CHARTREUSE,
      },
    };

    this.labelOptions = {
      name: "measure-label",
      position: new Cesium.CallbackProperty(() => {
        return me.positions[me.positions.length - 1];
      }, false),
      label: {
        text: new Cesium.CallbackProperty(() => {
          const distance = getSpaceDistance(me.positions);
          return distance >= 1000
            ? `${Math.round((distance / 1000) * 100) / 100}公里`
            : `${Math.round(distance * 100) / 100}米`;
        }, false),
        font: "15px sans-serif",
        fillColor: Cesium.Color.GOLD,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    };
  }
}

/**
 * 测量面积
 */
class MeasureArea extends MeasureTool {
  constructor(viewer) {
    super(viewer);

    const me = this;
    this.measureOptions = {
      name: "measure-polygon",
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => {
          return {
            positions: me.positions,
          };
        }, false),
        perPositionHeight: true,
        material: Cesium.Color.GREEN.withAlpha(0.5),
      },
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          return me.positions.concat(me.positions[0]);
        }, false),
        material: Cesium.Color.CHARTREUSE,
        width: 3,
        depthFailMaterial: Cesium.Color.CHARTREUSE,
      },
    };

    this.labelOptions = {
      name: "measure-label",
      position: new Cesium.CallbackProperty(() => {
        return me.positions[me.positions.length - 1];

        // if (me.positions.length <= 2) {
        //   return me.positions[me.positions.length - 1];
        // } else {
        //   const positions = me.positions.concat(me.positions[0]);
        //   const points = positions.map((pos) => {
        //     const coord = Cesium.Cartographic.fromCartesian(pos);
        //     // return {
        //     //     lon: coord.longitude,
        //     //     lat: coord.latitude
        //     // }
        //     return [
        //       Cesium.Math.toDegrees(coord.longitude),
        //       Cesium.Math.toDegrees(coord.latitude),
        //     ];
        //   });
        //   const polygon = turf.polygon([points]);
        //   const center = turf.center(polygon).geometry.coordinates;
        //   return Cesium.Cartesian3.fromDegrees(center[0], center[1]);
        // }
      }, false),
      label: {
        text: new Cesium.CallbackProperty(() => {
          const area = getArea(me.positions.concat(me.positions[0]));
          return area >= 1e7
            ? `${Math.round((area / 1e7) * 100) / 100}平方公里`
            : `${Math.round(area * 100) / 100}平方米`;
        }, false),
        font: "15px sans-serif",
        fillColor: Cesium.Color.GOLD,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    };
  }
}

class Measure {
  constructor(viewer, type = MeasureType.DISTANCE) {
    this.viewer = viewer;
    if (type == MeasureType.DISTANCE) {
      return new MeasureDistance(viewer);
    }
    if (type == MeasureType.AREA) {
      return new MeasureArea(viewer);
    }
  }
}

Cesium.Measure = Measure;
Cesium.MeasureType = MeasureType;
