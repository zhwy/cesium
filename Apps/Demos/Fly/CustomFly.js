class CustomFly {
    constructor(viewer) {
        let me = this;
        this.viewer = viewer;
        this.scene = viewer.scene;
        this.camera = viewer.camera;
        this.viewList = [];
        this.l = 0;
        this.b = 0;
        this.isStop = true;//用于判断执行的时暂停还是停止

        this.intervalHandler = null;
        this.deltaX = 0;
        this.deltaY = 0;
        this.deltaZ = 0;
        this.deltaH = 0;
        this.deltaP = 0;

        this.pauseView = {};//储存暂停时的视角

        this.helperEntity = viewer.entities.add({
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    if (me.viewList.length > 1) {
                        return me.viewList.map(view => {
                            return Cesium.Cartesian3.fromDegrees(view.lng, view.lat, view.height)
                        })
                    } else {
                        return null
                    }
                }, false)
            }
        })


    }
    /**
     * 添加视角
     */
    addView() {
        let view = this._getCameraView();
        this.viewList.push(view);
    }
    /**
     * 开始飞行
     */
    fly() {
        if (this.viewList.length > 1) {
            this._enableMouseEvt(false);
            let nowView;
            if (this.isStop) {
                nowView = this.viewList[this.l];
            } else { //暂停
                nowView = this.pauseView;
            }
            this.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(nowView.lng, nowView.lat, nowView.height),
                orientation: {
                    heading: nowView.heading,
                    pitch: nowView.pitch,
                    roll: 0
                }
            })
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
        this._enableMouseEvt(true);

    }
    /**
     * 暂停飞行
     */
    pause() {
        clearInterval(this.intervalHandler);
        this.intervalHandler = null;
        this.isStop = false;

        //获取暂停时相机视角
        this.pauseView = this._getCameraView();
        // this._enableMouseEvt(true);

    }
    //设置相机视角
    _setCamera() {
        let set = this.viewList[this.l].time * 20;
        this.camera.setView({
            orientation: {
                heading: this.camera.heading + this.deltaH / set,
                pitch: this.camera.pitch + this.deltaP / set,
                roll: 0
            }
        })
        this.camera.move(new Cesium.Cartesian3(this.deltaX, this.deltaY, this.deltaZ), 1 / set);
        this.b--;
        if (this.b == 0) {
            this.l++;
            clearInterval(this.intervalHandler);
            this.intervalHandler = null;
            this._interval();
        }
    }
    _interval() {
        let me = this;
        let l = this.l;
        if (this.isStop) {
            this.b = this.viewList[l].time * 20;
        } else {
            this.isStop = true;
        }
        if (this.viewList[l + 1]) {
            let nowView = this.viewList[l];
            let nextView = this.viewList[l + 1];
            let now = Cesium.Cartesian3.fromDegrees(nowView.lng, nowView.lat, nowView.height);
            let next = Cesium.Cartesian3.fromDegrees(nextView.lng, nextView.lat, nextView.height);
            this.deltaX = next.x - now.x;
            this.deltaY = next.y - now.y;
            this.deltaZ = next.z - now.z;
            this.deltaP = nextView.pitch - nowView.pitch;
            this.deltaH = nextView.heading - nowView.heading;
            this.intervalHandler = setInterval(() => {
                me._setCamera()
            }, 20);
        } else {
            this.isStop = true;
            this.l = 0;
        }
    }
    //飞行时禁止鼠标事件
    _enableMouseEvt(enable) {
        this.scene.screenSpaceCameraController.enableRotate = enable;
        this.scene.screenSpaceCameraController.enableTranslate = enable;
        this.scene.screenSpaceCameraController.enableZoom = enable;
        this.scene.screenSpaceCameraController.enableTilt = enable;
        this.scene.screenSpaceCameraController.enableLook = enable;
    }
    //获取相机视角
    _getCameraView() {
        let viewer = this.viewer;
        let cameraCart = viewer.camera.positionCartographic;
        return {
            lng: Cesium.Math.toDegrees(cameraCart.longitude),
            lat: Cesium.Math.toDegrees(cameraCart.latitude),
            height: cameraCart.height,
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
            time: 10
        }
    }

}