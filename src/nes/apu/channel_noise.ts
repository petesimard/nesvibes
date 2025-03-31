import { Nes } from "../nes";
import { StandardChannel } from "./standard_channel";

export class ChannelNoise extends StandardChannel {
    // 15-bit shift register for noise generator
    private shiftRegister: number = 1; // On power-up, loaded with value 1
    private modeFlag: boolean = false;
    private periodTable: number[] = [
        4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068
    ]; // NTSC timer periods

    // Web Audio specific node for generating noise
    private noiseSource: AudioBufferSourceNode | null = null;

    async initialize() {
        await super.initialize(); // Initializes audioContext and gainNode

        if (this.audioContext && this.gainNode) {
            // Create a buffer for white noise (1 second long)
            const bufferSize = this.audioContext.sampleRate;
            const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const output = noiseBuffer.getChannelData(0);

            // Fill the buffer with random values between -1 and 1
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }

            // Create an AudioBufferSourceNode
            this.noiseSource = this.audioContext.createBufferSource();
            this.noiseSource.buffer = noiseBuffer;
            this.noiseSource.loop = true; // Loop the noise buffer

            // Connect the noise source to the gain node (which is already connected to destination)
            this.noiseSource.connect(this.gainNode);

            // Start the noise source
            this.noiseSource.start();
        }
    }

    onWrite(address: number, value: number): void {
        if (address === 0x400C) {
            const volume = value & 0x0F;
            const constantVolume = (value & 0x10) !== 0;
            const lengthCounterHalt = (value & 0x20) !== 0;

            this.constantVolume = constantVolume;
            this.volume = volume;
            this.lengthCounterHalt = lengthCounterHalt;

            // Envelope control
            this.envelopeLoop = lengthCounterHalt;
            this.envelopeStart = true; // Restart envelope when register is written
        }
        else if (address === 0x400E) {
            this.modeFlag = (value & 0x80) !== 0; // Mode flag (bit 7)
            const periodIndex = value & 0x0F; // Period index (bits 0-3)

            // Set timer period from the table
            this.timerLength = this.periodTable[periodIndex];
            // Timer is reset below when clocked
        }
        else if (address === 0x400F) {
            if (this.isEnabled) { // Only load length counter if channel is enabled
                const lengthIndex = (value >> 3);
                this.lengthCounter = StandardChannel.LENGTH_TABLE[lengthIndex];
            }
            // Envelope restart
            this.envelopeStart = true;
        }
    }

    clock(): void {
        // Clock the timer
        this.timer--;
        if (this.timer <= 0) { // Use <= 0 as timer can be loaded with 0
            this.timer = this.timerLength;
            if (this.timerLength > 0) { // Avoid infinite loop if period is 0
                // Clock the shift register when timer expires
                this.clockShiftRegister();
            }
        }

        let outputVolume = 0;

        // Output is muted if length counter is 0 OR bit 0 of LFSR is 1
        if (this.lengthCounter > 0 && (this.shiftRegister & 1) === 0) {
            // Calculate volume based on envelope or constant volume setting
            const envelopeVolume = this.constantVolume ? this.volume : this.envelopeDecayLevel;
            outputVolume = envelopeVolume;
        }

        // Scale the volume (0-15) to a gain value (0-1)
        // Adjusted max gain slightly based on typical NES levels
        const gain = outputVolume / 15;

        if (this.isHalted()) {
            this.setGain(0);
        } else {
            this.setGain(gain);
        }
    }

    clockShiftRegister(): void {
        // Calculate feedback based on mode
        const bit0 = this.shiftRegister & 1;
        const feedbackBit = this.modeFlag ?
            (this.shiftRegister >> 6) & 1 : // bit 6 if mode flag is set
            (this.shiftRegister >> 1) & 1;  // bit 1 otherwise

        // Calculate feedback as XOR of the two bits
        const feedback = bit0 ^ feedbackBit;

        // Shift right by 1 bit
        this.shiftRegister >>= 1;

        // Set bit 14 to the feedback value
        this.shiftRegister |= (feedback << 14); // More concise way to set bit 14
    }

    quarter_clock(): void {
        super.quarter_clock();
    }



    reset(): void {
        this.shiftRegister = 1; // Reset to 1 on power-up/reset
        this.modeFlag = false;
        this.timer = 0;
        this.timerLength = 0;
        this.lengthCounter = 0;
        this.envelopeStart = false;
        this.envelopeDecayLevel = 0;
        this.envelopeDivider = 0;
        this.constantVolume = false;
        this.lengthCounterHalt = false;
        this.envelopeLoop = false;
        this.volume = 0;
        this.setGain(0);
    }

}