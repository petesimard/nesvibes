/// <reference lib="webworker" />

declare var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new(): AudioWorkletProcessor;
};

declare interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}

declare function registerProcessor(
    name: string,
    processorCtor: (new () => AudioWorkletProcessor)
): void;

class NESAudioProcessor extends AudioWorkletProcessor {
    private sampleBuffer: Float32Array;
    private bufferSize: number;
    private writeIndex: number;
    private readIndex: number;

    constructor() {
        super();
        // Buffer for 1/4 second of audio at 44.1kHz
        this.bufferSize = 11025;
        this.sampleBuffer = new Float32Array(this.bufferSize);
        this.writeIndex = 0;
        this.readIndex = 0;

        this.port.onmessage = (event) => {
            if (event.data.type === 'sample') {
                this.pushSample(event.data.value);
            }

            if (event.data.type === 'samples') {
                // Process array of samples
                event.data.value.forEach((sample: number) => {
                    this.pushSample(sample);
                });
            }
        };
    }

    pushSample(sample: number) {
        this.sampleBuffer[this.writeIndex] = sample;
        this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        const channel = output[0];

        for (let i = 0; i < channel.length; i++) {
            if (this.readIndex !== this.writeIndex) {
                channel[i] = this.sampleBuffer[this.readIndex];
                this.readIndex = (this.readIndex + 1) % this.bufferSize;
            } else {
                channel[i] = 0;
            }
        }

        return true;
    }
}

registerProcessor('nes-audio-processor', NESAudioProcessor); 