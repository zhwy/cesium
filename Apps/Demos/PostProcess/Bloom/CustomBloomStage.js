import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";

export default class CustomBloomStage {
  get brightness() {
    return this._bloomComposite.uniforms.brightness;
  }

  set brightness(value) {
    this._bloomComposite.uniforms.brightness = value;
  }

  get glowOnly() {
    return this._bloomComposite.uniforms.glowOnly;
  }

  set glowOnly(value) {
    this._bloomComposite.uniforms.glowOnly = value;
  }

  get delta() {
    return this._blur.uniforms.delta;
  }

  set delta(value) {
    this._blur.uniforms.delta = value;
  }

  get sigma() {
    return this._blur.uniforms.sigma;
  }

  set sigma(value) {
    this._blur.uniforms.sigma = value;
  }

  get stepSize() {
    return this._blur.uniforms.stepSize;
  }

  set stepSize(value) {
    this._blur.uniforms.stepSize = value;
  }

  get selected() {
    return this._selected;
  }

  set selected(value) {
    this._selected = value;
    this._select.selected = value;
  }

  constructor() {
    this._selected = [];

    this._generateComposite = this._createGenerateComposite();
    this._bloomComposite = this._createBloomComposite(
      this._generateComposite.name,
    );

    this.stage = new Cesium.PostProcessStageComposite({
      name: "custom_bloom",
      stages: [this._generateComposite, this._bloomComposite],
      inputPreviousStageTexture: false,
    });
  }

  _createBlur() {
    const name = "custom_bloom_blur";
    const delta = 1.0;
    const sigma = 2.0;
    const stepSize = 1.0;

    const blurShader = /* glsl */ `
      #define USE_STEP_SIZE
      #define SAMPLES 8

      uniform float delta;
      uniform float sigma;
      uniform float direction; // 0.0 for x direction, 1.0 for y direction

      uniform sampler2D colorTexture;

      #ifdef USE_STEP_SIZE
        uniform float stepSize;
      #else
        uniform vec2 step;
      #endif

      in vec2 v_textureCoordinates;

      //  Incremental Computation of the Gaussian:
      //  https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch40.html

      void main()
      {
        vec2 st = v_textureCoordinates;
        vec2 dir = vec2(1.0 - direction, direction);

        #ifdef USE_STEP_SIZE
          vec2 step = vec2(stepSize * (czm_pixelRatio / czm_viewport.zw));
        #else
          vec2 step = step;
        #endif

        vec3 g;
        g.x = 1.0 / (sqrt(czm_twoPi) * sigma);
        g.y = exp((-0.5 * delta * delta) / (sigma * sigma));
        g.z = g.y * g.y;

        vec4 result = texture(colorTexture, st) * g.x;
        for (int i = 1; i < SAMPLES; ++i)
        {
          g.xy *= g.yz;

          vec2 offset = float(i) * dir * step;
          result += texture(colorTexture, st - offset) * g.x;
          result += texture(colorTexture, st + offset) * g.x;
        }

        out_FragColor = result;
      }
    `;

    const blurX = new Cesium.PostProcessStage({
      name: `${name}_x_direction`,
      fragmentShader: blurShader,
      uniforms: {
        delta: delta,
        sigma: sigma,
        stepSize: stepSize,
        direction: 0.0,
      },
      sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
    });
    const blurY = new Cesium.PostProcessStage({
      name: `${name}_y_direction`,
      fragmentShader: blurShader,
      uniforms: {
        delta: delta,
        sigma: sigma,
        stepSize: stepSize,
        direction: 1.0,
      },
      sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
    });

    const uniforms = {};
    Object.defineProperties(uniforms, {
      delta: {
        get: function () {
          return blurX.uniforms.delta;
        },
        set: function (value) {
          const blurXUniforms = blurX.uniforms;
          const blurYUniforms = blurY.uniforms;
          blurXUniforms.delta = blurYUniforms.delta = value;
        },
      },
      sigma: {
        get: function () {
          return blurX.uniforms.sigma;
        },
        set: function (value) {
          const blurXUniforms = blurX.uniforms;
          const blurYUniforms = blurY.uniforms;
          blurXUniforms.sigma = blurYUniforms.sigma = value;
        },
      },
      stepSize: {
        get: function () {
          return blurX.uniforms.stepSize;
        },
        set: function (value) {
          const blurXUniforms = blurX.uniforms;
          const blurYUniforms = blurY.uniforms;
          blurXUniforms.stepSize = blurYUniforms.stepSize = value;
        },
      },
    });
    return new Cesium.PostProcessStageComposite({
      name: name,
      stages: [blurX, blurY],
      uniforms: uniforms,
    });
  }

  _createSelect() {
    return new Cesium.PostProcessStage({
      name: "cutom_bloom_select",
      fragmentShader: /* glsl */ `
        uniform sampler2D colorTexture;
        in vec2 v_textureCoordinates;
        void main() {
          vec4 color = texture(colorTexture, v_textureCoordinates);
          #ifdef CZM_SELECTED_FEATURE
            if (czm_selected()) {
              out_FragColor = color;
            } else {
              out_FragColor = vec4(0.);
            }
          #else
            out_FragColor = vec4(0.);
          #endif
        }
      `,
    });
  }

  _createGenerateComposite() {
    this._select = this._createSelect();
    this._blur = this._createBlur();

    return new Cesium.PostProcessStageComposite({
      name: "custom_bloom_generate_composite",
      stages: [this._select, this._blur],
    });
  }

  _createBloomComposite(bloomTextureName) {
    return new Cesium.PostProcessStage({
      name: "custom_bloom_bloom_composite",
      fragmentShader: /* glsl */ `
        uniform sampler2D colorTexture;
        uniform sampler2D bloomTexture;
        uniform bool glowOnly;
        uniform float brightness;

        in vec2 v_textureCoordinates;

        void main(void)
        {
          vec4 color = texture(colorTexture, v_textureCoordinates);
          vec3 baseColor = color.xyz;

          vec4 bloom = texture(bloomTexture, v_textureCoordinates);
          if (bloom.a > 0.) {
            baseColor = czm_RGBToHSB(color.xyz);
            baseColor.z += brightness * bloom.a;
            baseColor = czm_HSBToRGB(baseColor);
          }

          if (glowOnly) {
            out_FragColor = bloom;
          } else {
            out_FragColor = vec4(baseColor * (1.0 - bloom.a) + bloom.xyz, bloom.a);
          }
        }
      `,
      uniforms: {
        glowOnly: false,
        bloomTexture: bloomTextureName,
        brightness: 1.0,
      },
    });
  }
}
