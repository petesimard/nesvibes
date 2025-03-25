export class AudioManager {
    private audioContext: AudioContext | null = null;
    private audioWorklet: AudioWorkletNode | null = null;
    private isInitialized = false;

    async initialize() {
        if (this.isInitialized) return;

        try {
            this.audioContext = new AudioContext({
                sampleRate: 44100,
                latencyHint: 'interactive'
            });

            await this.audioContext.audioWorklet.addModule('/src/audio/nes-audio-processor.ts');

            this.audioWorklet = new AudioWorkletNode(this.audioContext, 'nes-audio-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });

            this.audioWorklet.connect(this.audioContext.destination);
            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to initialize audio:', error);
            throw error;
        }
    }

    pushSample(sample: number) {
        if (!this.isInitialized || !this.audioWorklet) return;

        this.audioWorklet.port.postMessage({
            type: 'sample',
            value: sample
        });
    }

    suspend() {
        this.audioContext?.suspend();
    }

    resume() {
        this.audioContext?.resume();
    }

    dispose() {
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