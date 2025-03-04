import * as Cesium from "../../../Build/CesiumUnminified/index.js";
class CustomPrimitive {
  constructor(options) {
    this.commandType = options.commandType;
    this.geometry = options.geometry;
    this.primitiveType = options.primitiveType;
    this.uniformMap = options.uniformMap;
    this.rawRenderState = options.rawRenderState;
    this.framebuffer = options.framebuffer;
    this.autoClear = Cesium.defaultValue(options.autoClear, false);
    this.pass = Cesium.defaultValue(options.pass, Cesium.Pass.OPAQUE);
    this.vertexShaderSource = options.vertexShaderSource;
    this.fragmentShaderSource = options.fragmentShaderSource;
    this._modelMatrix = Cesium.defaultValue(
      options.modelMatrix,
      Cesium.Matrix4.IDENTITY,
    );

    this.outputTexture = options.outputTexture;
    this.preExecute = options.preExecute;
    this.postExecute = options.postExecute;
    this.persists = Cesium.defaultValue(options.persists, false);

    this.show = true;
    this.command = undefined;
    this.clearCommand = undefined;
    if (this.autoClear) {
      this.clearCommand = new Cesium.ClearCommand({
        color: new Cesium.Color(0.0, 0.0, 0.0, 0.0),
        depth: 1.0,
        framebuffer: this.framebuffer,
        pass: Cesium.Pass.OPAQUE,
      });
    }
  }

  get modelMatrix() {
    return this._modelMatrix;
  }

  set modelMatrix(value) {
    this._modelMatrix = value;
    if (Cesium.defined(this.command)) {
      this.command.modelMatrix = value;
      this._updateBoundingVolume(value);
    }
  }

  createCommand(context) {
    switch (this.commandType) {
      case "Draw": {
        const boundingSphere =
          this.geometry?.boundingSphere ||
          new Cesium.BoundingSphere(new Cesium.Cartesian3(), 1);

        const center = Cesium.Matrix4.multiplyByPoint(
          this.modelMatrix,
          boundingSphere.center,
          new Cesium.Cartesian3(),
        );
        const scale = Cesium.Matrix4.getScale(
          this.modelMatrix,
          new Cesium.Cartesian3(),
        );
        const radius =
          Math.max(scale.x, scale.y, scale.z) * boundingSphere.radius;

        const boundingVolume = new Cesium.BoundingSphere(center, radius);

        const vertexArray = Cesium.VertexArray.fromGeometry({
          context,
          geometry: this.geometry,
          attributeLocations: Cesium.GeometryPipeline.createAttributeLocations(
            this.geometry,
          ),
          bufferUsage: Cesium.BufferUsage.STATIC_DRAW,
        });

        const shaderProgram = Cesium.ShaderProgram.fromCache({
          context,
          attributeLocations: this.attributeLocations,
          vertexShaderSource: this.vertexShaderSource,
          fragmentShaderSource: this.fragmentShaderSource,
        });

        const renderState = Cesium.RenderState.fromCache(this.rawRenderState);
        return new Cesium.DrawCommand({
          owner: this,
          vertexArray,
          primitiveType: this.primitiveType,
          uniformMap: this.uniformMap,
          modelMatrix: this.modelMatrix,
          shaderProgram: shaderProgram,
          framebuffer: this.framebuffer,
          renderState: renderState,
          pass: this.pass,
          boundingVolume,
        });
      }
      case "Compute": {
        return new Cesium.ComputeCommand({
          owner: this,
          vertexShaderSource: this.vertexShaderSource,
          fragmentShaderSource: this.fragmentShaderSource,
          uniformMap: this.uniformMap,
          outputTexture: this.outputTexture,
          persists: this.persists,
          preExecute: this.preExecute,
          postExecute: this.postExecute,
        });
      }
    }
  }

  setGeometry(context, geometry) {
    this.geometry = geometry;
    const vertexArray = Cesium.VertexArray.fromGeometry({
      context: context,
      geometry: this.geometry,
      attributeLocations: this.attributeLocations,
      bufferUsage: Cesium.BufferUsage.STATIC_DRAW,
    });
    this.command.vertexArray = vertexArray;
  }

  update(frameState) {
    if (!this.show) {
      return;
    }

    if (!Cesium.defined(this.command)) {
      this.command = this.createCommand(frameState.context);
    }

    if (Cesium.defined(this.clearCommand)) {
      frameState.commandList.push(this.clearCommand);
    }
    frameState.commandList.push(this.command);
  }

  _updateBoundingVolume(modelMatrix) {
    const boundingSphere =
      this.geometry?.boundingSphere ||
      new Cesium.BoundingSphere(new Cesium.Cartesian3(), 1);

    const center = Cesium.Matrix4.multiplyByPoint(
      modelMatrix,
      boundingSphere.center,
      new Cesium.Cartesian3(),
    );
    const scale = Cesium.Matrix4.getScale(modelMatrix, new Cesium.Cartesian3());
    const radius = Math.max(scale.x, scale.y, scale.z) * boundingSphere.radius;

    const boundingVolume = new Cesium.BoundingSphere(center, radius);
    if (Cesium.defined(this.command.boundingVolume)) {
      this.command.boundingVolume.center = boundingVolume.center;
      this.command.boundingVolume.radius = boundingVolume.radius;
    }
  }

  isDestroyed() {
    return false;
  }

  destroy() {
    if (Cesium.defined(this.command)) {
      this.command.shaderProgram =
        this.command.shaderProgram && this.command.shaderProgram.destroy();
    }
    return Cesium.destroyObject(this);
  }
}

export default CustomPrimitive;
