import { logger } from '../logging';
import { peak } from '../../utils/mathUtils';

export interface PlaybackConfig {
  irCoefficients: Float32Array;
  audioData: Float32Array;
  sampleRate: number;
}

export function convolveAudio(config: PlaybackConfig): Float32Array {
  const { irCoefficients, audioData } = config;

  logger.info('convolution', 'Convolving audio with IR', {
    audioLength: audioData.length,
    irLength: irCoefficients.length,
  });

  if (irCoefficients.length > 1000) {
    return convolveFFT(audioData, irCoefficients);
  } else {
    return convolveTimeDomain(audioData, irCoefficients);
  }
}

function convolveTimeDomain(signal: Float32Array, ir: Float32Array): Float32Array {
  const outputLength = signal.length + ir.length - 1;
  const output = new Float32Array(outputLength);

  for (let i = 0; i < signal.length; i++) {
    for (let j = 0; j < ir.length; j++) {
      output[i + j] += signal[i] * ir[j];
    }
  }

  return normalizeOutput(output);
}

function convolveFFT(signal: Float32Array, ir: Float32Array): Float32Array {
  // Simple time-domain for now; FFT-based convolution is complex
  return convolveTimeDomain(signal, ir);
}

function normalizeOutput(output: Float32Array): Float32Array {
  const maxVal = peak(output);

  if (maxVal > 1) {
    const normalized = new Float32Array(output.length);
    for (let i = 0; i < output.length; i++) {
      normalized[i] = output[i] / maxVal;
    }
    logger.debug('convolution', 'Output normalized', { maxVal });
    return normalized;
  }

  return output;
}
