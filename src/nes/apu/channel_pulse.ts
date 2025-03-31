import { numberToHex } from "../../emulator/utils";
import { Nes } from "../nes";
import { StandardChannel } from "./standard_channel";

export class ChannelPulse extends StandardChannel {

    private oscillator: OscillatorNode | null = null;

    constructor(protected nes: Nes, private channelNumber: number) {
        super(nes);
    }

    async initialize(destinationNode?: AudioNode) {
        await super.initialize(destinationNode);

        this.oscillator = this.audioContext.createOscillator();
        this.oscillator.type = 'square';
        this.oscillator.connect(this.gainNode!);
        this.oscillator.start();
    }


    private updateFrequency(): void {
        // First check muting conditions independently of sweep
        if (this.isHalted()) {
            this.setGain(0);
            return;
        }

        // Calculate current target period for muting check
        const changeAmount = this.timerLength >> this.sweepShift;
        let targetPeriod;
        if (this.sweepNegate) {
            if (this.channelNumber === 1) {
                targetPeriod = this.timerLength - changeAmount - 1;
            } else {
                targetPeriod = this.timerLength - changeAmount;
            }
        } else {
            targetPeriod = this.timerLength + changeAmount;
        }

        // Mute if target period would overflow
        if (this.sweepEnabled && this.sweepShift > 0 && targetPeriod > 0x7FF) {
            this.setGain(0);
            return;
        }

        // Calculate frequency only if not muted
        const frequency = 1789773 / (16 * (this.timerLength + 1));

        if (this.oscillator && this.lastFrequency !== frequency && this.gainNode) {
            this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            this.lastFrequency = frequency;
        }

        // Get volume based on constant volume flag
        const volume = this.constantVolume ? this.volume : this.envelopeDecayLevel;
        this.setGain(volume / 15);
    }

    reset(): void {
    }

    onWrite(address: number, value: number): void {
        address &= ~0x4; // map 04 to 00

        if (address === 0x4000) {
            // Main control register
            const volume = value & 0x0F;
            const constantVolume = (value & 0x10) !== 0;
            const lengthCounterHalt = (value & 0x20) !== 0;

            this.constantVolume = constantVolume;


            this.volume = volume;
            this.lengthCounterHalt = lengthCounterHalt;

            // Envelope control
            this.envelopeLoop = lengthCounterHalt;
            this.envelopeStart = !constantVolume;

            this.updateFrequency();
        }
        else if (address === 0x4001) {
            // Sweep register
            this.sweepEnabled = (value & 0x80) !== 0;
            this.sweepPeriod = (value >> 4) & 0x07;
            this.sweepNegate = (value & 0x08) !== 0;
            this.sweepShift = value & 0x07;
            this.sweepReload = true;
        }
        else if (address === 0x4002) {
            // Pulse low register
            this.timerLow = value;
        }
        else if (address === 0x4003) {
            // Pulse high register
            const lengthIndex = (value >> 3);
            this.lengthCounter = ChannelPulse.LENGTH_TABLE[lengthIndex];
            this.timer = (value & 0x7) << 8 | this.timerLow;
            this.timerLength = this.timer;
            this.sequenceCounter = 0;
            this.envelopeStart = true;

            this.updateFrequency();
            //console.log(`this.lengthCounter: ${this.lengthCounter} value: ${value} this.timer: ${this.timer}`);
        }
    }

    quarter_clock(): void {
        super.quarter_clock();

        this.updateFrequency();
    }

    half_clock(): void {
        super.half_clock();

        if (!this.isHalted()) {
            this.updateSweep();
        }
    }


    private updateSweep(): void {
        // Handle divider counter first
        if (this.sweepReload || this.sweepDivider === 0) {
            this.sweepDivider = this.sweepPeriod;
            this.sweepReload = false;
        } else {
            this.sweepDivider--;
        }

        // Calculate target period regardless of whether we'll update the period
        // (since muting check needs this calculation)
        const changeAmount = this.timerLength >> this.sweepShift;

        let targetPeriod;
        if (this.sweepNegate) {
            if (this.channelNumber === 1) {
                // Pulse 1: ones' complement (−c − 1)
                targetPeriod = this.timerLength - changeAmount - 1;
            } else {
                // Pulse 2: two's complement (−c)
                targetPeriod = this.timerLength - changeAmount;
            }
        } else {
            targetPeriod = this.timerLength + changeAmount;
        }

        // Check muting conditions:
        // 1. Current period < 8
        // 2. Target period > 0x7FF
        const isMuted = this.timerLength < 8 || targetPeriod > 0x7FF;

        // Only update period if:
        // 1. Divider counter is zero
        // 2. Sweep is enabled
        // 3. Shift count is nonzero
        // 4. Not muted
        if (this.sweepDivider === 0 &&
            this.sweepEnabled &&
            this.sweepShift !== 0 &&
            !isMuted) {

            this.timerLength = targetPeriod;
            this.updateFrequency();
        }
    }
}