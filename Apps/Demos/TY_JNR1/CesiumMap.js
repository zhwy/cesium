/* eslint-disable */
import * as Cesium from "../../../Build/CesiumUnminified/index.js";
import CesiumPopup from "./CesiumPopup.js";
window.CESIUM_BASE_URL = "../../../Build/CesiumUnminified/";
var CesiumMap = (function () {
  //三维视图
  var _viewer = undefined;
  var _originXY = {
    lng: 116.790876,
    lat: 36.498399,
    height: 100,
    mercX: 13001100.84,
    mercY: 4369418.66,
    roamH: 135,
    dixiaModelH: -22.5,
    dishangModelH: 12,
  }; //模型原点
  //限制相机范围
  var _cameraRange = {
    xmin: -3.14,
    ymin: -1.57,
    xmax: 3.14,
    ymax: 1.57,
  };
  var _adjustTerrain = false;

  //基础图层
  var _tunnelDataSource = undefined; //隧道标注
  var _terrainModel = undefined; //地形图层
  var _roadModel = undefined; //公路和隧道模型
  var _selectModel = undefined; //当前选择的模型
  var _clickModel = undefined;

  //图层控制
  var _tilesetShown = ["GD", "JG", "INIT"];
  var _tilesetConditionDict = {
    GD: [
      "regExp('Line').test(${name}) || regExp('对象').test(${name}) || regExp('qiaodun').test(${name})",
      "true",
    ], //轨道
    JG: ['regExp("JG").test(${name})', "true"], //结构
    SB: ['regExp("SB").test(${name})', "true"], //设备
    ZX: ['regExp("ZX").test(${name})', "true"], //装修
    MQ: ['regExp("MQ").test(${name})', "true"], //幕墙
    INIT: ["true", "false"],
  };
  var _tilesetCondition = [
    _tilesetConditionDict.GD,
    _tilesetConditionDict.JG,
    _tilesetConditionDict.INIT,
  ];
  var _tilesets = {};
  //漫游相关
  var _roamMode = false; //是否隧道漫游模式
  var _axisLine = {
    left: undefined,
    right: undefined,
  };
  //隧道漫游路径
  var _roamPath = undefined; //当前隧道漫游路径
  var _roadLine = undefined; //隧道轴线
  var _startTime = Cesium.JulianDate.fromDate(new Date(2015, 2, 25, 0)); //漫游起始时刻
  var _rightStopTime, _leftStopTime; //左右线漫游终止时刻
  var _directInfo = ""; //方向信息
  var _roamVelocity = 80; //漫游速度

  //相机相关
  var _looking = false; //是否正在转动视角
  var _originCamera = {
    position: new Cesium.Cartesian3.fromDegrees(116.794479, 36.495727, 500),
    direction: {
      heading: 0.421,
      pitch: Cesium.Math.toRadians(-35.0),
      roll: 0.0,
    },
    up: new Cesium.Cartesian3(0, 0, 1),
  }; //相机初始位置

  //自动播放
  var _noAutoFlySeconds = 10; //空闲时间
  var _noAutoFlyTimer = null; //空闲计时器

  //里程映射数据
  var _mileageDict = {
    ms: {}, //监测断面
    hd: {}, //隐患
  };

  //弹窗
  var _popup = undefined;

  //模型加载进度显示
  var _progress = {
    JG: 0,
    SB: 0,
    ZX: 0,
    MQ: 0,
    total: 0,
  };
  //配置
  var _options = {
    domId: "cesiumContainer",
    dataServerUrl: "http://192.168.0.116:5678/yifeng",
    dataFolder: "./",
    eagleMapFunc: () => {},
    eagleUpdateFunc: () => {},
    webApiAddress: "",
    key: "",
    adjustTerrain: false,
  };

  //模型位置
  var _tilesetsTransform = {
    SB: [116.821874, 36.555538, -145.4],
    ZX: [116.822034, 36.555553, -149.2],
    MQ: [116.82204, 36.55558, -148.5],
    JG: [116.822018, 36.555535, -151],
  };
  //展示地上还是地下模型
  var _modelShownType = 0;
  /**
   * 构造函数
   */
  function _cesiumMap(options) {
    var _this = this;
    if (_this instanceof _cesiumMap) {
      Object.assign(_options, options);
      Cesium.Camera.DEFAULT_VIEW_RECTANGLE = Cesium.Rectangle.fromDegrees(
        73.5,
        3.8,
        135.1,
        53.6
      );
      _adjustTerrain = options.adjustTerrain;
      _viewer = new Cesium.Viewer(_options.domId, {
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        timeline: false,
        infobox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        scene3DOnly: true,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
        fullscreenButton: false,
        //shadows: true,
        //terrainShadows:Cesium.ShadowMode.ENABLED,
        shouldAnimate: true,
        //sceneMode:Cesium.SceneMode.COLUMBUS_VIEW,
        /* imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
                    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
                    enablePickFeatures: false,
                    maximumLevel: 10,
                }), */
        //天地图
        //imageryProvider: new Cesium.WebMapTileServiceImageryProvider({
        //    url: 'http://t0.tianditu.gov.cn/img_w/wmts?tk=4945e19a7c4c2919ab4148b0a92e0e46',
        //    layer: 'img',
        //    style: 'default',
        //    format: 'tile',
        //    tileMatrixSetID: 'w',
        //    maximumLevel: 15,
        //    //subdomains: ["0", "1", "2", "3", "4", "5", "6"]
        //}),
        //高德
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
          url:
            "https://webst04.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
          //                layer: "tdtVecBasicLayer",
          //                style: "default",
          //                format: "image/png",
          //                tileMatrixSetID: "GoogleMapsCompatible",
          //                show: false
          maximumLevel: 5,
          tileMatrixSetID: "GoogleMapsCompatible",
        }),
        /* imageryProvider: new Cesium.SingleTileImageryProvider({
                    url: _options.dataFolder + 'white.png',
                }), */
        /* terrainProvider: new Cesium.CesiumTerrainProvider({
                    url: _options.dataServerUrl + "/terrain_tiles",
                }), */
      });
      //抗锯齿
      _viewer.scene.postProcessStages.fxaa.enabled = true;
      //debug模式
      //_viewer.extend(Cesium.viewerCesium3DTilesInspectorMixin);
      //_viewer.extend(Cesium.viewerCesiumInspectorMixin);
      //_viewer.extend(Cesium.viewerDragDropMixin);
      _viewer.scene.globe.depthTestAgainstTerrain = true;
      //阴影设置
      _viewer.shadowMap.softShadows = true;
      //_viewer.scene.globe.enableLighting = true;
      _viewer.shadowMap.maximumDistance = 1000;
      //天空设置
      //_viewer.scene.skyAtmosphere.brightnessShift = 1;
      //_viewer.scene.skyAtmosphere.saturationShift = -1;
      //相机位置初始化
      //_viewer.camera.up = Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Y);
      //模型显示不完整
      _viewer.scene.logarithmicDepthBuffer = false;
      //_viewer.scene.farToNearRatio = 1;
      setTimeout(function () {
        _viewer.camera.flyTo({
          destination: _originCamera.position,
          //duration: 0,
          //orientation: {
          //    direction: _originCamera.direction,
          //    up: _originCamera.up
          //},
          complete: function () {
            _viewer.camera.flyTo({
              destination: _originCamera.position,
              //orientation: {
              //    direction: _originCamera.direction,
              //    up: _originCamera.up
              //},
              orientation: _originCamera.direction,
              duration: 0.1,
              complete: function () {
                _cameraRange = {
                  xmin: 2.038237,
                  ymin: 0.636884,
                  xmax: 2.040302,
                  ymax: 0.640453,
                };
              },
            });
            _autoFly();
          },
        });
      }, 2000);
      //_viewer.camera.direction = _originCamera.direction;
      //_viewer.camera.position = _originCamera.position;
      //_viewer.camera.up = _originCamera.up;
      //关闭跟踪设置
      _viewer.trackedEntityChanged.addEventListener(function (e) {
        //if (_roamMode) {
        _viewer.trackedEntity = undefined;
        //}
      });
      _viewer.camera.moveEnd.addEventListener(function (e) {
        //if (!_roamMode) {
        _viewer.trackedEntity = undefined;
        //if (_viewer.camera.pitch < 0) {
        //    _viewer.camera.pitch = 0;
        //}
        //}
        if (!_roamMode) {
          //var point = Cesium.Cartographic.fromCartesian(_viewer.camera.position);
          var point = _wgs2gcj(_viewer.camera.position).merc;
          _options.eagleUpdateFunc(
            point[0],
            point[1],
            (_viewer.camera.heading / Math.PI) * 180 + 180,
            0,
            true,
            false,
            _directInfo
          );
        }
      });
      //弹窗初始化
      _popup = new CesiumPopup({
        id: "mousemove",
        viewer: _viewer,
        offsetX: 0,
        offsetY: 15,
        closeBtn: false,
      });

      _initCemeraEventType();
      _initTunnelLine();
      _initTerrainModel();
      _initRoam();
      _initEvent();
      //_test();
    } else {
      return new _cesiumMap(options);
    }
  }
  /**
   * 初始化相机控制类型
   */
  var _initCemeraEventType = function () {
    _viewer.scene.screenSpaceCameraController.inertiaSpin = 0.5;
    _viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.5;
    _viewer.scene.screenSpaceCameraController.inertiaZoom = 0.5;
    _viewer.scene.screenSpaceCameraController.tiltEventTypes = undefined;
    _viewer.scene.screenSpaceCameraController.rotateEventTypes = undefined;
    _viewer.scene.screenSpaceCameraController.rotateEventTypes = [
      Cesium.CameraEventType.LEFT_DRAG,
    ];

    _viewer.scene.screenSpaceCameraController.zoomEventTypes = [
      //Cesium.CameraEventType.MIDDLE_DRAG,
      Cesium.CameraEventType.WHEEL,
      //Cesium.CameraEventType.PINCH
    ];
  };
  /**
   * 初始化隧道路径
   */
  var _initTunnelLine = function () {
    $.getJSON(_options.dataFolder + "axises.json", function (result) {
      if (Cesium.defined(result.features)) {
        //var path = result.features["1"].geometry.paths[0];
        var path = result.features[0].geometry.coordinates;
        _roadLine = turf.lineString(path);
        _roadLine = turf.toWgs84(_roadLine);
      }
    });
  };
  /**
   * 相机移动至初始位置
   */
  var _flyToHome = function (completeFunc) {
    _roamMode = false;
    if (typeof _blockPlaneSource !== "undefined") {
      _blockPlaneSource.show = false;
    }
    _options.eagleMapFunc(false);
    _viewer.scene.screenSpaceCameraController.enableInputs = true;
    _viewer.clock.multiplier = 0;
    //_viewer.scene.globe.show = true;
    //_tunnelDataSource.show = true;
    var cameraPosXYZ = _viewer.camera.position.clone();
    var cameraPosBLH = Cesium.Cartographic.fromCartesian(cameraPosXYZ);
    var eaglePos = _wgs2gcj(cameraPosXYZ).merc;
    _viewer.camera.flyTo({
      //duration: 0,
      destination: Cesium.Cartesian3.fromRadians(
        cameraPosBLH.longitude,
        cameraPosBLH.latitude,
        2500
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0.0,
      },
      complete: completeFunc,
    });
    _options.eagleUpdateFunc(
      eaglePos[0],
      eaglePos[1],
      (_viewer.camera.heading / Math.PI) * 180 + 180,
      0,
      true,
      false,
      _directInfo
    );
  };
  /**
   * 初始化漫游模块
   */
  var _initRoam = function () {
    //轨迹漫游
    _roamMode = false;
    if (typeof _blockPlaneSource !== "undefined") {
      _blockPlaneSource.show = false;
    }
    _directInfo = "上行";
    var stop = _startTime.clone();
    _viewer.clock.startTime = _startTime.clone();
    _viewer.clock.stopTime = stop.clone();
    _viewer.clock.currentTime = _startTime.clone();
    _viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    _viewer.clock.multiplier = 0;

    $.getJSON(_options.dataFolder + "roam.json", function (result) {
      //右车道
      var rightPP = new Cesium.SampledPositionProperty();
      var rightPoints = result.right;
      for (var i = 0; i < rightPoints.length; i++) {
        var time = Cesium.JulianDate.addSeconds(
          _startTime,
          rightPoints[i].Mileage,
          new Cesium.JulianDate()
        );
        var origin = Cesium.Cartesian3.fromDegrees(
          _originXY.lng,
          _originXY.lat,
          0
        );

        var position = Cesium.Matrix4.multiplyByPoint(
          Cesium.Transforms.headingPitchRollToFixedFrame(
            origin,
            new Cesium.HeadingPitchRoll(0, 0, 0)
          ),
          new Cesium.Cartesian3(
            rightPoints[i].X,
            rightPoints[i].Y,
            rightPoints[i].Z + _originXY.roamH
          ),
          new Cesium.Cartesian3()
        );
        rightPP.addSample(time, position);
        if (i == rightPoints.length - 1) {
          stop = time.clone();
          _viewer.clock.stopTime = stop.clone();
          _rightStopTime = time.clone();
        }
      }
      _axisLine.right = _viewer.entities.add({
        availability: new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({
            start: _startTime,
            stop: _rightStopTime,
          }),
        ]),
        position: rightPP,
        orientation: new Cesium.VelocityOrientationProperty(rightPP),
      });
      //左车道
      var leftPP = new Cesium.SampledPositionProperty();
      var leftPoints = result.left;
      for (var i = 0; i < leftPoints.length; i++) {
        var time = Cesium.JulianDate.addSeconds(
          _startTime,
          leftPoints[i].Mileage,
          new Cesium.JulianDate()
        );
        var origin = Cesium.Cartesian3.fromDegrees(
          _originXY.lng,
          _originXY.lat,
          0
        );
        var position = Cesium.Matrix4.multiplyByPoint(
          Cesium.Transforms.headingPitchRollToFixedFrame(
            origin,
            new Cesium.HeadingPitchRoll(0, 0, 0)
          ),
          new Cesium.Cartesian3(
            leftPoints[i].X,
            leftPoints[i].Y,
            leftPoints[i].Z + _originXY.roamH
          ),
          new Cesium.Cartesian3()
        );
        leftPP.addSample(time, position);
        if (i == leftPoints.length - 1) {
          _leftStopTime = time.clone();
        }
      }
      _axisLine.left = _viewer.entities.add({
        availability: new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({
            start: _startTime,
            stop: _leftStopTime,
          }),
        ]),
        position: leftPP,
        orientation: new Cesium.VelocityOrientationProperty(leftPP),
      });
      //初始化
      _roamPath = _axisLine.right;
    });

    _initRoadModel();
    var cameraDirection = 1;
    var height = 0,
      lng = 0,
      lat = 0;
    var keydown = function (e) {
      if (_roamMode) {
        switch (e.keyCode) {
          case "W".charCodeAt(0):
            _viewer.clock.multiplier = _roamVelocity * cameraDirection;
            break;
          case "S".charCodeAt(0):
            _viewer.clock.multiplier = -_roamVelocity * cameraDirection;
            break;
        }
      } else {
        //调整地形位置

        if (_adjustTerrain) {
          switch (e.keyCode) {
            case "W".charCodeAt(0):
              //_changeModelHeight(_terrainModel, 0, 0, 0.000001);
              //lat += 0.000001;
              break;
            case "S".charCodeAt(0):
              //_changeModelHeight(_terrainModel, 0, 0, -0.000001);
              //lat -= 0.000001;
              break;
            case "A".charCodeAt(0):
              //_changeModelHeight(_terrainModel, 0, -0.000001, 0);
              //lng += 0.000001;
              break;
            case "D".charCodeAt(0):
              //_changeModelHeight(_terrainModel, 0, 0.000001, 0);
              //lng -= 0.000001;
              break;
            case "Z".charCodeAt(0):
              //_changeModelHeight(_terrainModel, -1);
              var delta = -0.5;
              height += delta;
              //_changeModelPosition(testModel, 0, 0, delta, true);
              break;
            case "X".charCodeAt(0):
              //_changeModelHeight(_terrainModel, 1);
              var delta = 0.5;
              height += delta;
              //_changeModelPosition(testModel, 0, 0, delta, true);
              break;
          }
          console.log({ lng: lng, lat: lat, height: height });
        }
      }
    };
    document.addEventListener("keydown", keydown);
    window.parent.document.addEventListener("keydown", keydown);
    var isTurning = false;
    _looking = false;
    var keyup = function (e) {
      if (_roamMode) {
        switch (e.keyCode) {
          case 27: //esc
            _flyToHome();
            _changeTips();
            break;
          case "W".charCodeAt(0): //w
            _viewer.clock.multiplier = 0;
            break;
          case "S".charCodeAt(0): //s
            _viewer.clock.multiplier = 0;
            break;
          case "A".charCodeAt(0): //a
            _roamPath = cameraDirection > 0 ? _axisLine.left : _axisLine.right;
            stop = (cameraDirection > 0
              ? _leftStopTime
              : _rightStopTime
            ).clone();
            _viewer.clock.stopTime = stop.clone();
            _viewer.clock.startTime = _startTime.clone();
            _directInfo = cameraDirection > 0 ? "下行" : "上行";
            $("#direction").text("当前位于" + _directInfo + "线");
            break;
          case "D".charCodeAt(0): //d
            _roamPath = cameraDirection > 0 ? _axisLine.right : _axisLine.left;
            stop = (cameraDirection > 0
              ? _rightStopTime
              : _leftStopTime
            ).clone();
            _viewer.clock.stopTime = stop.clone();
            _viewer.clock.startTime = _startTime.clone();
            _directInfo = cameraDirection > 0 ? "上行" : "下行";
            $("#direction").text("当前位于" + _directInfo + "线");
            break;
          case "R".charCodeAt(0): //r
            var position1 = _roamPath.position
              .getValue(_viewer.clock.currentTime)
              .clone();
            var position2 = _roamPath.position.getValue(
              Cesium.JulianDate.addSeconds(
                _viewer.clock.currentTime,
                10,
                new Cesium.JulianDate()
              )
            );
            if (typeof position2 === "undefined") {
              position2 = position1.clone();
              position1 = _roamPath.position.getValue(
                Cesium.JulianDate.addSeconds(
                  _viewer.clock.currentTime,
                  -10,
                  new Cesium.JulianDate()
                )
              );
            }
            var cartographic1 = Cesium.Cartographic.fromCartesian(position1);
            var cartographic2 = Cesium.Cartographic.fromCartesian(position2);
            var dx = cartographic2.latitude - cartographic1.latitude;
            var dy = cartographic2.longitude - cartographic1.longitude;
            var heading = Cesium.Cartesian2.angleBetween(
              Cesium.Cartesian2.UNIT_X,
              new Cesium.Cartesian2(dx, dy)
            );
            isTurning = true;
            _looking = false;
            _viewer.camera.flyTo({
              destination: _viewer.camera.position,
              orientation: {
                heading: dy > 0 ? heading : Math.PI * 2 - heading,
                //heading: 0,
                pitch: 0,
                roll: 0,
              },
              complete: function () {
                isTurning = false;
              },
            });
            break;
          case "T".charCodeAt(0): //t
            var position1 = _roamPath.position
              .getValue(_viewer.clock.currentTime)
              .clone();
            var position2 = _roamPath.position.getValue(
              Cesium.JulianDate.addSeconds(
                _viewer.clock.currentTime,
                10,
                new Cesium.JulianDate()
              )
            );
            if (typeof position2 === "undefined") {
              position2 = position1.clone();
              position1 = _roamPath.position.getValue(
                Cesium.JulianDate.addSeconds(
                  _viewer.clock.currentTime,
                  -10,
                  new Cesium.JulianDate()
                )
              );
            }
            var cartographic1 = Cesium.Cartographic.fromCartesian(position1);
            var cartographic2 = Cesium.Cartographic.fromCartesian(position2);
            var dx = cartographic2.latitude - cartographic1.latitude;
            var dy = cartographic2.longitude - cartographic1.longitude;
            var heading = Cesium.Cartesian2.angleBetween(
              Cesium.Cartesian2.UNIT_X,
              new Cesium.Cartesian2(dx, dy)
            );
            isTurning = true;
            _looking = false;
            _viewer.camera.flyTo({
              destination: _viewer.camera.position,
              orientation: {
                heading: (dy > 0 ? heading : Math.PI * 2 - heading) + Math.PI,
                //heading: 0,
                pitch: 0,
                roll: 0,
              },
              complete: function () {
                isTurning = false;
              },
            });
            break;
        }
      }
    };
    document.addEventListener("keyup", keyup);
    window.parent.document.addEventListener("keyup", keyup);
    var trackHandler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
    var startMousePosition;
    var mousePosition;

    trackHandler.setInputAction(function (movement) {
      _stopAutoFly();
      if (_roamMode) {
        _viewer.scene.screenSpaceCameraController.enableInputs = false;
      }
      _looking = true;
      mousePosition = startMousePosition = Cesium.Cartesian3.clone(
        movement.position
      );
    }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
    trackHandler.setInputAction(function (movement) {
      //if (_roamMode) {
      mousePosition = movement.endPosition;
      //}
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    trackHandler.setInputAction(function (position) {
      _stopAutoFly();
      //if (_roamMode) {
      _looking = false;
      //}
    }, Cesium.ScreenSpaceEventType.RIGHT_UP);
    trackHandler.setInputAction(function (movement) {
      _stopAutoFly();
      var scene = _viewer.scene;
      if (scene.mode !== Cesium.SceneMode.MORPHING && !_roamMode) {
        var pickedObject = scene.pick(movement.position);
        if (
          scene.pickPositionSupported &&
          Cesium.defined(pickedObject) &&
          Cesium.defined(pickedObject.tileset) &&
          pickedObject.tileset.origin == "GD"
        ) {
          var pos = scene.pickPosition(movement.position);
          var cartesian = _wgs2gcj(pos).cartesian;
          //var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          if (Cesium.defined(_roadLine) && _rightStopTime) {
            //var pt = turf.point([Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude)]);
            //var snapped = turf.nearestPointOnLine(_roadLine, pt);
            //var timeSum = (_directInfo == "上行" ? _rightStopTime.secondsOfDay : _leftStopTime.secondsOfDay) - _startTime.secondsOfDay;
            //var dist = snapped.properties.location / turf.length(_roadLine) * timeSum;

            //二分查找法 与走向有关，下为济南R1用
            var si = 0;
            var ei = _rightStopTime.secondsOfDay - _startTime.secondsOfDay;
            var ti = -1;
            while (si < ei) {
              var mid = parseInt(si + (ei - si) / 2);
              var midPos0 = _roamPath.position.getValue(
                Cesium.JulianDate.addSeconds(
                  _startTime.clone(),
                  mid,
                  new Cesium.JulianDate()
                )
              );
              var midPos1 = _roamPath.position.getValue(
                Cesium.JulianDate.addSeconds(
                  _startTime.clone(),
                  mid + 1,
                  new Cesium.JulianDate()
                )
              );
              if ((cartesian.y - midPos0.y) * (cartesian.y - midPos1.y) <= 0) {
                ti = mid;
                break;
              } else if (midPos0.y > midPos1.y) {
                if (cartesian.y > midPos0.y) {
                  ei = mid;
                } else {
                  si = mid + 1;
                }
              } else if (midPos0.y <= midPos1.y) {
                if (cartesian.x > midPos1.x) {
                  ei = mid;
                } else {
                  si = mid + 1;
                }
              }
            }
            if (ti) {
              _viewer.clock.startTime = _startTime.clone();
              stop = _rightStopTime.clone();
              _viewer.clock.stopTime = stop.clone();
              _viewer.clock.currentTime = Cesium.JulianDate.addSeconds(
                _startTime,
                ti,
                new Cesium.JulianDate()
              );
              _roamPath = _axisLine.right;
              _switchTrackMode(0);
              //_viewer.scene.globe.show = false;
              _options.eagleMapFunc(true);
              //_tunnelDataSource.show = false;
            }
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    _viewer.clock.onTick.addEventListener(function (clock) {
      //调整相机位置
      var loc = Cesium.Cartographic.fromCartesian(_viewer.camera.position);
      var change = false;
      if (loc.longitude < _cameraRange.xmin) {
        loc.longitude = _cameraRange.xmin;
        change = true;
      }
      if (loc.longitude > _cameraRange.xmax) {
        loc.longitude = _cameraRange.xmax;
        change = true;
      }
      if (loc.latitude < _cameraRange.ymin) {
        loc.latitude = _cameraRange.ymin;
        change = true;
      }
      if (loc.latitude > _cameraRange.ymax) {
        loc.latitude = _cameraRange.ymax;
        change = true;
      }
      if (change) {
        loc = Cesium.Cartesian3.fromRadians(
          loc.longitude,
          loc.latitude,
          loc.height
        );
        _viewer.camera.position = loc;
      }

      var x = 0,
        y = 0;
      if (_looking && !isTurning) {
        var width = _viewer.scene.canvas.clientWidth;
        var height = _viewer.scene.canvas.clientHeight;
        x = (mousePosition.x - startMousePosition.x) / width;
        y = -(mousePosition.y - startMousePosition.y) / height;
        var lookFactor = 0.2;
        _viewer.camera.setView({
          orientation: {
            heading: _viewer.camera.heading + x * lookFactor,
            pitch: _viewer.camera.pitch + y * lookFactor,
            roll: 0,
          },
        });
      }
      if (_roamMode) {
        var seconds = clock.currentTime.secondsOfDay - _startTime.secondsOfDay;
        var side = _directInfo == "上行" ? "right" : "left";
        var position = _roamPath.position.getValue(clock.currentTime).clone();
        if (_viewer.clock.multiplier != 0) {
          var pos = position.clone();
          var nextpos = _roamPath.position.getValue(
            Cesium.JulianDate.addSeconds(
              clock.currentTime,
              1,
              new Cesium.JulianDate()
            )
          );
          if (typeof nextpos === "undefined") {
            nextpos = position.clone();
            pos = _roamPath.position.getValue(
              Cesium.JulianDate.addSeconds(
                clock.currentTime,
                -1,
                new Cesium.JulianDate()
              )
            );
          }
          var direction = Cesium.Cartesian3.subtract(
            nextpos,
            pos,
            new Cesium.Cartesian3()
          );
          var angle = Cesium.Cartesian3.angleBetween(
            direction,
            _viewer.camera.direction
          );
          var cameraDirection_old = cameraDirection;
          if (angle > -Math.PI / 2 && angle < Math.PI / 2) {
            cameraDirection = 1;
          } else {
            cameraDirection = -1;
          }
          if (cameraDirection_old != cameraDirection) {
            _viewer.clock.multiplier = -_viewer.clock.multiplier;
          }
          //console.log(Cesium.Cartographic.fromCartesian(_viewer.camera.position));
        }
        var oldpos = _viewer.camera.position.clone();

        var ismove = !oldpos.equals(position);
        if (ismove) {
          var elli = _viewer.scene.globe.ellipsoid;
          var old = elli.cartesianToCartographic(oldpos);
          var pos = elli.cartesianToCartographic(position);

          //console.log('deltaLng: ' + Cesium.Math.toDegrees(pos.longitude - old.longitude) + ' deltaLat: ' + Cesium.Math.toDegrees(pos.latitude - old.latitude));

          _viewer.camera.position = position;
        }
        if ((_looking && (x != 0 || y != 0)) || ismove) {
          var point = _wgs2gcj(_viewer.camera.position).merc;
          _options.eagleUpdateFunc(
            point[0],
            point[1],
            (_viewer.camera.heading / Math.PI) * 180 + 180,
            0,
            true,
            true,
            _directInfo
          );
        }
      }
    });
  };
  /**
   * 切换漫游模式
   */
  var _switchTrackMode = function (angle) {
    _roamMode = true;
    _directInfo = "上行";
    if (typeof _blockPlaneSource !== "undefined") {
      _blockPlaneSource.show = true;
    }
    if (_roamMode) {
      _viewer.scene.screenSpaceCameraController.enableInputs = false;
      //viewer.clock.currentTime = Cesium.JulianDate.addSeconds(start, 100, new Cesium.JulianDate()).clone();
      var position1 = _roamPath.position
        .getValue(_viewer.clock.currentTime)
        .clone();
      var position2 = _roamPath.position
        .getValue(
          Cesium.JulianDate.addSeconds(
            _viewer.clock.currentTime,
            10,
            new Cesium.JulianDate()
          )
        )
        .clone();
      var cartographic1 = Cesium.Cartographic.fromCartesian(position1);
      var cartographic2 = Cesium.Cartographic.fromCartesian(position2);
      var dx = cartographic2.latitude - cartographic1.latitude;
      var dy = cartographic2.longitude - cartographic1.longitude;
      var heading = Cesium.Cartesian2.angleBetween(
        Cesium.Cartesian2.UNIT_X,
        new Cesium.Cartesian2(dx, dy)
      );
      _viewer.camera.setView({
        orientation: {
          heading:
            (dy > 0 ? heading : Math.PI * 2 - heading) +
            (angle / 180) * Math.PI,
          //heading: 0,
          pitch: 0,
          roll: 0,
        },
      });
    } else {
      _viewer.scene.screenSpaceCameraController.enableInputs = true;
    }
    return _roamMode;
  };
  /**
   * 里程转字符串
   */
  var _mileageToString = function (mileage) {
    var start = parseInt(mileage / 1000);
    var end = mileage - start * 1000;
    end = ("000" + end.toFixed(0)).slice(-3);
    return "K" + start + "+" + end;
  };
  /**
   * 事件绑定
   */
  var _initEvent = function () {
    //双击事件
    var handler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
    handler.setInputAction(function (movement) {
      _stopAutoFly();
      var scene = _viewer.scene;
      if (scene.mode !== Cesium.SceneMode.MORPHING) {
        var pickedObject = scene.pick(movement.position);
        var cartesian;
        if (scene.pickPositionSupported && Cesium.defined(pickedObject)) {
          cartesian = scene.pickPosition(movement.position);
        } else {
          cartesian = scene.pickPosition(movement.position);
        }
        if (cartesian) {
          var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          var longitudeString = Cesium.Math.toDegrees(cartographic.longitude);
          var latitudeString = Cesium.Math.toDegrees(cartographic.latitude);
          var heightString = cartographic.height.toFixed(2);
          console.log(
            "blh:" + longitudeString + "," + latitudeString + "," + heightString
          );
          console.log(cartesian);
        }
        _changeTips();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    //鼠标移动事件
    handler.setInputAction(function (movement) {
      document.getElementById(_options.domId).style.cursor = "default";
      var scene = _viewer.scene;
      if (
        scene.mode !== Cesium.SceneMode.MORPHING &&
        !_looking &&
        _viewer.clock.multiplier == 0
      ) {
        try {
          var pickedObject = scene.pick(movement.endPosition);
          if (scene.pickPositionSupported && Cesium.defined(pickedObject)) {
            if (
              Cesium.defined(pickedObject.id) &&
              Cesium.defined(pickedObject.id.type)
            ) {
              document.getElementById(_options.domId).style.cursor = "pointer";
            }
            if (Cesium.defined(pickedObject.tileset)) {
              if (
                pickedObject.tileset.origin != "DX" &&
                pickedObject.tileset.origin != "GD"
              ) {
                var name = pickedObject.getProperty("name");
                //var isTunnelBlock = new RegExp('YF').test(name);
                //if (isTunnelBlock) { //隧道
                document.getElementById(_options.domId).style.cursor =
                  "pointer";
                if (Cesium.defined(_selectModel)) {
                  //var show = true;
                  //if (Cesium.defined(_selectModel.tileset.style)) {
                  //    show = _selectModel.tileset.style.show.expression
                  //}
                  if (_selectModel != _clickModel) {
                    if (Cesium.defined(_selectModel.color)) {
                      _selectModel.color = new Cesium.Color(1, 1, 1, 1);
                    }
                  }
                }
                _selectModel = pickedObject;
                if (Cesium.defined(_selectModel.color)) {
                  if (_selectModel != _clickModel) {
                    _selectModel.color = new Cesium.Color(1, 1, 0);
                  }
                }
                if (
                  movement.endPosition &&
                  scene.pickPosition(movement.endPosition)
                ) {
                  //_popup.show(
                  //    scene.pickPosition(movement.endPosition),
                  //    //_mileageToString(Number(name.split('_')[4]))
                  //    name
                  //);
                } else {
                  _popup.hide();
                }
                //}
                //else {
                //    _popup.hide();
                //    if (Cesium.defined(_selectModel)) {
                //        var show = true;
                //        if (Cesium.defined(_selectModel.tileset.style.show)) {
                //            show = _selectModel.tileset.style.show.expression
                //        }
                //        _selectModel.tileset.style = new Cesium.Cesium3DTileStyle({
                //            color: _riskColorStyle,
                //            show: show
                //        });
                //    }
                //}
              } else {
                _popup.hide();
                if (Cesium.defined(_selectModel)) {
                  if (Cesium.defined(_selectModel.color)) {
                    if (_selectModel != _clickModel) {
                      _selectModel.color = new Cesium.Color(1, 1, 0);
                    }
                  }
                }
              }
            } else {
              if (Cesium.defined(_selectModel)) {
                if (Cesium.defined(_selectModel.color)) {
                  if (_selectModel != _clickModel) {
                    _selectModel.color = new Cesium.Color(1, 1, 1, 1);
                  }
                }
              }
              _popup.hide();
            }
          } else {
            if (Cesium.defined(_selectModel)) {
              if (Cesium.defined(_selectModel.color)) {
                if (_selectModel != _clickModel) {
                  _selectModel.color = new Cesium.Color(1, 1, 1, 1);
                }
              }
            }
            _popup.hide();
          }
        } catch (err) {
          //debugger
          _selectModel = null;
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    //相机事件
    _viewer.scene.screenSpaceCameraController.maximumZoomDistance = 4000;
    _viewer.scene.screenSpaceCameraController.minimumZoomDistance = 10;
    //_viewer.scene.screenSpaceCameraController.enableTilt = false;
  };
  /**
   * 里程转时间点
   */
  var _mileage2time = function (roamPath, mileage) {
    var time = mileage;
    return time;
  };
  /**
   * 时间点转里程
   */
  var _time2mileage = function (roamPath, seconds) {
    var mileage = seconds;
    return mileage;
  };
  /**
   * 初始化地形模型
   */
  var _initTerrainModel = function () {
    _terrainModel = new Cesium.Cesium3DTileset({
      url: _options.dataServerUrl + "/terrain/tileset.json",
      show: true,
      luminanceAtZenith: 1,
      lightColor: new Cesium.Cartesian3(1, 1, 1),
      maximumMemoryUsage: 64,
      //debugShowGeometricError: true,
      //debugShowBoundingVolume:true,
      //debugShowUrl: true,
    });
    var lng = (-0.00025 / 180) * Math.PI;
    var lat = (0.000108 / 180) * Math.PI;
    //_changeModelHeight(_terrainModel, _originXY.height, 0, 0);
    //_changeModelPosition(_terrainModel, 116.839708, 36.590748, -33.2 + _originXY.height);
    _changeModelPosition(_terrainModel, 0, 0, 0);

    _terrainModel.origin = "DX";
    _viewer.scene.primitives.add(_terrainModel);
  };

  /**
   * 初始化轨道
   */
  var _initRoadModel = function (data) {
    _roadModel = new Cesium.PrimitiveCollection({
      show: true,
      destroyPrimitives: true,
    });
    var model = new Cesium.Cesium3DTileset({
      url: _options.dataServerUrl + "/GD/tileset.json",
      //url:'http://localhost:9002/api/folder/2847d3e291e14660813fc95fcf1ede3d/tileset.json',
      luminanceAtZenith: 1,
      lightColor: new Cesium.Cartesian3(1, 1, 1),
      //url: _options.dataServerUrl + '/tileset.json',
      //immediatelyLoadDesiredLevelOfDetail: true,
      //debugShowGeometricError: true,
      //debugShowBoundingVolume:true,
      //debugShowUrl: true,
      //loadSiblings: false,
      maximumMemoryUsage: 64,
    });
    model.origin = "GD";
    //_changeModelHeight(model, _originXY.height)
    //_changeModelPosition(model, 116.847671, 36.589851, 150.3);
    _changeModelPosition(model, 0, 0, 0);

    var jgModel = new Cesium.Cesium3DTileset({
      url: _options.dataServerUrl + "/JG/tileset.json",
      luminanceAtZenith: 1,
      lightColor: new Cesium.Cartesian3(1, 1, 1),
      maximumMemoryUsage: 64,
    });
    jgModel.origin = "JG";
    jgModel.loadProgress.addEventListener(function (
      numberOfPendingRequests,
      numberOfTilesProcessing
    ) {
      if (_roamMode) {
        $("#progress").show();
        _progress.JG += numberOfTilesProcessing;
        var total = _progress.JG + _progress.SB + _progress.MQ + _progress.ZX;
        if (total > 99) {
          total = 99;
        }
        $("#progress").text("模型切片加载中，" + total + "%");
      } else {
        $("#progress").hide();
      }
    });
    jgModel.allTilesLoaded.addEventListener(function () {
      _progress.JG = 0;
      if (_roamMode) {
        if (
          _progress.JG == 0 &&
          _progress.MQ == 0 &&
          _progress.SB == 0 &&
          _progress.ZX == 0
        ) {
          $("#progress").text("模型切片加载中，100%");
          var timing = setTimeout(function () {
            clearTimeout(timing);
            $("#progress").hide();
            $("#progress").text("模型切片加载中，0%");
          }, 1000);
        }
      } else {
        $("#progress").hide();
      }
    });
    //控制显示内容
    //jgModel.style = new Cesium.Cesium3DTileStyle();
    //jgModel.style.show = {
    //    conditions: [
    //        ['regExp("混凝土").test(${name})', 'true'],
    //        ['true', 'false']
    //    ]
    //}
    //_changeModelPosition(jgModel, 116.822018, 36.555535, -151);
    _changeModelPosition(jgModel, 0, 0, _originXY.dishangModelH);

    _tilesets = {
      SB: null,
      ZX: null,
      MQ: null,
      //GD: model,
      JG: jgModel,
      dixiaJG: null,
      dixiaMQ: null,
      dixiaZX: null,
    };

    //var sbModel = new Cesium.Cesium3DTileset({
    //    url: _options.dataServerUrl + '/SB/tileset.json',
    //    luminanceAtZenith: 1.5,
    //    lightColor: new Cesium.Cartesian3(1, 1, 1),
    //    maximumMemoryUsage: 16
    //});
    //_changeModelPosition(sbModel, 0, 0, _originXY.dishangModelH)
    jgModel.origin = "JG";
    _roadModel.add(model);
    _roadModel.add(jgModel);
    //_roadModel.add(mqModel);
    //_roadModel.add(zxModel);
    //_roadModel.add(sbModel);

    _viewer.scene.primitives.add(_roadModel);
    var handler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
    handler.setInputAction(function (movement) {
      _stopAutoFly();
      var scene = _viewer.scene;
      if (scene.mode !== Cesium.SceneMode.MORPHING) {
        var pickedObject = scene.pick(movement.position);
        if (scene.pickPositionSupported && Cesium.defined(pickedObject)) {
          if (Cesium.defined(pickedObject.tileset) && _roamMode) {
            var name = pickedObject.getProperty("name");
            if (
              scene.mode !== Cesium.SceneMode.MORPHING &&
              !_looking &&
              _viewer.clock.multiplier == 0
            ) {
              try {
                if (Cesium.defined(pickedObject.tileset)) {
                  if (
                    pickedObject.tileset.origin != "DX" &&
                    pickedObject.tileset.origin != "GD"
                  ) {
                    var name = pickedObject.getProperty("name");
                    document.getElementById(_options.domId).style.cursor =
                      "pointer";
                    if (Cesium.defined(_clickModel)) {
                      if (Cesium.defined(_clickModel.color)) {
                        _clickModel.color = new Cesium.Color(1, 1, 1, 1);
                      }
                    }
                    _clickModel = pickedObject;
                    if (Cesium.defined(_clickModel.color)) {
                      _clickModel.color = new Cesium.Color(0, 0, 1);
                    }
                  } else {
                    _popup.hide();
                    if (Cesium.defined(_clickModel)) {
                      if (Cesium.defined(_clickModel.color)) {
                        _clickModel.color = new Cesium.Color(0, 0, 1);
                      }
                    }
                  }
                } else {
                  if (Cesium.defined(_clickModel)) {
                    if (Cesium.defined(_clickModel.color)) {
                      _clickModel.color = new Cesium.Color(1, 1, 1, 1);
                    }
                  }
                  _popup.hide();
                }
              } catch (err) {
                //debugger
                _clickModel = null;
              }
            }
          }
        }
        //var cartesian;
        //if (scene.pickPositionSupported && Cesium.defined(pickedObject)) {
        //    cartesian = scene.pickPosition(movement.position);
        //} else {
        //    cartesian = scene.pickPosition(movement.position);
        //}
        //if (cartesian) {
        //    var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        //    var longitudeString = Cesium.Math.toDegrees(cartographic.longitude);
        //    var latitudeString = Cesium.Math.toDegrees(cartographic.latitude);
        //    var heightString = cartographic.height.toFixed(2);
        //    console.log("blh:" + longitudeString + "," + latitudeString + "," + heightString);
        //console.log(cartesian);
        //console.log(cartographic)
        //}
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  };
  /**
   *
   * */
  var _changeTips = function () {
    if (_roamMode) {
      $("#tooltip p").text(
        "操作提示：按W键前进；按S键后退；按A,D键切换轨道；鼠标右键转动视角；鼠标左键点击显示信息；按ESC退出漫游模式。"
      );
      $("#direction").text("当前位于" + _directInfo + "线");
      $("#direction").show();
    } else {
      $("#tooltip p").text(
        "操作提示：鼠标左键拖动，鼠标右键转动视角，鼠标滚轮缩放。鼠标左键双击模型进入漫游模式。"
      );
      $("#tooltip img").show();
      $("#direction").hide();
    }
  };
  var _readModel = function (content) {
    var tileset = new Cesium.Cesium3DTileset({
      url: _options.dataServerUrl + "/" + content + "/tileset.json",
      luminanceAtZenith: 1,
      lightColor: new Cesium.Cartesian3(1, 1, 1),
      maximumMemoryUsage: 64,
    });
    tileset.origin = content.replace("/", "");
    var change = _tilesetsTransform[content];
    //_changeModelPosition(tileset, change[0], change[1], change[2]);
    if (_modelShownType == 0) {
      _changeModelPosition(tileset, 0, 0, _originXY.dishangModelH);
    } else {
      _changeModelPosition(tileset, 0, 0, _originXY.dixiaModelH);
    }

    var cc = content.slice(-2);
    //显示进度
    //if (content == 'JG' || content.replace('/', '') == 'dixiaJG') {
    tileset.loadProgress.addEventListener(function (
      numberOfPendingRequests,
      numberOfTilesProcessing
    ) {
      if (_roamMode) {
        $("#progress").show();
        _progress[cc] += numberOfTilesProcessing;
        var total = _progress.JG + _progress.SB + _progress.MQ + _progress.ZX;
        if (total > 99) {
          total = 99;
        }
        $("#progress").text("模型切片加载中，" + total + "%");
      } else {
        $("#progress").hide();
      }
    });
    tileset.allTilesLoaded.addEventListener(function () {
      _progress[cc] = 0;
      if (_roadModel) {
        if (
          _progress.JG == 0 &&
          _progress.MQ == 0 &&
          _progress.SB == 0 &&
          _progress.ZX == 0
        ) {
          $("#progress").text("模型切片加载中，100%");
          var timing = setTimeout(function () {
            clearTimeout(timing);
            $("#progress").hide();
            $("#progress").text("模型切片加载中，0%");
          }, 1000);
        }
      } else {
        $("#progress").hide();
      }
    });
    //}
    return tileset;
  };

  var _wgs2gcj = function (cartesian) {
    var cart = Cesium.Cartographic.fromCartesian(cartesian);
    var lng = Cesium.Math.toDegrees(cart.longitude);
    var lat = Cesium.Math.toDegrees(cart.latitude);
    var resultC = Cesium.Cartesian3.fromDegrees(lng, lat, cart.height);
    return {
      cartesian: resultC,
      lnglat: [lng, lat],
      merc: _ll2merc(lng, lat),
    };
  };
  var _ll2merc = function (lng, lat) {
    let x = (lng * 20037508.34) / 180;
    let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    y = (y * 20037508.34) / 180;
    return [x, y];
  };

  var _changeModelPosition = function (
    tileset,
    lng,
    lat,
    height,
    adjust = false
  ) {
    tileset.readyPromise.then(function (argument) {
      var mat = Cesium.Matrix4.fromArray(tileset._root.transform);
      var pos = Cesium.Matrix4.getTranslation(mat, new Cesium.Cartesian3());
      var wpos = Cesium.Cartographic.fromCartesian(pos);
      if (wpos) {
        lng = Cesium.Math.toDegrees(wpos.longitude);
        lat = Cesium.Math.toDegrees(wpos.latitude);
        if (adjust) {
          height = wpos.height + height;
        } else {
          height = wpos.height + height + _originXY.height;
        }
      }

      var position = Cesium.Cartesian3.fromDegrees(lng, lat, height);
      var mat = Cesium.Transforms.eastNorthUpToFixedFrame(position);
      var rotationZ = Cesium.Matrix4.fromRotationTranslation(
        Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(0))
      );
      Cesium.Matrix4.multiply(mat, rotationZ, mat);
      tileset._root.transform = mat;
    });
  };
  var _changeModelHeight = function (tileset, height, lng = 0, lat = 0) {
    tileset.readyPromise.then(function () {
      var boundingSphere = tileset.boundingSphere;
      var cartographic = Cesium.Cartographic.fromCartesian(
        boundingSphere.center
      );
      var surface = Cesium.Cartesian3.fromRadians(
        cartographic.longitude,
        cartographic.latitude,
        0.0
      );
      var offset = Cesium.Cartesian3.fromRadians(
        cartographic.longitude + lng,
        cartographic.latitude + lat,
        height
      );
      var translation = Cesium.Cartesian3.subtract(
        offset,
        surface,
        new Cesium.Cartesian3()
      );
      var tmp = Cesium.Matrix4.add(
        tileset.modelMatrix,
        Cesium.Matrix4.fromTranslation(translation),
        new Cesium.Matrix4()
      );
      tileset.modelMatrix[12] = tmp[12];
      tileset.modelMatrix[13] = tmp[13];
      tileset.modelMatrix[14] = tmp[14];
    });
  };
  /**
   * 自动漫游
   */
  var _autoFly = function () {};
  /**
   * 关闭自动漫游
   */
  var _stopAutoFly = function () {};
  /**
   * 测试区
   */
  var _test = function () {
    var modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(116.7951196, 36.498481, _originXY.height)
    );
    var rotation = 0;
    Cesium.Matrix4.multiplyByMatrix3(
      modelMatrix,
      Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(rotation)),
      modelMatrix
    );
    //revit模型测试
    var revitModel = new Cesium.Cesium3DTileset({
      url: "http://localhost:8082/revit/tileset.json",
      modelMatrix: modelMatrix,
      //luminanceAtZenith: 0.2,
      lightColor: new Cesium.Cartesian3(1, 1, 1),
    });
    _roadModel.add(revitModel);
  };

  //公有方法
  _cesiumMap.prototype = {
    /**
     * 构造函数
     */
    constructor: _cesiumMap,
    /**
     * 获取视图
     */
    GetViewer: function () {
      return _viewer;
    },
    /**
     * 飞至隧道初始位置
     */
    FlyToHome: function () {
      _flyToHome();
    },
    /**
     * 飞至场景初始位置
     */
    FlyToOrigin: function () {
      _roamMode = false;
      _viewer.scene.screenSpaceCameraController.enableInputs = true;
      _viewer.clock.multiplier = 0;
      _viewer.camera.flyTo({
        destination: _originCamera.position,
        //orientation: {
        //    direction: _originCamera.direction,
        //    up: _originCamera.up
        //}
        orientation: _originCamera.direction,
      });
    },
    /**
     * 飞至上方俯视
     */
    FlyToArea: function (lng, lat, height) {
      _roamMode = false;
      if (typeof _blockPlaneSource !== "undefined") {
        _blockPlaneSource.show = true;
      }
      _options.eagleMapFunc(false);
      _viewer.scene.screenSpaceCameraController.enableInputs = true;
      _viewer.clock.multiplier = 0;
      //_tunnelDataSource.show = true;
      _viewer.camera.flyTo({
        //duration: 0,
        destination: Cesium.Cartesian3.fromRadians(
          (lng / 180) * Math.PI,
          (lat / 180) * Math.PI,
          height
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0.0,
        },
        complete: function () {
          var handle = setTimeout(function () {
            clearTimeout(handle);
            var point = _wgs2gcj(_viewer.camera.position).merc;
            _options.eagleUpdateFunc(
              point[0],
              point[1],
              (_viewer.camera.heading / Math.PI) * 180 + 180,
              0,
              true,
              false,
              _directInfo
            );
          }, 200);
        },
      });

      _changeTips();
    },
    /**
     * 定位隧道起始点
     */
    Locating: function (name) {
      event.stopPropagation();
      //if (!_roamMode) {
      _flyToHome();
      $.getJSON(_options.dataServerUrl + "/locations.json", function (result) {
        if (name in result) {
          _viewer.camera.flyTo({
            destination: new Cesium.Cartesian3(
              result[name].position[0],
              result[name].position[1],
              result[name].position[2]
            ),
            orientation: {
              direction: new Cesium.Cartesian3(
                result[name].direction[0],
                result[name].direction[1],
                result[name].direction[2]
              ),
              up: new Cesium.Cartesian3(
                result[name].up[0],
                result[name].up[1],
                result[name].up[2]
              ),
            },
          });
        }
      });
      //}
    },
    /**
     * 设置漫游速度
     * */
    SetRoamVelocity: function (velocity) {
      _roamVelocity = velocity;
    },
    /**
     * 显示模型
     * */
    SelectLayer: function (e) {
      //var model = _roadModel.get(0);
      //var conditions = model.style.show.conditionsExpression.conditions;
      //var index = _tilesetShown.indexOf(e.value);
      //if ( index< 0 && e.checked) {
      //    _tilesetShown.unshift(e.value);
      //    conditions.unshift(_tilesetConditionDict[e.value]);
      //    model.style = new Cesium.Cesium3DTileStyle({
      //        show: {
      //            conditions: conditions
      //        }
      //    })
      //}
      //if (index >= 0 && !e.checked) {
      //    _tilesetShown.splice(index, 1);
      //    conditions.splice(index, 1);
      //    model.style = new Cesium.Cesium3DTileStyle({
      //        show: {
      //            conditions: conditions
      //        }
      //    })
      //}
      var value, name;
      if (_modelShownType == 0) {
        value = e.value;
        name = e.value;
      }
      if (_modelShownType == 1) {
        value = "dixia" + e.value;
        name = "dixia/" + e.value;
      }

      if (_modelShownType == 2) {
        return;
      }
      if (!_roadModel.contains(_tilesets[value]) && e.checked) {
        _tilesets[value] = _readModel(name);
        _roadModel.add(_tilesets[value]);
      }
      //if (_roadModel.contains(_tilesets[value]) && e.checked) {
      //    _tilesets[value].show = true;
      //}
      if (_roadModel.contains(_tilesets[value]) && !e.checked) {
        _roadModel.remove(_tilesets[value]);
        //_tilesets[value].show = false;
      }
    },
    /**
     * 切换地上地下模型
     * */
    ShowModel: function (type) {
      var dishang = ["JG", "MQ", "SB", "ZX"];
      var dixia = ["dixia/JG", "dixia/MQ", "dixia/ZX"];
      _modelShownType = type;
      if (type == 0) {
        //显示地上站，删除地下
        dixia.forEach(function (item) {
          var name = item.replace("/", "");
          if (_roadModel.contains(_tilesets[name])) {
            _roadModel.remove(_tilesets[name]);
            //_tilesets[name].show = false;
          }
        });
        $("#selector")[0].children[0][0].disabled = "";
        var item = "JG";
        //dishang.forEach(function (item) {
        if (!_roadModel.contains(_tilesets[item])) {
          _tilesets[item] = _readModel(item);
          _roadModel.add(_tilesets[item]);
        } //else {
        //    _tilesets[item].show = true;
        //}
        //})
      }
      if (type == 1) {
        //显示地下站，删除地上
        $("#selector")[0].children[0][0].disabled = "disabled"; //地下站均无设备
        _terrainModel.show = false;
        dishang.forEach(function (item) {
          if (_roadModel.contains(_tilesets[item])) {
            _roadModel.remove(_tilesets[item]);
            //_tilesets[item].show = false;
          }
        });
        //dixia.forEach(function (item) {
        var item = "dixia/JG";
        var name = item.replace("/", "");
        if (!_roadModel.contains(_tilesets[name])) {
          _tilesets[name] = _readModel(item);
          _roadModel.add(_tilesets[name]);
        } // else {
        //    _tilesets[name].show = true;
        //}
        //})
      }
      if (type == 2) {
        //不靠近车站
        dishang.forEach(function (item) {
          if (_roadModel.contains(_tilesets[item])) {
            _roadModel.remove(_tilesets[item]);
            //_tilesets[item].show = false;
          }
        });
        dixia.forEach(function (item) {
          var name = item.replace("/", "");
          if (_roadModel.contains(_tilesets[name])) {
            _roadModel.remove(_tilesets[name]);
            //_tilesets[name].show = false;
          }
        });
      }
    },
    /**
     * 显示地形
     * */
    ShowTerrain: function () {
      if (_terrainModel.show) {
        _terrainModel.show = false;
        this.ShowModel(1);
      } else {
        _terrainModel.show = true;
        this.ShowModel(0);
      }
    },
  };
  return _cesiumMap;
})();
export default CesiumMap;
