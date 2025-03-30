export class AudioManager {
    public audioContext: AudioContext | null = null;

    private audioWorklet: AudioWorkletNode | null = null;
    private isInitialized = false;
    private sampleBuffer: number[] = [];
    private readonly BUFFER_SIZE = 16;

    async initialize() {
        if (this.isInitialized) return;

        try {
            this.audioContext = new AudioContext({
                sampleRate: 32100,
                latencyHint: 'interactive'
            });

            // Ensure the context is resumed after user interaction
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            await this.audioContext.audioWorklet.addModule('/src/audio/nes-audio-processor.ts');

            this.audioWorklet = new AudioWorkletNode(this.audioContext, 'nes-audio-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });

            this.audioWorklet.connect(this.audioContext.destination);
            this.isInitialized = true;
            console.log("AudioManager initialized");
        } catch (error) {
            console.error('Failed to initialize audio:', error);
            throw error;
        }
    }

    pushSample(sample: number) {
        if (!this.isInitialized || !this.audioWorklet) return;

        this.sampleBuffer.push(sample);

        if (this.sampleBuffer.length >= this.BUFFER_SIZE) {
            this.audioWorklet.port.postMessage({
                type: 'samples',
                value: this.sampleBuffer
            });
            this.sampleBuffer = [];
        }
    }

    flushSamples() {
        if (this.sampleBuffer.length > 0 && this.audioWorklet) {
            this.audioWorklet.port.postMessage({
                type: 'samples',
                value: this.sampleBuffer
            });
            this.sampleBuffer = [];
        }
    }

    suspend() {
        this.audioContext?.suspend();
    }

    resume() {
        this.audioContext?.resume();
    }

    dispose() {
        this.flushSamples();
        if (this.audioWorklet) {
            this.audioWorklet.disconnect();
            this.audioWorklet = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.isInitialized = false;
    }
} 