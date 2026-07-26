import FFT from 'fft.js';
import type { ImpulseResponse, IRDerivationConfig } from '../../types/ir';
import type { FrequencySpectrum } from '../../types/spectrum';
import { logger } from '../logging';

export function deriveIR(
  spectrumA: FrequencySpectrum,
  spectrumB: FrequencySpectrum,
  config: IRDerivationConfig,
): ImpulseResponse {
  logger.info('irDerivation', 'Deriving IR', {
    method: config.method,
    phase: config.phase,
    maxLength: config.maxLength,
  });

  const { magnitudesLinear: magA, phase: phaseB } = spectrumA;
  const { magnitudesLinear: magB } = spectrumB;

  // Ensure same length
  const binCount = Math.min(magA.length, magB.length);

  // Compute IR magnitude in frequency domain
  const irMagDomain = new Float32Array(binCount);

  if (config.method === 'difference') {
    for (let i = 0; i < binCount; i++) {
      irMagDomain[i] = magA[i] - magB[i];
    }
  } else {
    // ratio: A/B in linear, convert to dB, then back if needed
    for (let i = 0; i < binCount; i++) {
      const magBClamped = Math.max(magB[i], 1e-10);
      irMagDomain[i] = magA[i] / magBClamped;
    }
  }

  // Use phase from B (preserve-B strategy is simpler)
  const irPhase = phaseB.slice(0, binCount);

  // Convert to time domain via IFFT
  const fftSize = binCount * 2;
  const fft = new FFT(fftSize);

  const freqDomain = new Array(fftSize * 2);
  for (let i = 0; i < binCount; i++) {
    const real = irMagDomain[i] * Math.cos(irPhase[i]);
    const imag = irMagDomain[i] * Math.sin(irPhase[i]);
    freqDomain[i * 2] = real;
    freqDomain[i * 2 + 1] = imag;
  }
  // Mirror for negative frequencies (IFFT)
  for (let i = binCount; i < fftSize; i++) {
    freqDomain[i * 2] = 0;
    freqDomain[i * 2 + 1] = 0;
  }

  const timeDomain = fft.inverse(freqDomain);

  // Extract real part and truncate
  const irFull = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    irFull[i] = timeDomain[i * 2];
  }

  // Truncate by energy threshold
  const irTruncated = truncateByEnergy(irFull, config.truncationDb);
  const irLimited = irTruncated.slice(0, config.maxLength);

  logger.info('irDerivation', 'IR derived', {
    lengthSamples: irLimited.length,
    peak: Math.max(...Array.from(irLimited).map(Math.abs)),
    energy: computeEnergy(irLimited),
  });

  return {
    coefficients: irLimited,
    length: irLimited.length,
    sampleRate: 44100, // Default, should be passed from audio context
  };
}

function truncateByEnergy(ir: Float32Array, thresholdDb: number): Float32Array {
  const energy = new Float32Array(ir.length);
  let totalEnergy = 0;

  for (let i = 0; i < ir.length; i++) {
    energy[i] = ir[i] * ir[i];
    totalEnergy += energy[i];
  }

  const thresholdLinear = Math.pow(10, thresholdDb / 10);
  let accum = 0;

  for (let i = 0; i < ir.length; i++) {
    accum += energy[i];
    if (accum >= totalEnergy * thresholdLinear) {
      return ir.slice(0, i + 1);
    }
  }

  return ir;
}

function computeEnergy(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) {
    sum += signal[i] * signal[i];
  }
  return sum;
}
