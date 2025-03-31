import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { AudioManager } from "../audio/audio-manager";
import { Nes } from "./nes";
import { ChannelPulse } from "./apu/channel_pulse";
import { ChannelTriangle } from "./apu/channel_triangle";
import { ChannelNoise } from "./apu/channel_noise";
export class APU implements BusDevice {
    private nes: Nes;
    private audioManager: AudioManager;
    private sampleRate: number = 32100;
    private cyclesPerSample: number;
    private cyclesToNextSample: number;
    private apu_clock: number = 0;

    private channel_pulse1: ChannelPulse;
    private channel_pulse2: ChannelPulse;
    private channel_triangle: ChannelTriangle;
    private channel_noise: ChannelNoise;
    private register_status: number = 0;

    // Mixing nodes
    private pulseGainNode: GainNode | null = null;
    private triangleGainNode: GainNode | null = null;
    private noiseGainNode: GainNode | null = null;
    private masterGainNode: GainNode | null = null;

    constructor(nes: Nes) {
        this.nes = nes;
        this.audioManager = new AudioManager();
        // NES CPU runs at ~1.789773 MHz
        this.cyclesPerSample = Math.floor(1789773 / this.sampleRate / 1);
        this.cyclesToNextSample = this.cyclesPerSample;

        this.channel_pulse1 = new ChannelPulse(nes, 0);
        this.channel_pulse2 = new ChannelPulse(nes, 1);
        this.channel_triangle = new ChannelTriangle(nes);
        this.channel_noise = new ChannelNoise(nes);

        window.addEventListener('beforeunload', () => {
            this.dispose();
        });

        this.nes.onPausedListeners.push(() => {
            this.masterGainNode!.gain.setValueAtTime(0, this.audioManager.audioContext!.currentTime);
        });

        this.nes.onUnPausedListeners.push(() => {
            this.masterGainNode!.gain.setValueAtTime(1, this.audioManager.audioContext!.currentTime);
        });
    }

    getAudioContext(): AudioContext {
        return this.audioManager.audioContext!;
    }

    async initialize() {
        await this.audioManager.initialize();
        const audioContext = this.audioManager.audioContext!;

        // Create mixing nodes with NES coefficients
        this.pulseGainNode = audioContext.createGain();
        this.triangleGainNode = audioContext.createGain();
        this.noiseGainNode = audioContext.createGain();
        this.masterGainNode = audioContext.createGain();

        // Set the mixing coefficients
        this.pulseGainNode.gain.value = 0.00752 * 2.2;  // For pulse channels
        this.triangleGainNode.gain.value = 0.00851 * 2.2;  // For triangle
        this.noiseGainNode.gain.value = 0.00494 * 2.2;  // For noise

        // Connect all mixing nodes to the master gain
        this.pulseGainNode.connect(this.masterGainNode);
        this.triangleGainNode.connect(this.masterGainNode);
        this.noiseGainNode.connect(this.masterGainNode);

        // Connect master gain to destination
        this.masterGainNode.connect(audioContext.destination);

        // Initialize channels
        await this.channel_pulse1.initialize(this.pulseGainNode);
        await this.channel_pulse2.initialize(this.pulseGainNode);
        await this.channel_triangle.initialize(this.triangleGainNode);
        await this.channel_noise.initialize(this.noiseGainNode);

        console.log("APU initialized");
    }

    clock() {
        // this.cyclesToNextSample--;
        // if (this.cyclesToNextSample <= 0) {
        //     const output = this.sampleTotal / this.sampleCount;
        //     //this.audioManager.pushSample(output);
        //     this.sampleTotal = 0;
        //     this.sampleCount = 0;
        //     this.cyclesToNextSample = this.cyclesPerSample;
        // }
        // else {
        //     this.sampleTotal += this.getMixedOutput();
        //     this.sampleCount++;
        // }

        if (this.nes.isPaused()) {
            this.masterGainNode!.gain.setValueAtTime(0, this.audioManager.audioContext!.currentTime);
        }

        if (this.apu_clock % 2 == 0) {
            // Every other clock cycle
            if (this.channel_pulse1.isEnabled) {
                this.channel_pulse1.clock();
            }
            if (this.channel_pulse2.isEnabled) {
                this.channel_pulse2.clock();
            }
            if (this.channel_triangle.isEnabled) {
                this.channel_triangle.clock();
            }
            if (this.channel_noise.isEnabled) {
                this.channel_noise.clock();
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
                if (this.channel_triangle.isEnabled) {
                    this.channel_triangle.quarter_clock();
                }
                if (this.channel_noise.isEnabled) {
                    this.channel_noise.quarter_clock();
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
                if (this.channel_triangle.isEnabled) {
                    this.channel_triangle.half_clock();
                }
                if (this.channel_noise.isEnabled) {
                    this.channel_noise.half_clock();
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
                if (this.channel_triangle.isEnabled) {
                    this.channel_triangle.quarter_clock();
                }
                if (this.channel_noise.isEnabled) {
                    this.channel_noise.quarter_clock();
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
                if (this.channel_triangle.isEnabled) {
                    this.channel_triangle.half_clock();
                }
                if (this.channel_noise.isEnabled) {
                    this.channel_noise.half_clock();
                }
            }
        }


        this.apu_clock++;
    }

    // getMixedOutput(): number {
    //     const tnd_out = 0;
    //     const pulse_out = 0.00752 * (this.channel_pulse1.getOutput() + this.channel_pulse2.getOutput())
    //     const output = pulse_out + tnd_out
    //     return output;
    // }

    onReset() {
        this.setStatusRegister(0);
    }

    sequencerMode4step(): boolean {
        return (this.register_status & 0x80) == 0;
    }

    read(address: number): number {
        // APU status read
        if (address === 0x4000) {
            let status = 0;
            if (!this.channel_pulse1.isLengthCounterZero()) {
                status |= 0x01;
            }
            if (!this.channel_pulse2.isLengthCounterZero()) {
                status |= 0x02;
            }
            if (!this.channel_triangle.isLengthCounterZero()) {
                status |= 0x04;
            }
            if (!this.channel_noise.isLengthCounterZero()) {
                status |= 0x08;
            }
            return status;
        }
        return 0;
    }

    write(address: number, value: number): void {

        if (address >= 0x4000 && address <= 0x4003) {
            this.channel_pulse1.onWrite(address, value);
        }
        else if (address >= 0x4004 && address <= 0x4007) {
            this.channel_pulse2.onWrite(address, value);
        }
        else if (address == 0x4008 || address == 0x400A || address == 0x400B) {
            this.channel_triangle.onWrite(address, value);
        }
        else if (address == 0x400C || address == 0x400E || address == 0x400F) {
            this.channel_noise.onWrite(address, value);
        }

        else if (address == 0x4015) {
            this.setStatusRegister(value);
        }

    }

    setStatusRegister(value: number) {
        this.register_status = value;

        this.channel_pulse1.isEnabled = (value & 0x01) != 0;
        this.channel_pulse2.isEnabled = (value & 0x02) != 0;
        this.channel_triangle.isEnabled = (value & 0x04) != 0;
        this.channel_noise.isEnabled = (value & 0x08) != 0;
    }

    dispose() {
        this.audioManager.dispose();
    }
}
