import { APUChannel } from "./apu_channel";

export class ChannelPulse extends APUChannel {

    private volume: number = 0;
    private constantVolume: boolean = false;
    private lengthCounterHalt: boolean = false;
    private duty: number = 0;
    private timer: number = 0;
    private timerLength: number = 0;

    private timerLow: number = 0;
    private lengthCounter: number = 0;
    private sequenceCounter: number = 0;

    constructor() {
        super();
    }

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

    getOutput(): number {
        if (this.timerLength < 8 || !this.isEnabled || (this.lengthCounter <= 0 && !this.lengthCounterHalt))
            return 0;

        const dutySequence = this.getDutySequence();
        const currentValue = dutySequence[this.sequenceCounter];
        return currentValue * 15;
    }

    getDutySequence(): number[] {
        switch (this.duty) {
            case 0:
                return [0, 1, 0, 0, 0, 0, 0, 0];
            case 1:
                return [0, 1, 1, 0, 0, 0, 0, 0];
            case 2:
                return [0, 1, 1, 1, 1, 0, 0, 0];
            case 3:
                return [1, 0, 0, 1, 1, 1, 1, 1];
            default:
                throw new Error("Invalid duty value");
        }
    }

    reset(): void {
    }

    onWrite(address: number, value: number): void {
        if (address === 0x4000) {
            // Main control register
            const volume = value & 0x0F;
            const constantVolume = (value & 0x10) !== 0;
            const lengthCounterHalt = (value & 0x20) !== 0;
            const duty = (value & 0xC0) >> 6;

            this.volume = volume;
            this.constantVolume = constantVolume;
            this.lengthCounterHalt = lengthCounterHalt;
            this.duty = duty;
        }
        else if (address === 0x4002) {
            // Pulse low register
            this.timerLow = value;
        }
        else if (address === 0x4003) {
            // Pulse high register
            this.lengthCounter = value >> 3;
            this.timer = (value & 0x7) << 8 | this.timerLow;
            this.timerLength = this.timer;
            this.sequenceCounter = 0;

            console.log(`this.lengthCounter: ${this.lengthCounter} value: ${value}`);
        }
    }

    quarter_clock(): void {

    }

    half_clock(): void {
        if (this.lengthCounter > 0 && !this.lengthCounterHalt) {
            this.lengthCounter--;
        }
    }
}