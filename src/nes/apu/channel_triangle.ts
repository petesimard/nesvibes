import { Nes } from "../nes";
import { StandardChannel } from "./standard_channel";

export class ChannelTriangle extends StandardChannel {

    private linearCounter: number = 0;
    private linearCounterReloadValue: number = 0;
    private linearCounterReloadFlag: boolean = false;

    private oscillator: OscillatorNode | null = null;

    reset(): void {
    }

    async initialize(destinationNode?: AudioNode): Promise<void> {
        await super.initialize(destinationNode);

        this.oscillator = this.audioContext.createOscillator();
        this.oscillator.type = 'square';
        this.oscillator.connect(this.gainNode!);
        this.oscillator.start();
    }

    onWrite(address: number, value: number): void {
        if (address === 0x4008) {
            this.lengthCounterHalt = (value & 0x80) !== 0;
            this.linearCounterReloadValue = value & 0x7F;
        }
        else if (address === 0x400A) {
            this.timerLow = value;
        }
        else if (address === 0x400B) {
            const lengthIndex = (value >> 3);
            this.lengthCounter = StandardChannel.LENGTH_TABLE[lengthIndex];
            this.timer = (value & 0x7) << 8 | this.timerLow;
            this.timerLength = this.timer;
            this.linearCounterReloadFlag = true;
            this.updateFrequency();
        }
    }

    quarter_clock(): void {
        super.quarter_clock();

        if (this.linearCounterReloadFlag) {
            this.linearCounter = this.linearCounterReloadValue;
        }
        else {
            if (this.linearCounter > 0) {
                this.linearCounter--;
            }
        }

        if (!this.lengthCounterHalt) {
            this.linearCounterReloadFlag = false;
        }

        this.updateFrequency();
    }

    isHalted(): boolean {
        if (super.isHalted()) {
            return true;
        }

        return this.linearCounter <= 0;
    }

    private updateFrequency(): void {
        // First check muting conditions independently of sweep
        if (this.isHalted()) {
            this.setGain(0);
            return;
        }

        // Calculate frequency only if not muted
        const frequency = 1789773 / (32 * (this.timerLength + 1));

        if (this.oscillator && this.lastFrequency !== frequency && this.gainNode) {
            this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            this.lastFrequency = frequency;
        }

        this.setGain(1);
    }
}