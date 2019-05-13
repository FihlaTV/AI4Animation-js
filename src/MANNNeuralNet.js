/* eslint-disable */
import Parameters from './Parameters';
import Eigen from './Eigen';
import * as THREE from 'three';
// import ComputeShaders from './shaders/ComputeShader'
import ComputeController from './ComputeController'
import CombinedComputeController from './CombinedComputeController'
import * as nj from 'numjs';

export default class NeuralNet {
  constructor() {
    this.XDim = 480;
    this.HDim = 512;
    this.YDim = 363;
    this.XDimBlend = 19;
    this.HDimBlend = 32;
    this.YDimBlend = 8;
    this.CW = [];
    this.ControlNeurons = [285, 286, 287, 345, 346, 347, 393, 394,
      395, 341, 342, 343, 84, 85, 86, 87, 88, 89, 90];

    this.computeW0 = new ComputeController(480, 512);
    // this.computeW1 = new ComputeController(512, 512);
    // this.computeW2 = new ComputeController(512, 363);
    this.combinedCompute = new CombinedComputeController(512, 512+363);

  }

  setInput(i, val) {
    this.X.set(i, 0, val);
  }

  getOutput(x) {
    return this.Y.get(x, 0);
  }

  async loadParameters() {
    const promises = [
      Parameters.Load('/Xmean.bin', this.XDim, 1),
      Parameters.Load('/Xstd.bin', this.XDim, 1, 'Xstd'),
      Parameters.Load('/Ymean.bin', this.YDim, 1, 'Ymean'),
      Parameters.Load('/Ystd.bin', this.YDim, 1, 'Ystd'),
      Parameters.Load('/wc0_w.bin', this.HDimBlend, this.XDimBlend, 'wc0_w'),
      Parameters.Load('/wc0_b.bin', this.HDimBlend, 1, 'wc0_b'),
      Parameters.Load('/wc1_w.bin', this.HDimBlend, this.HDimBlend, 'wc1_w'),
      Parameters.Load('/wc1_b.bin', this.HDimBlend, 1, 'wc1_b'),
      Parameters.Load('/wc2_w.bin', this.YDimBlend, this.HDimBlend, 'wc2_w'),
      Parameters.Load('/wc2_b.bin', this.YDimBlend, 1, 'wc2_b'),
    ];

    await Promise.all(promises).then((values) => {
      const [Xmean, Xstd, Ymean, Ystd, BW0, Bb0, BW1, Bb1, BW2, Bb2] = values;
      this.Xmean = Xmean;
      this.Xstd = Xstd;
      this.Ymean = Ymean;
      this.Ystd = Ystd;
      this.BW0 = BW0;
      this.Bb0 = Bb0;
      this.BW1 = BW1;
      this.Bb1 = Bb1;
      this.BW2 = BW2;
      this.Bb2 = Bb2;
    });

    const expertWeightPromises = [];
    for (let i = 0; i < this.YDimBlend; i += 1) {
      expertWeightPromises.push(Parameters.Load(`/cp0_a${i.toString()}.bin`, this.HDim, this.XDim));
      expertWeightPromises.push(Parameters.Load(`/cp0_b${i.toString()}.bin`, this.HDim, 1));
      expertWeightPromises.push(Parameters.Load(`/cp1_a${i.toString()}.bin`, this.HDim, this.HDim));
      expertWeightPromises.push(Parameters.Load(`/cp1_b${i.toString()}.bin`, this.HDim, 1));
      expertWeightPromises.push(Parameters.Load(`/cp2_a${i.toString()}.bin`, this.YDim, this.HDim));
      expertWeightPromises.push(Parameters.Load(`/cp2_b${i.toString()}.bin`, this.YDim, 1));
    }

    await Promise.all(expertWeightPromises).then((weights) => {
      var w0Array = [];
      var w1Array = [];
      var w2Array = [];

      weights.forEach((weight, index) => {
        this.CW.push(weight);
        if(index%6 == 0){
          w0Array.push(weight);
        } else if((index-2)%6 == 0){
          w1Array.push(weight);
        } else if((index-4)%6 == 0){
          w2Array.push(weight);
        }
      });

      this.combinedCompute.setWeightData(w1Array, w2Array);
      this.computeW0.setWeightData(w0Array)
      // this.computeW1.setWeightData(w1Array)
      // this.computeW2.setWeightData(w2Array)

    });

    this.X = Parameters.initMatrix(this.XDim, 1, 'X');
    this.Y = Parameters.initMatrix(this.YDim, 1, 'Y');
    this.BX = Parameters.initMatrix(this.XDimBlend, 1, 'BX');
    this.BY = Parameters.initMatrix(this.YDimBlend, 1, 'BY');
    this.W0 = Parameters.initMatrix(this.HDim, this.XDim, 'W0');
    this.W1 = Parameters.initMatrix(this.HDim, this.HDim, 'W1');
    this.W2 = Parameters.initMatrix(this.YDim, this.HDim, 'W2');

    this.computeW0.setTarget(this.W0)
    this.combinedCompute.setTarget(this.W1, this.W2);
    // this.computeW1.setTarget(this.W1)
    // this.computeW2.setTarget(this.W2)

    this.b0 = Parameters.initMatrix(this.HDim, 1, 'b0');
    this.b1 = Parameters.initMatrix(this.HDim, 1, 'b1');
    this.b2 = Parameters.initMatrix(this.YDim, 1, 'b2');
    this.temp = Parameters.initMatrix(this.HDimBlend, 1, 'b2');
    this.temp2 = Parameters.initMatrix(this.HDimBlend, 1, 'b2');
    this.temp3 = Parameters.initMatrix(this.YDimBlend, 1, 'b2');
    this.temp4 = Parameters.initMatrix(this.HDim, 1, 'b2');
    this.temp5 = Parameters.initMatrix(this.HDim, 1, 'b2');
    this.temp6 = Parameters.initMatrix(this.YDim, 1, 'b2');
  }

