import {
  Cartesian2,
  Cartesian3,
  ImageBasedLighting,
  ImageBasedLightingPipelineStage,
  Matrix3,
  ShaderBuilder,
  _shadersImageBasedLightingStageFS,
} from "../../../index.js";
import ShaderBuilderTester from "../../../../../Specs/ShaderBuilderTester.js";

describe("Scene/Model/ImageBasedLightingPipelineStage", function () {
  const mockFrameState = {
    context: {
      floatingPointTexture: true,
      colorBufferFloat: true,
      supportsTextureLod: true,
    },
  };

  it("configures the render resources for default image-based lighting", function () {
    const imageBasedLighting = new ImageBasedLighting();
    const mockModel = {
      imageBasedLighting: imageBasedLighting,
      environmentMapManager: {},
      _iblReferenceFrameMatrix: Matrix3.clone(Matrix3.IDENTITY),
    };

    const renderResources = {
      shaderBuilder: new ShaderBuilder(),
      uniformMap: {},
      model: mockModel,
    };
    const shaderBuilder = renderResources.shaderBuilder;

    ImageBasedLightingPipelineStage.process(
      renderResources,
      mockModel,
      mockFrameState
    );

    ShaderBuilderTester.expectHasFragmentDefines(shaderBuilder, [
      "USE_IBL_LIGHTING",
    ]);
    ShaderBuilderTester.expectHasFragmentUniforms(shaderBuilder, [
      "uniform vec2 model_iblFactor;",
      "uniform mat3 model_iblReferenceFrameMatrix;",
    ]);

    ShaderBuilderTester.expectFragmentLinesEqual(shaderBuilder, [
      _shadersImageBasedLightingStageFS,
    ]);

    const uniformMap = renderResources.uniformMap;
    expect(
      Cartesian2.equals(
        uniformMap.model_iblFactor(),
        imageBasedLighting.imageBasedLightingFactor
      )
    ).toBe(true);

    expect(
      Matrix3.equals(
        uniformMap.model_iblReferenceFrameMatrix(),
        mockModel._iblReferenceFrameMatrix
      )
    ).toBe(true);
  });

  // These are dummy values, not meant to represent valid spherical harmonic coefficients.
  const testCoefficients = [
    new Cartesian3(1, 1, 1),
    new Cartesian3(2, 2, 2),
    new Cartesian3(3, 3, 3),
    new Cartesian3(4, 4, 4),
    new Cartesian3(5, 5, 5),
    new Cartesian3(6, 6, 6),
    new Cartesian3(7, 7, 7),
    new Cartesian3(8, 8, 8),
    new Cartesian3(9, 9, 9),
  ];

  it("configures the render resources for spherical harmonics", function () {
    const imageBasedLighting = new ImageBasedLighting({
      sphericalHarmonicCoefficients: testCoefficients,
    });

    const mockModel = {
      imageBasedLighting: imageBasedLighting,
      environmentMapManager: {},
      _iblReferenceFrameMatrix: Matrix3.clone(Matrix3.IDENTITY),
    };

    const renderResources = {
      shaderBuilder: new ShaderBuilder(),
      uniformMap: {},
      model: mockModel,
    };
    const shaderBuilder = renderResources.shaderBuilder;

    ImageBasedLightingPipelineStage.process(
      renderResources,
      mockModel,
      mockFrameState
    );

    ShaderBuilderTester.expectHasFragmentDefines(shaderBuilder, [
      "USE_IBL_LIGHTING",
      "DIFFUSE_IBL",
      "CUSTOM_SPHERICAL_HARMONICS",
    ]);
    ShaderBuilderTester.expectHasFragmentUniforms(shaderBuilder, [
      "uniform vec2 model_iblFactor;",
      "uniform mat3 model_iblReferenceFrameMatrix;",
      "uniform vec3 model_sphericalHarmonicCoefficients[9];",
    ]);

    const uniformMap = renderResources.uniformMap;
    expect(
      Cartesian2.equals(
        uniformMap.model_iblFactor(),
        imageBasedLighting.imageBasedLightingFactor
      )
    ).toBe(true);

    expect(
      Matrix3.equals(
        uniformMap.model_iblReferenceFrameMatrix(),
        mockModel._iblReferenceFrameMatrix
      )
    ).toBe(true);

    expect(uniformMap.model_sphericalHarmonicCoefficients()).toBe(
      testCoefficients
    );
  });

  it("configures the render resources for specular environment maps", function () {
    const mockCubeMap = {
      texture: {
        dimensions: {},
      },
      maximumMipmapLevel: 0,
      ready: true,
    };
    const imageBasedLighting = new ImageBasedLighting({
      specularEnvironmentMaps: "example.ktx2",
    });
    imageBasedLighting._specularEnvironmentCubeMap = mockCubeMap;

    const mockModel = {
      imageBasedLighting: imageBasedLighting,
      environmentMapManager: {},
      _iblReferenceFrameMatrix: Matrix3.clone(Matrix3.IDENTITY),
    };

    const renderResources = {
      shaderBuilder: new ShaderBuilder(),
      uniformMap: {},
      model: mockModel,
    };
    const shaderBuilder = renderResources.shaderBuilder;

    ImageBasedLightingPipelineStage.process(
      renderResources,
      mockModel,
      mockFrameState
    );

    ShaderBuilderTester.expectHasFragmentDefines(shaderBuilder, [
      "USE_IBL_LIGHTING",
      "SPECULAR_IBL",
      "CUSTOM_SPECULAR_IBL",
    ]);
    ShaderBuilderTester.expectHasFragmentUniforms(shaderBuilder, [
      "uniform vec2 model_iblFactor;",
      "uniform mat3 model_iblReferenceFrameMatrix;",
      "uniform samplerCube model_specularEnvironmentMaps;",
      "uniform float model_specularEnvironmentMapsMaximumLOD;",
    ]);

    const uniformMap = renderResources.uniformMap;
    expect(
      Cartesian2.equals(
        uniformMap.model_iblFactor(),
        imageBasedLighting.imageBasedLightingFactor
      )
    ).toBe(true);

    expect(
      Matrix3.equals(
        uniformMap.model_iblReferenceFrameMatrix(),
        mockModel._iblReferenceFrameMatrix
      )
    ).toBe(true);

    expect(uniformMap.model_specularEnvironmentMaps()).toBeDefined();
    expect(uniformMap.model_specularEnvironmentMapsMaximumLOD()).toBeDefined();
  });
});
