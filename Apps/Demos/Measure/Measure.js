/*** 来源 https://www.jianshu.com/p/4a97d3ed4a06 ***/

//空间两点距离计算函数
function getSpaceDistance(positions) {
    let distance = 0;
    for (let i = 0; i < positions.length - 1; i++) {

        let point1cartographic = Cesium.Cartographic.fromCartesian(positions[i]);
        let point2cartographic = Cesium.Cartographic.fromCartesian(positions[i + 1]);
        /**根据经纬度计算出距离**/
        let geodesic = new Cesium.EllipsoidGeodesic();
        geodesic.setEndPoints(point1cartographic, point2cartographic);
        let s = geodesic.surfaceDistance;
        //console.log(Math.sqrt(Math.pow(distance, 2) + Math.pow(endheight, 2)));
        //返回两点之间的距离
        s = Math.sqrt(Math.pow(s, 2) + Math.pow(point2cartographic.height - point1cartographic.height, 2));
        distance = distance + s;
    }
    return distance.toFixed(2);
}

/*方向*/
function getBearing(from, to) {
    let lat1 = from.lat;
    let lon1 = from.lon;
    let lat2 = to.lat;
    let lon2 = to.lon;
    let angle = -Math.atan2(Math.sin(lon1 - lon2) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2));
    if (angle < 0) {
        angle += Math.PI * 2.0;
    }
    angle = Cesium.Math.toDegrees(angle);//角度
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
    let points = positions.map(pos => {
        let coord = Cesium.Cartographic.fromCartesian(pos);
        return {
            lon: coord.longitude,
            lat: coord.latitude
        }
    })
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
    return (res / 1000000.0).toFixed(4);
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
    s = Math.sqrt(Math.pow(s, 2) + Math.pow(point2cartographic.height - point1cartographic.height, 2));
    return s;
}

const MeasureType = {
    DISTANCE: 0,
    AREA: 1
}

/**
 * 测量基类
 */
class MeasureTool {
    constructor(viewer) {
        this.viewer = viewer;
        this.positions = null;
        this.pointer = null;//鼠标点
        this.measureEntity = null;
        this.handler = null;
        this.measureOptions = null;
        this.pointerOptions = null;
    }
    /**
     * 开始一次测量
     */
    activate() {

    }
    /**
     * 清除标记
     */
    clear() {
        this.viewer.entities.remove(this.pointer);
        this.viewer.entities.remove(this.measureEntity);
        this.pointer = null;
        this.measureEntity = null;
        this.positions = null;
    }
    /**
     * 停止
     */
    deactivate() {
        this.clear();
        if (!this.handler.isDestroyed()) {
            this.handler.destroy();
        }
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
            name: 'measure-line',
            polyline: {
                show: true,
                positions: new Cesium.CallbackProperty(() => {
                    return me.positions;
                }, false),
                material: Cesium.Color.CHARTREUSE,
                width: 5,
                clampToGround: true
            }
        };
        this.pointerOptions = {
            name: 'measure-pointer',
            position: new Cesium.CallbackProperty(() => {
                return me.positions[me.positions.length - 1];
            }, false),
            point: {
                pixelSize: 5,
                color: Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
            },
            label: {
                text: new Cesium.CallbackProperty(() => {
                    let distance = getSpaceDistance(me.positions);
                    return `${distance}米`;
                }, false),
                font: '15px sans-serif',
                fillColor: Cesium.Color.GOLD,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(20, -20),
            }
        }
    }
    activate() {
        let viewer = this.viewer;
        let me = this;

        this.measureEntity = viewer.entities.add(this.measureOptions);
        this.pointer = viewer.entities.add(this.pointerOptions);

        // 取消双击事件-追踪该位置
        // viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        this.positions = [];
        // let tooltip = document.getElementById("toolTip");
        let cartesian = null;
        // tooltip.style.display = "block";

        this.handler.setInputAction(function(movement) {
            // tooltip.style.left = movement.endPosition.x + 3 + "px";
            // tooltip.style.top = movement.endPosition.y - 25 + "px";
            // tooltip.innerHTML = '<p>单击开始，右击结束</p>';
            let ray = viewer.camera.getPickRay(movement.endPosition);
            cartesian = viewer.scene.globe.pick(ray, viewer.scene);
            if (cartesian) {
                if (me.positions.length > 0) {
                    me.positions.pop();
                }
                me.positions.push(cartesian);

            }

        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction(function(movement) {
            // tooltip.style.display = "none";
            // cartesian = viewer.scene.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
            // cartesian = viewer.scene.pickPosition(movement.position);
            let ray = viewer.camera.getPickRay(movement.position);
            cartesian = viewer.scene.globe.pick(ray, viewer.scene);
            if (cartesian) {
                me.positions.push(cartesian);
            }

        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction(function(movement) {
            me.handler.destroy(); //关闭事件句柄
            me.positions.pop(); //最后一个点无效    
            me.viewer.entities.remove(me.pointer);
            me.pointer = null;
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }
}

/**
 * 测量面积
 */
class MeasureArea extends MeasureTool {
    constructor(viewer) {
        super(viewer);

        let me = this;
        this.measureOptions = {
            name: 'measure-polygon',
            polygon: {
                hierarchy: new Cesium.CallbackProperty(() => {
                    return {
                        positions: me.positions
                    };
                }, false),
                material: Cesium.Color.GREEN.withAlpha(0.5),
            },
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    return me.positions.length == 2 ? me.positions : []
                }, false),
                material: Cesium.Color.CHARTREUSE,
                width: 5,
            }
        }
        this.pointerOptions = {
            name: 'measure-pointer',
            position: new Cesium.CallbackProperty(() => {
                return me.positions[me.positions.length - 1]
            }, false),
            point: {
                pixelSize: 5,
                color: Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            },
            label: {
                text: new Cesium.CallbackProperty(() => {
                    let area = getArea(me.positions);
                    return `${area}平方公里`;
                }, false),
                font: '15px sans-serif',
                fillColor: Cesium.Color.GOLD,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(20, -20),
            }
        }
    }
    activate() {
        let viewer = this.viewer;
        let me = this;

        this.pointer = viewer.entities.add(this.pointerOptions);
        this.measureEntity = viewer.entities.add(this.measureOptions);

        // 取消双击事件-追踪该位置        
        viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        // 鼠标事件
        this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene._imageryLayerCollection);
        this.positions = [];
        let cartesian = null;

        this.handler.setInputAction(function(movement) {
            let ray = viewer.camera.getPickRay(movement.endPosition);
            cartesian = viewer.scene.globe.pick(ray, viewer.scene);
            if (cartesian) {
                if (me.positions.length == 0) {
                    me.positions.push(cartesian);
                } else {
                    me.positions.pop();
                    me.positions.push(cartesian);
                }

            }

        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this.handler.setInputAction(function(movement) {
            // tooltip.style.display = "none";
            // cartesian = viewer.scene.pickPosition(movement.position); 
            let ray = viewer.camera.getPickRay(movement.position);
            cartesian = viewer.scene.globe.pick(ray, viewer.scene);
            // cartesian = viewer.scene.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
            if (me.positions.length == 0) {
                me.positions.push(cartesian.clone());
            }
            me.positions.push(cartesian);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        this.handler.setInputAction(function(movement) {
            me.handler.destroy();
            me.viewer.entities.remove(me.pointer);
            me.pointer = null;
            me.positions.pop();
        }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
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