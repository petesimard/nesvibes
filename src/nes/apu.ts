import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { AudioManager } from "../audio/audio-manager";
import { Nes } from "./nes";

export class APU implements BusDevice {
    private nes: Nes;
    private audioManager: AudioManager;
    private sampleRate: number = 44100;
    private cyclesPerSample: number;
    private cyclesToNextSample: number;

    constructor(nes: Nes) {
        this.nes = nes;
        this.audioManager = new AudioManager();
        // NES CPU runs at ~1.789773 MHz
        this.cyclesPerSample = Math.floor(1789773 / this.sampleRate);
        this.cyclesToNextSample = this.cyclesPerSample;
    }

    async initialize() {
        await this.audioManager.initialize();
    }

    clock() {
        this.cyclesToNextSample--;
        if (this.cyclesToNextSample <= 0) {
            // For now, just output silence (will implement actual audio synthesis later)
            this.audioManager.pushSample(0);
            this.cyclesToNextSample = this.cyclesPerSample;
        }
    }

    onReset() {
        this.cyclesToNextSample = this.cyclesPerSample;
    }

    read(address: number): number {
        // APU status read
        if (address === 0x4015) {
            // TODO: Implement status reading
            return 0;
        }
        return 0;
    }

    write(address: number, value: number): void {
        // TODO: Implement APU register writes
        switch (address) {
            case 0x4000: // Pulse 1 control
            case 0x4001: // Pulse 1 sweep
            case 0x4002: // Pulse 1 timer low
            case 0x4003: // Pulse 1 timer high
            case 0x4004: // Pulse 2 control
            case 0x4005: // Pulse 2 sweep
            case 0x4006: // Pulse 2 timer low
            case 0x4007: // Pulse 2 timer high
            case 0x4008: // Triangle control
            case 0x4009: // Triangle unused
            case 0x400A: // Triangle timer low
            case 0x400B: // Triangle timer high
            case 0x400C: // Noise control
            case 0x400D: // Noise unused
            case 0x400E: // Noise period
            case 0x400F: // Noise length
            case 0x4010: // DMC control
            case 0x4011: // DMC DAC
            case 0x4012: // DMC address
            case 0x4013: // DMC length
            case 0x4015: // Status
            case 0x4017: // Frame counter
                break;
        }
    }

    dispose() {
        this.audioManager.dispose();
    }
}
