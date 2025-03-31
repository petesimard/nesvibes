import { Nes } from "../nes";

export abstract class APUChannel {
    protected gainNode: GainNode | null = null;
    protected lastGain: number = -1;
    protected audioContext!: AudioContext;
    protected lastFrequency: number = 0;


    constructor(protected nes: Nes) {

    }

    protected _isEnabled: boolean = false;

    public get isEnabled(): boolean {
        return this._isEnabled;
    }

    public set isEnabled(value: boolean) {
        if (!value) {
            this.onDisable();
        }
        this._isEnabled = value;
    }

    protected onDisable() {
        this.setGain(0);
    }

    protected setGain(gain: number) {
        if (!this.isEnabled)
            gain = 0;

        if (this.gainNode && this.lastGain !== gain) {
            this.gainNode.gain.setValueAtTime(gain, this.audioContext.currentTime);
            this.lastGain = gain;
        }
    }

    async initialize(destinationNode?: AudioNode) {
        this.audioContext = this.nes.getApu()!.getAudioContext();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(destinationNode || this.audioContext.destination);
    }


    abstract clock(): void;
    abstract quarter_clock(): void;
    abstract half_clock(): void;
    abstract reset(): void;
    abstract onWrite(address: number, value: number): void;
}