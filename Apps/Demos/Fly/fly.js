/***** https://blog.csdn.net/weixin_42066016/article/details/91378672 ******/
function newSite(x, y, z, h, p, time, ids) {
	console.log(x);
	if (x != null && y != null && z != null && h != null && p != null && time != null && ids != null) {
		this.position_x = x;
		this.position_y = y;
		this.position_z = z;
		this.pitch = p;
		this.heading = h;
		this.time = time;
		this.ids = ids;
	} else {
		return false;
	}
}
function Fly_NZC(viewer) {
	this.viewer = viewer;
	this.scene = viewer.scene;
	this.entities = viewer.entities;
	//全部飞行站点数组
	this.allSites = [];
	var that = this;
	this.checkIds = function(ids) {
		for (var i = 0; i < that.allSites.length + 1; i++) {
			if (i == that.allSites.length) {
				return false;
				break;
			}
			if (that.allSites[i].ids == ids) {
				return i;
				break;
			}
		}
	};
	this.RouteCollection = {
		//线颜色
		//LineColor:Cesium.Color.WHITE,
		//站点和路线显隐是否开启
		point_show: true,
		line_show: true,
		//站点图片路径
		img_path: "./images/location4.png",
		//飞行路线颜色
		/* setLineColor:function(){
			 Cesium.Color.WHITE,
		 },*/
		AddRoute: function(Route) {
			this.deleteEntities();
			that.allSites = Route;
			this.controlEntities();

		},
		//设置点图片
		setPointImg: function(path) {

			this.img_path = path;
			this.controlEntities();

		},
		//mod=0为设置点的可见，1为设置线的可见,2为控制点和线的可见
		setVisible: function(mod, bool) {
			if (mod === 0) {
				this.point_show = bool;
			} if (mod === 1) {
				this.line_show = bool;
			} if (mod === 2) {
				this.point_show = bool;
				this.line_show = bool;
			}
			this.controlEntities();

		},
		//通过传入站点类添加站点
		AddSite: function(newSite) {
			//判断id是否重复
			var bool = that.checkIds(newSite.ids);
			if (bool) {
				return false;
			} else {
				var Site = {};
				Site.position_x = newSite.position_x;
				Site.position_y = newSite.position_y;
				Site.position_z = newSite.position_z;
				Site.heading = newSite.heading;
				Site.pitch = newSite.pitch;
				//Site.roll=camera.roll;
				Site.time = newSite.time;
				Site.ids = newSite.ids;
				that.allSites.push(Site);
				this.controlEntities();
				return true;
			}
		},
		//添加当前视角为站点需要传入id
		AddSiteByView: function(ids) {
			//判断id是否重复
			var bool = that.checkIds(ids);
			if (bool) {
				return false;
			} else {
				try {
					var position = that.scene.camera.position;
					//获取当前相机位置参数(飞行用)
					var Site = {};
					Site.position_x = position.x;
					Site.position_y = position.y;
					Site.position_z = position.z;
					Site.heading = that.scene.camera.heading;
					Site.pitch = that.scene.camera.pitch;
					Site.roll = that.scene.camera.roll;
					Site.time = 3;
					Site.ids = ids;
					//添加到站点数组
					that.allSites.push(Site);
					this.controlEntities();
					console.log(that.allSites);
					return true;
				} catch (e) {
					return false;
				}

			}
		},
		deleteEntities: function() {
			//50000+为线id
			for (var i = 0; i < that.allSites.length; i++) {
				that.entities.removeById(that.allSites[i].ids);
			}
			for (var i = 1; i < 500000; i++) {
				var ids = parseInt(50000 + i);
				var entities_del = that.entities.getById(ids);
				if (entities_del) {
					that.entities.remove(entities_del);
				} else {
					break;
				}

			}
		},
		controlEntities: function() {
			var position_1, position_2, x1, x2, y1, y2, z1, z2, point_1_cartographic, point_2_cartographic;
			//添加和删除站点,更改颜色或图片后，先清空entities,然后重新添加。
			this.deleteEntities();
			//添加显示的站点
			var length = that.allSites.length;
			if (this.point_show == true) {
				for (var j = 0; j < length; j++) {
					that.entities.add({
						position: new Cesium.Cartesian3(that.allSites[j].position_x, that.allSites[j].position_y, that.allSites[j].position_z),
						// billboard: {
						// 	image: this.img_path,
						// 	width: 30,
						// 	height: 40,
						// },
						point: {
							pixelSize: 10,
							color: Cesium.Color.RED
						},
						//name : 10000+j,
						id: that.allSites[j].ids
					});
				}
			}
			//添加显示的线
			if (this.line_show == true) {
				for (var j = 1; j < length; j++) {
					//将笛卡尔坐标转为经纬度坐标，用于绘制线
					position_1 = new Cesium.Cartesian3(that.allSites[j].position_x, that.allSites[j].position_y, that.allSites[j].position_z)
					point_1_cartographic = Cesium.Cartographic.fromCartesian(position_1);
					x1 = Cesium.Math.toDegrees(point_1_cartographic.longitude);
					y1 = Cesium.Math.toDegrees(point_1_cartographic.latitude);
					z1 = point_1_cartographic.height;

					position_2 = new Cesium.Cartesian3(that.allSites[j - 1].position_x, that.allSites[j - 1].position_y, that.allSites[j - 1].position_z)
					point_2_cartographic = Cesium.Cartographic.fromCartesian(position_2);
					x2 = Cesium.Math.toDegrees(point_2_cartographic.longitude);
					y2 = Cesium.Math.toDegrees(point_2_cartographic.latitude);
					z2 = point_2_cartographic.height;
					that.entities.add({
						id: 50000 + j,
						// name : drowallStops.length,
						polyline: {
							positions: Cesium.Cartesian3.fromDegreesArrayHeights([x1, y1, z1, x2, y2, z2]),
							width: 5,
							material: Cesium.Color.WHITE
						}
					});

				}
			}
			//如果关闭显示了站点和飞行路线，添加的新站点和飞行路线将先不显示
			if (this.line_show == false) {
				for (var j = 1; j < length; j++) {
					//将笛卡尔坐标转为经纬度坐标，用于绘制线
					position_1 = new Cesium.Cartesian3(that.allSites[j].position_x, that.allSites[j].position_y, that.allSites[j].position_z)
					point_1_cartographic = Cesium.Cartographic.fromCartesian(position_1);
					x1 = Cesium.Math.toDegrees(point_1_cartographic.longitude);
					y1 = Cesium.Math.toDegrees(point_1_cartographic.latitude);
					z1 = point_1_cartographic.height;

					position_2 = new Cesium.Cartesian3(that.allSites[j - 1].position_x, that.allSites[j - 1].position_y, that.allSites[j - 1].position_z)
					point_2_cartographic = Cesium.Cartographic.fromCartesian(position_2);
					x2 = Cesium.Math.toDegrees(point_2_cartographic.longitude);
					y2 = Cesium.Math.toDegrees(point_2_cartographic.latitude);
					z2 = point_2_cartographic.height;
					that.entities.add({
						id: 50000 + j,
						show: false,
						// name : drowallStops.length,
						polyline: {
							positions: Cesium.Cartesian3.fromDegreesArrayHeights([x1, y1, z1, x2, y2, z2]),
							width: 5,
							material: Cesium.Color.WHITE
						}
					});

				}

			}
			if (this.point_show == false) {
				for (var j = 0; j < length; j++) {
					that.entities.add({
						position: new Cesium.Cartesian3(that.allSites[j].position_x, that.allSites[j].position_y, that.allSites[j].position_z),
						billboard: {
							image: this.img_path,
							width: 30,
							height: 40,
						},
						show: false,
						//name : 10000+j,
						id: that.allSites[j].ids
					});
				}
			}
		},
		removeAllSites: function() {
			this.deleteEntities();
			that.allSites = [];

		},
		removeSiteById: function(ids) {
			var id = that.checkIds(ids)
			if (id) {
				this.deleteEntities();
				that.allSites.splice(id, 1);
				this.controlEntities();

			} else {
				return false
			}

		}

	};
	this.l = 0;
	this.b = 0;
	//用于判断执行的时暂停还是停止
	this.play_bool = true;
	var x, y, z, p, h;
	this.setInterval_fly = null;
	this.setcamera = function() {
		//设置俯仰角
		var set = that.allSites[that.l].time * 20
		that.viewer.camera.setView({
			orientation: {
				heading: viewer.scene.camera.heading + h / set,
				pitch: viewer.scene.camera.pitch + p / set,
				roll: 0.0
			}
		});
		//move移动相机
		that.viewer.camera.move(new Cesium.Cartesian3(x, y, z), 1 / set);
		that.b--;
		if (that.b == 0) {
			that.l++;
			clearInterval(that.setInterval_fly);
			that.setInterval_fly = null;
			that.Interval();
			// that.b=0;
		}
	};
	this.Interval = function() {
		var l = that.l;
		if (that.play_bool) {
			that.b = that.allSites[l].time * 20
		} else {
			that.play_bool = true;
		}
		if (that.allSites[l + 1]) {
			x = that.allSites[l + 1].position_x - that.allSites[l].position_x;
			y = that.allSites[l + 1].position_y - that.allSites[l].position_y;
			z = that.allSites[l + 1].position_z - that.allSites[l].position_z;
			p = that.allSites[l + 1].pitch - that.allSites[l].pitch;
			h = that.allSites[l + 1].heading - that.allSites[l].heading;
			//that.b=that.allSites[l].time*20
			that.setInterval_fly = setInterval(that.setcamera, 50);
		} else {
			that.play_bool = true;
			that.l = 0;
		}

	};

	this.flyManager = {
		//用于储存暂停时的位置
		Site_pause: {},
		play: function() {
			//如果之前点的时停止重新开始飞行
			if (that.allSites.length > 1) {
				that.scene.screenSpaceCameraController.enableRotate = false;
				that.scene.screenSpaceCameraController.enableTranslate = false;
				that.scene.screenSpaceCameraController.enableZoom = false;
				that.scene.screenSpaceCameraController.enableTilt = false;
				that.scene.screenSpaceCameraController.enableLook = false;
				if (that.play_bool) {
					//设置初始点
					that.scene.camera.setView({
						destination: new Cesium.Cartesian3(that.allSites[that.l].position_x, that.allSites[that.l].position_y, that.allSites[that.l].position_z),
						orientation: {
							heading: that.allSites[that.l].heading,
							pitch: that.allSites[that.l].pitch,
							roll: that.allSites[that.l].roll
						}
					});
					that.Interval();
				} else {
					//如果之前是暂停，继续飞行
					that.scene.camera.setView({
						//将经度、纬度、高度的坐标转换为笛卡尔坐标
						destination: new Cesium.Cartesian3(this.Site_pause.position_x, this.Site_pause.position_y, this.Site_pause.position_z),
						orientation: {
							heading: this.Site_pause.heading,
							pitch: this.Site_pause.pitch,
							roll: this.Site_pause.roll
						}
					});
					that.Interval();
				}
			}

		},
		stop: function() {
			if (that.setInterval_fly != null) {
				clearInterval(that.setInterval_fly);
				that.setInterval_fly = null;
			}
			that.l = 0;
			that.play_bool = true;
			that.scene.screenSpaceCameraController.enableRotate = true;
			that.scene.screenSpaceCameraController.enableTranslate = true;
			that.scene.screenSpaceCameraController.enableZoom = true;
			that.scene.screenSpaceCameraController.enableTilt = true;
			that.scene.screenSpaceCameraController.enableLook = true;
		},
		pause: function() {

			if (that.setInterval_fly != null) {
				clearInterval(that.setInterval_fly);
				that.setInterval_fly = null;
				that.play_bool = false;
			}
			//获取暂停时的camera数据
			var position = that.scene.camera.position;
			this.Site_pause.position_x = position.x;
			this.Site_pause.position_y = position.y;
			this.Site_pause.position_z = position.z;
			this.Site_pause.heading = that.scene.camera.heading;
			this.Site_pause.pitch = that.scene.camera.pitch;
			this.Site_pause.roll = that.scene.camera.roll;


			that.scene.screenSpaceCameraController.enableRotate = true;
			that.scene.screenSpaceCameraController.enableTranslate = true;
			that.scene.screenSpaceCameraController.enableZoom = true;
			that.scene.screenSpaceCameraController.enableTilt = true;
			that.scene.screenSpaceCameraController.enableLook = true;

		},
		SetStartSite: function(ids) {
			var bool = that.checkIds(ids);
			if (bool) {
				that.l = bool;
				return true;
			} else {
				return false;
			}

		}

	};
}
