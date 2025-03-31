import { APUChannel } from "./apu_channel";

export abstract class StandardChannel extends APUChannel {
    protected volume: number = 0;
    protected constantVolume: boolean = false;
    protected lengthCounterHalt: boolean = false;
    protected timer: number = 0;
    protected timerLength: number = 0;
    protected timerLow: number = 0;
    protected lengthCounter: number = 0;
    protected sequenceCounter: number = 0;

    protected envelopeDivider: number = 0;
    protected envelopeDecayLevel: number = 0;
    protected envelopeLoop: boolean = false;
    protected envelopeStart: boolean = false;

    protected sweepEnabled: boolean = false;
    protected sweepDivider: number = 0;
    protected sweepNegate: boolean = false;
    protected sweepShift: number = 0;
    protected sweepReload: boolean = false;
    protected sweepPeriod: number = 0;

    protected static LENGTH_TABLE: number[] = [
        10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
        12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30
    ];

    clock(): void {
        this.timer--;
        if (this.timer < 0) {
            this.timer = this.timerLength;
            this.sequenceCounter--;
            if (this.sequenceCounter < 0) {
                this.sequenceCounter = 7;
            }
        }
    }


    async initialize() {
        super.initialize();

        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    }


    quarter_clock(): void {
        if (this.envelopeStart) {
            this.envelopeStart = false;
            this.envelopeDecayLevel = 15;
            this.envelopeDivider = this.volume;
        } else {
            if (this.envelopeDivider === 0) {
                this.envelopeDivider = this.volume;
                if (this.envelopeDecayLevel > 0) {
                    this.envelopeDecayLevel--;
                } else if (this.envelopeLoop) {
                    this.envelopeDecayLevel = 15;
                }
            } else {
                this.envelopeDivider--;
            }
        }
    }

    half_clock(): void {
        if (this.lengthCounter > 0 && !this.lengthCounterHalt) {
            this.lengthCounter--;
        }

        if (this.isHalted()) {
            this.setGain(0);
        }
    }

    isHalted(): boolean {
        // Current period < 8 or not enabled or length counter is zero
        return (this.timerLength < 8 || !this.isEnabled || this.lengthCounter <= 0);
    }

    protected setGain(value: number): void {
        if (this.gainNode && this.lastGain !== value) {
            // Define a very short duration for the ramp to avoid audible delay
            // but still smooth out the transition. ~5ms is often enough.
            const rampTime = 0.005;
            const currentTime = this.audioContext.currentTime;

            // Use linearRampToValueAtTime for a smooth transition
            this.gainNode.gain.linearRampToValueAtTime(value, currentTime + rampTime);
            console.log(`Setting gain to ${value} from ${this.constructor.name}`);
            this.lastGain = value;
        }
    }
}