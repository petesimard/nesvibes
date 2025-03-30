import { numberToHex } from "../../emulator/utils";
import { Nes } from "../nes";
import { APUChannel } from "./apu_channel";

export class ChannelPulse extends APUChannel {

    private audioContext!: AudioContext;
    private volume: number = 0;
    private constantVolume: boolean = false;
    private lengthCounterHalt: boolean = false;
    private duty: number = 0;
    private timer: number = 0;
    private timerLength: number = 0;
    private oscillator: OscillatorNode | null = null;
    private gainNode: GainNode | null = null;

    private timerLow: number = 0;
    private lengthCounter: number = 0;
    private sequenceCounter: number = 0;

    private envelopeDivider: number = 0;
    private envelopeDecayLevel: number = 0;
    private envelopeLoop: boolean = false;
    private envelopeStart: boolean = false;

    private sweepEnabled: boolean = false;
    private sweepDivider: number = 0;
    private sweepNegate: boolean = false;
    private sweepShift: number = 0;
    private sweepReload: boolean = false;
    private sweepPeriod: number = 0;

    // Add a length table for the NES APU
    private static LENGTH_TABLE: number[] = [
        10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
        12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30
    ];
    lastFrequency: number = 0;
    lastGain: number = 0;
    constructor(protected nes: Nes, private channelNumber: number) {
        super(nes);
    }

    async initialize() {
        this.audioContext = this.nes.getApu()!.getAudioContext();
        this.oscillator = this.audioContext.createOscillator();
        this.oscillator.type = 'square';
        this.gainNode = this.audioContext.createGain();
        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
        this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.oscillator.start();
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

        this.updateSweep();
    }

    private updateFrequency(): void {
        // Muting conditions:
        // 1. Period < 8
        // 2. Period > 0x7FF
        // 3. Target period would overflow
        let shouldMute = this.timerLength < 8 || this.timerLength > 0x7FF;

        // Calculate target period for muting check
        if (this.sweepEnabled && this.sweepShift > 0) {
            const changeAmount = this.timerLength >> this.sweepShift;
            const targetPeriod = !this.sweepNegate ?
                this.timerLength + changeAmount :
                this.timerLength - changeAmount - (this.channelNumber === 1 ? 1 : 0);

            shouldMute = shouldMute || targetPeriod > 0x7FF;
        }

        if (shouldMute) {
            if (this.gainNode && this.lastGain !== 0) {
                this.lastGain = 0;
                this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
                return;
            }
        }

        // Calculate sweep target period
        let targetPeriod = this.timerLength;
        if (this.sweepEnabled && this.sweepShift > 0) {
            const changeAmount = this.timerLength >> this.sweepShift;
            targetPeriod = this.sweepNegate ?
                (this.channelNumber === 1 ?
                    this.timerLength - changeAmount - 1 :
                    this.timerLength - changeAmount) :
                this.timerLength + changeAmount;

            // Mute the channel if the target period is out of range
            if (targetPeriod > 0x7FF || this.timerLength < 8) {
                if (this.gainNode && this.lastGain !== 0) {
                    this.lastGain = 0;
                    this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
                    return;
                }
            }
        }

        // NES CPU clock rate is 1.789773 MHz
        // Timer value is decremented at this rate
        // Frequency = CPU_CLOCK_RATE / (16 * (timer + 1))
        const frequency = 1789773 / (16 * (this.timerLength + 1));

        if (this.oscillator && this.lastFrequency !== frequency && this.gainNode) {
            this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            this.lastFrequency = frequency;
        }

        // Update gain based on envelope volume
        const envelopeVolume = this.constantVolume ? this.volume : this.envelopeDecayLevel;
        if (this.gainNode && this.lastGain !== envelopeVolume) {
            this.lastGain = envelopeVolume;
            this.gainNode.gain.setValueAtTime(envelopeVolume / 15, this.audioContext.currentTime);
        }
    }

    getOutput(): number {
        return 0;

        if (!this.isEnabled || this.lengthCounter === 0) {
        }

        const envelopeVolume = this.constantVolume ? this.volume : this.envelopeDecayLevel;
        return envelopeVolume;
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
        address &= ~0x4; // map 04 to 00

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

            // Envelope control
            this.envelopeLoop = lengthCounterHalt;
            this.envelopeStart = true;

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

            this.updateFrequency();
            console.log(`this.lengthCounter: ${this.lengthCounter} value: ${value} this.timer: ${this.timer}`);
        }
    }

    quarter_clock(): void {
        if (this.envelopeStart) {
            this.envelopeStart = false;
            this.envelopeDecayLevel = 15;
            this.envelopeDivider = this.volume;
        } else {
            if (this.envelopeDivider > 0) {
                this.envelopeDivider--;
            } else {
                this.envelopeDivider = this.volume;
                if (this.envelopeDecayLevel > 0) {
                    this.envelopeDecayLevel--;
                } else if (this.envelopeLoop) {
                    this.envelopeDecayLevel = 15;
                }
            }
        }

        this.updateEnvelope();
    }

    updateEnvelope() {
        const envelopeVolume = this.constantVolume ? this.volume : this.envelopeDecayLevel;
        if (this.gainNode && this.lastGain !== envelopeVolume) {
            this.lastGain = envelopeVolume;
            this.gainNode.gain.setValueAtTime(envelopeVolume, this.audioContext.currentTime);
            //console.log(`channel ${this.channelNumber} gain: 0`);
        }
    }

    half_clock(): void {
        if (this.lengthCounter > 0 && !this.lengthCounterHalt) {
            this.lengthCounter--;
            //console.log(`channel ${this.channelNumber} lengthCounter: ${this.lengthCounter} this.lengthCounterHalt: ${this.lengthCounterHalt}`);
        }


        if (this.timerLength < 8 || !this.isEnabled || (this.lengthCounter <= 0 && !this.lengthCounterHalt)) {
            if (this.gainNode && this.lastGain !== 0) {
                this.lastGain = 0;
                this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
                //console.log(`channel ${this.channelNumber} gain: 0`);
            }
        }
    }

    private updateSweep(): void {
        // Update divider
        if (this.sweepReload) {
            this.sweepDivider = this.sweepPeriod;
            this.sweepReload = false;
        } else if (this.sweepDivider > 0) {
            this.sweepDivider--;
        } else {
            this.sweepDivider = this.sweepPeriod;

            // Only update period if sweep is enabled and shift count is non-zero
            if (this.sweepEnabled && this.sweepShift > 0) {
                const changeAmount = this.timerLength >> this.sweepShift;

                // Different negation behavior for pulse 1 and 2
                let newTimer;
                if (this.sweepNegate) {
                    if (this.channelNumber === 1) {
                        // Pulse 1: ones' complement (−c − 1)
                        newTimer = this.timerLength - changeAmount - 1;
                    } else {
                        // Pulse 2: two's complement (−c)
                        newTimer = this.timerLength - changeAmount;
                    }
                } else {
                    newTimer = this.timerLength + changeAmount;
                }

                // Only update if the new timer is in valid range and change amount is non-zero
                if (newTimer <= 0x7FF && newTimer >= 8 && changeAmount > 0) {
                    this.timerLength = newTimer;
                    this.updateFrequency();
                }
            }
        }
    }
}