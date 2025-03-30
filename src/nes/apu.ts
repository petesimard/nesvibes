import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { AudioManager } from "../audio/audio-manager";
import { Nes } from "./nes";
import { ChannelPulse } from "./apu/channel_pulse";
export class APU implements BusDevice {
    private nes: Nes;
    private audioManager: AudioManager;
    private sampleRate: number = 32100;
    private cyclesPerSample: number;
    private cyclesToNextSample: number;
    private apu_clock: number = 0;

    private channel_pulse1: ChannelPulse;
    private channel_pulse2: ChannelPulse;
    private register_status: number = 0;

    private sampleTotal: number = 0;
    private sampleCount: number = 0;

    //private channel_triangle: ChannelTriangle;
    //private channel_noise: ChannelNoise;
    //private channel_dmc: ChannelDMC;

    constructor(nes: Nes) {
        this.nes = nes;
        this.audioManager = new AudioManager();
        // NES CPU runs at ~1.789773 MHz
        this.cyclesPerSample = Math.floor(1789773 / this.sampleRate / 1);
        this.cyclesToNextSample = this.cyclesPerSample;

        this.channel_pulse1 = new ChannelPulse(nes, 0);
        this.channel_pulse2 = new ChannelPulse(nes, 1);

        window.addEventListener('beforeunload', () => {
            this.dispose();
        });
    }

    getAudioContext(): AudioContext {
        return this.audioManager.audioContext!;
    }

    async initialize() {
        await this.audioManager.initialize();
        await this.channel_pulse1.initialize();
        await this.channel_pulse2.initialize();
        console.log("APU initialized");
    }

    clock() {
        this.cyclesToNextSample--;
        if (this.cyclesToNextSample <= 0) {
            const output = this.sampleTotal / this.sampleCount;
            //this.audioManager.pushSample(output);
            this.sampleTotal = 0;
            this.sampleCount = 0;
            this.cyclesToNextSample = this.cyclesPerSample;
        }
        else {
            this.sampleTotal += this.getMixedOutput();
            this.sampleCount++;
        }


        if (this.apu_clock % 2 == 0) {
            // Every other clock cycle
            if (this.channel_pulse1.isEnabled) {
                this.channel_pulse1.clock();
            }
            if (this.channel_pulse2.isEnabled) {
                this.channel_pulse2.clock();
            }
        }

        if (this.sequencerMode4step()) {
            // 1/4 frame
            if (this.apu_clock % 3729 == 0) {
                if (this.channel_pulse1.isEnabled) {
                    this.channel_pulse1.quarter_clock();
                }
                if (this.channel_pulse2.isEnabled) {
                    this.channel_pulse2.quarter_clock();
                }
            }

            // 1/2 frame
            if (this.apu_clock % 7457 == 0) {
                if (this.channel_pulse1.isEnabled) {
                    this.channel_pulse1.half_clock();
                }
                if (this.channel_pulse2.isEnabled) {
                    this.channel_pulse2.half_clock();
                }
            }

            // IRQ
            if (this.apu_clock % 14915 == 0 && (this.register_status & 0x40) == 0) {
                //this.nes.getCpu().IRQ(); // TODO: Implement IRQ
            }

        }
        else {// 5 step
            // 1/4 frame
            if (this.apu_clock % 3729 == 0) {
                if (this.channel_pulse1.isEnabled) {
                    this.channel_pulse1.quarter_clock();
                }
                if (this.channel_pulse2.isEnabled) {
                    this.channel_pulse2.quarter_clock();
                }
            }

            // 1/2 frame
            if (this.apu_clock % 7457 == 0) {
                if (this.channel_pulse1.isEnabled) {
                    this.channel_pulse1.half_clock();
                }
                if (this.channel_pulse2.isEnabled) {
                    this.channel_pulse2.half_clock();
                }
            }
        }


        this.apu_clock++;
    }

    getMixedOutput(): number {
        const tnd_out = 0;
        const pulse_out = 0.00752 * (this.channel_pulse1.getOutput() + this.channel_pulse2.getOutput())
        const output = pulse_out + tnd_out
        return output;
    }

    onReset() {
        this.setStatusRegister(0);
    }

    sequencerMode4step(): boolean {
        return (this.register_status & 0x80) == 0;
    }

    read(address: number): number {
        // APU status read
        if (address === 0x4000) {
            return 0;
        }
        return 0;
    }

    write(address: number, value: number): void {

        if (address >= 0x4000 && address <= 0x4003) {
            this.channel_pulse1.onWrite(address, value);
        }
        else if (address >= 0x4004 && address <= 0x4007) {
            this.channel_pulse2.onWrite(address, value);
        } else if (address == 0x4015) {
            this.setStatusRegister(value);
        }

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
    setStatusRegister(value: number) {
        this.register_status = value;

        this.channel_pulse1.isEnabled = (value & 0x01) != 0;
        this.channel_pulse2.isEnabled = (value & 0x02) != 0;
    }

    dispose() {
        this.audioManager.dispose();
    }
}