  predict() {

    this.Y = Eigen.Normalise(this.X, this.Xmean, this.Xstd, this.Y);
    // Process Gating Network
    for (let i = 0; i < this.ControlNeurons.length; i += 1) {
      this.BX.set(i, 0, this.Y.get(this.ControlNeurons[i], 0));
    }
    this.BY = Eigen.ELU(Eigen.LayerOptimized(this.BX, this.BW0, this.Bb0, this.temp));
    this.BY = Eigen.ELU(Eigen.LayerOptimized(this.BY, this.BW1, this.Bb1, this.temp2));
    this.BY = Eigen.SoftMax(Eigen.LayerOptimized(this.BY, this.BW2, this.Bb2, this.temp3));

    Eigen.setZero(this.b0);
    Eigen.setZero(this.b1);
    Eigen.setZero(this.b2);

    var byArray = []
    for ( var i = 0; i < 8; i++){
      byArray.push(this.BY.get(i, 0))
    }

    /*
      Generate Network Weights
    */
    this.computeW0.compute(byArray, this.W0);
    this.combinedCompute.compute(byArray);
    // this.computeW1.compute(byArray, this.W1);
    // this.computeW2.compute(byArray, this.W2);
    for (let i = 0; i < this.YDimBlend; i += 1) {
      const weight = this.BY.get(i, 0);
      Eigen.Blend(this.b0, this.CW[6 * i + 1], weight);
      Eigen.Blend(this.b1, this.CW[6 * i + 3], weight);
      Eigen.Blend(this.b2, this.CW[6 * i + 5], weight);
    }
    this.Y = Eigen.ELU(Eigen.LayerOptimized(this.Y, this.W0, this.b0, this.temp4));
    this.Y = Eigen.ELU(Eigen.LayerOptimized(this.Y, this.W1, this.b1, this.temp5));
    this.Y = Eigen.LayerOptimized(this.Y, this.W2, this.b2, this.temp6);
    this.Y = Eigen.Renormalise(this.Y, this.Ymean, this.Ystd, this.Y);
  }
}
