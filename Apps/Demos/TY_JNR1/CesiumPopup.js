/* eslint-disable */
import * as Cesium from "../../../Build/CesiumUnminified/index.js";
var CesiumPopup = (function () {
  var _target = undefined;
  var _options = {
    id: "",
    viewer: undefined,
    offsetX: 0,
    offsetY: 0,
    closeBtn: true,
  };
  //构造函数
  function _cesiumPopup(options) {
    var _this = this;
    if (_this instanceof _cesiumPopup) {
      Object.assign(_options, options);
      var infoDiv =
        '<div id="cesium-popup-' +
        _options.id +
        '" style="display:none;">' +
        '<div class="cesium-popup" style="top:5px;left:0;">' +
        '<a class="cesium-popup-close-button" href="#"' +
        (_options.closeBtn ? "" : ' style="display:none;"') +
        ">×</a>" +
        '<div class="cesium-popup-content-wrapper">' +
        '<div class="cesium-popup-content" style="max-width: 300px;"></div>' +
        "</div>" +
        "</div>" +
        "</div>";
      $("#" + _options.viewer.container.id).append(infoDiv);
      _options.viewer.scene.postRender.addEventListener(function () {
        if (Cesium.defined(_target)) {
          _update();
        }
      });
      $("#cesium-popup-" + _options.id + " .cesium-popup-close-button").click(
        function () {
          $("#cesium-popup-" + _options.id).hide();
        }
      );
    } else {
      return new _cesiumPopup(options);
    }
  }
  var _update = function () {
    var windowsCoord = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      _options.viewer.scene,
      _target
    );
    if (Cesium.defined(windowsCoord)) {
      var dom = $("#cesium-popup-" + _options.id + " .cesium-popup")[0];
      var popw = $("#" + _options.viewer.container.id)[0].offsetLeft;
      var poph = dom.offsetHeight;
      dom.style.left = String(windowsCoord.x - 37 + popw) + "px";
      dom.style.top =
        String(windowsCoord.y - poph - 10 - _options.offsetY) + "px";
    }
  };
  _cesiumPopup.prototype = {
    constructor: _cesiumPopup,
    show: function (position, html) {
      _target = position;
      _update();
      $("#cesium-popup-" + _options.id + " .cesium-popup-content").html(html);
      $("#cesium-popup-" + _options.id).show();
    },
    hide: function () {
      $("#cesium-popup-" + _options.id).hide();
    },
  };
  return _cesiumPopup;
})();
export default CesiumPopup;
