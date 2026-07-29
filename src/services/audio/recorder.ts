import type { RecorderConfig, RecorderState } from '../../types/audio';
import { logger } from '../logging';
import { peak } from '../../utils/mathUtils';

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private monitorSink: GainNode | null = null;
  /** Channels the opened device delivered, whatever was asked for. */
  private inputChannels = 1;
  /** The channel actually being kept — the requested one, clamped to what exists. */
  private activeChannel = 0;
  /** Audio graph is live (stream open). Independent of isRecording, which only tracks capture. */
  private isActive = false;
  private isRecording = false;
  private isPaused = false;
  private recordedChunks: Float32Array[] = [];
  private currentLevel = 0;
  private recordedDuration = 0;
  private startTime = 0;
  private autoTriggered = false;
  private silenceStart = 0;
  private config: RecorderConfig | null = null;

  async start(config: RecorderConfig): Promise<void> {
    logger.info('AudioRecorder', 'Starting recording', { maxDuration: config.maxDuration });

    this.config = config;
    this.recordedChunks = [];
    this.recordedDuration = 0;
    this.autoTriggered = false;
    this.silenceStart = Date.now();

    try {
      this.mediaStream = await this.openStream(config.deviceId, config.channelIndex);
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: config.sampleRate,
      });

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.inputChannels = this.source.channelCount;
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;

      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      // A ScriptProcessorNode only fires while it reaches the destination, but the capture
      // path must stay inaudible — monitoring it puts the take back out of the interface
      // and into the input again. Terminate into a muted gain node instead.
      this.monitorSink = this.audioContext.createGain();
      this.monitorSink.gain.value = 0;

      // Left to itself the 1-channel processor would down-mix, i.e. sum: an interface with
      // the mic on the left and a silent right input comes back 6 dB down, and any phase
      // difference between the two combs the take. Split and take the picked channel.
      this.activeChannel = Math.min(Math.max(0, config.channelIndex), this.inputChannels - 1);
      if (this.activeChannel !== config.channelIndex) {
        logger.warn('AudioRecorder', 'Picked channel is beyond what the device delivered', {
          requested: config.channelIndex,
          inputChannels: this.inputChannels,
          using: this.activeChannel,
        });
      }

      if (this.inputChannels > 1) {
        this.splitter = this.audioContext.createChannelSplitter(this.inputChannels);
        this.source.connect(this.splitter);
        this.splitter.connect(this.analyser, this.activeChannel);
      } else {
        this.source.connect(this.analyser);
      }

      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.monitorSink);
      this.monitorSink.connect(this.audioContext.destination);

      this.scriptProcessor.onaudioprocess = (event) => this.processAudio(event);

      this.isActive = true;
      this.isRecording = true;
      this.isPaused = false;
      this.startTime = Date.now();

      logger.info('AudioRecorder', 'Recording started', {
        inputChannels: this.inputChannels,
        channel: this.activeChannel,
      });
      this.logTrackSettings();
    } catch (error) {
      logger.error('AudioRecorder', 'Failed to start recording', { error: String(error) });
      throw error;
    }
  }

  /**
   * Open the input. channelCount is only an ideal, and only as wide as the picked channel
   * needs: asking for exact mono would collapse a stereo interface and put channel 2 out
   * of reach, and asking for more than is needed leaves the browser free to hand back a
   * width nobody wanted. The single channel is taken in the graph either way.
   *
   * The WebRTC processing chain is built for voice calls and is destructive here: AEC
   * subtracts a delayed estimate of the output from the input, which combs the take, and
   * AGC rides the level the measurement depends on. All three stay off.
   */
  private openStream(deviceId: string | undefined, channelIndex: number): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        // Only ask for width when a channel past the first is wanted. The constraint makes
        // the browser do a format conversion, and that conversion is what can route the
        // capture back through the voice-call processing chain that band-limits it.
        ...(channelIndex > 0 ? { channelCount: { ideal: channelIndex + 1 } } : {}),
        // Advisory, and no help once the device is already open at a lower rate — the point
        // is to steer the browser away from the narrowband communications endpoint.
        sampleRate: { ideal: 48000 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Newer, on by default for some inputs, and a band-limiter of its own. Not covered
        // by the three above. Stays an ideal: a bare boolean is a required constraint, and
        // a device that does not expose the capability would refuse the open outright.
        voiceIsolation: { ideal: false },
      } as MediaTrackConstraints,
    });
  }

  /**
   * What the device actually handed over, as opposed to what was asked for. A rate well
   * under the context's, or any of the processing flags coming back on, means the take is
   * band-limited before the graph ever sees it and no amount of resampling brings it back.
   */
  private logTrackSettings(): void {
    // Diagnostics only. It runs after the take is already live, so anything thrown here —
    // getCapabilities() is not implemented everywhere and rejects an ended track — would
    // otherwise abort a recording that is in fact running fine.
    try {
      const track = this.mediaStream?.getAudioTracks()[0];
      if (!track) return;

      const settings = track.getSettings();
      const capabilities = track.getCapabilities?.();
      const contextRate = this.audioContext?.sampleRate;

      logger.info('AudioRecorder', 'Track settings', { settings, capabilities, contextRate });

      if (settings.sampleRate && contextRate && settings.sampleRate < contextRate) {
        logger.warn('AudioRecorder', 'Device is capturing below the context rate', {
          deviceRate: settings.sampleRate,
          contextRate,
          bandLimitHz: settings.sampleRate / 2,
        });
      }
      if (settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl) {
        logger.warn('AudioRecorder', 'Voice processing is on despite being switched off', settings);
      }
    } catch (error) {
      logger.warn('AudioRecorder', 'Could not read track settings', { error: String(error) });
    }
  }

  async stop(): Promise<Float32Array> {
    // Capture may already have ended on its own (auto-stop, max duration) while the
    // graph is still live — only a torn-down graph means there is nothing to stop.
    if (!this.isActive) {
      throw new Error('Recording not started');
    }

    logger.info('AudioRecorder', 'Stopping recording', { chunks: this.recordedChunks.length });

    this.isActive = false;
    this.isRecording = false;

    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.monitorSink) {
      this.monitorSink.disconnect();
      this.monitorSink = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.splitter) {
      this.splitter.disconnect();
      this.splitter = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    // Concatenate all chunks
    const totalLength = this.recordedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioData = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of this.recordedChunks) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }

    logger.info('AudioRecorder', 'Recording stopped', { totalSamples: totalLength });

    return audioData;
  }

  pause(): void {
    this.isPaused = true;
    logger.info('AudioRecorder', 'Recording paused');
  }

  resume(): void {
    this.isPaused = false;
    logger.info('AudioRecorder', 'Recording resumed');
  }

  getRecordedDuration(): number {
    return Math.min(this.recordedDuration, this.config?.maxDuration || 20000);
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  getState(): RecorderState {
    return {
      isRecording: this.isRecording,
      isArmed: this.isRecording && this.config?.autoTrigger === true && !this.autoTriggered,
      isPaused: this.isPaused,
      recordedDuration: this.getRecordedDuration(),
      level: this.currentLevel,
      inputChannels: this.inputChannels,
      channelIndex: this.activeChannel,
    };
  }

  private processAudio(event: AudioProcessingEvent): void {
    if (!this.config) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(inputData.length);
    chunk.set(inputData);

    // Block peak, not block RMS. A block is 4096 samples — 93 ms — and the sounds this
    // trigger exists for (a clap, a balloon, a gate transient) are a few milliseconds of
    // energy inside that window, so their RMS lands 15-25 dB under the peak the operator
    // is watching. Measuring RMS against a peak-shaped threshold is why a clap that
    // clearly crossed the notch never armed the take.
    this.currentLevel = peak(chunk);
    const currentLevelDb = 20 * Math.log10(Math.max(this.currentLevel, 1e-10));

    if (!this.isRecording || this.isPaused) return;

    const autoTrigger = this.config.autoTrigger === true;

    // Hold off capture until the signal crosses the threshold, so the take
    // doesn't start with the operator's silence
    if (autoTrigger && !this.autoTriggered) {
      if (currentLevelDb <= this.config.autoThreshold) {
        this.silenceStart = Date.now();
        return;
      }
      this.autoTriggered = true;
      logger.info('AudioRecorder', 'Auto-trigger activated', { levelDb: currentLevelDb });
    }

    if (this.recordedDuration < this.config.maxDuration) {
      this.recordedChunks.push(chunk);
      this.recordedDuration += (chunk.length / this.config.sampleRate) * 1000;
    } else {
      logger.warn('AudioRecorder', 'Max recording duration reached');
      this.isRecording = false;
      return;
    }

    // Auto-stop once the sound has decayed, but only when auto-trigger is on —
    // a manual take runs until the user stops it
    if (autoTrigger) {
      if (currentLevelDb < this.config.autoThreshold - 10) {
        if (Date.now() - this.silenceStart > 1000) {
          logger.info('AudioRecorder', 'Auto-stop triggered (silence)');
          this.isRecording = false;
        }
      } else {
        this.silenceStart = Date.now();
      }
    }
  }
}
