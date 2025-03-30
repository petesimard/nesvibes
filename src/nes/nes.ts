import { Cartridge } from "./cartridge";
import { Cpu2A03, InstructionResult } from "./cpu_2A03";
import { RAM } from "./ram";
import { PPU } from "./ppu";
import { numberToHex } from "../emulator/utils";
import { APU } from "./apu";
import { CartridgeLoader } from "./cartridge_loader";

const APU_ENABLED = true;

export class Nes {
    private cpu: Cpu2A03;
    private cartridge: Cartridge | undefined;
    private ram: RAM;
    private ppu: PPU;
    private apu: APU | undefined;
    private cartridgeLoader: CartridgeLoader;
    private logger: (message: string) => void;
    private instructionLogger: (instruction: InstructionResult) => void;
    getControllerState: (controllerNumber: number) => number;
    latchControllerStates: () => void;

    public cycles: number = 0;
    public onPausedListeners: (() => void)[] = [];
    public breakOnRti: boolean = false;
    public frameReady: boolean = false;
    public outputBuffer: number[] = [];

    // This is a hack to allow the CPU to read the value of the accumulator via the bus
    public CPU_BUSADDRESS_REGISTER_A: number = 0xFFFFFF + 1;
    _isPaused: any;
    breakOnNmi: boolean = false;
    public overscan: boolean = false;

    constructor(
        overscan: boolean,
        logger: (message: string) => void,
        instructionLogger: (instruction: InstructionResult) => void,
        latchControllerStates: () => void,
        getControllerState: (controllerNumber: number) => number,
    ) {
        this.overscan = overscan;
        this.logger = logger;
        this.instructionLogger = instructionLogger;
        this.getControllerState = getControllerState;
        this.latchControllerStates = latchControllerStates;
        this.cpu = new Cpu2A03(this);
        this.ram = new RAM(this, 2048);
        this.ram = new RAM(this, 2048);
        this.ppu = new PPU(this);

        if (APU_ENABLED) {
            this.apu = new APU(this);
        }
        this.cartridgeLoader = new CartridgeLoader(this);
    }

    async initialize() {
        if (APU_ENABLED) {
            await this.apu!.initialize();
        }
    }

    public isPaused(): boolean {
        return this._isPaused;
    }

    public getCpu(): Cpu2A03 {
        return this.cpu;
    }

    public getPpu(): PPU {
        return this.ppu;
    }

    public getApu(): APU | undefined {
        return this.apu;
    }

    public toggleBreakOnNmi(value: boolean) {
        this.breakOnNmi = value;
    }

    public toggleBreakOnRti(value: boolean) {
        this.breakOnRti = value;
    }

    getCartridge(): Cartridge {
        if (!this.cartridge) {
            throw new Error("Cartridge not loaded");
        }

        return this.cartridge;
    }

    getRam() {
        return this.ram;
    }

    log(message: string) {
        this.logger(message);
    }

    logInstruction(instruction: InstructionResult) {
        this.instructionLogger(instruction);
    }

    onReset() {
        this.cpu.onReset();
        this.ppu.onReset();
        if (APU_ENABLED) {
            this.apu!.onReset();
        }
        this.cycles = 0;
        this.frameReady = false;
    }

    clock(step: boolean = false) {
        if (this._isPaused && !step) {
            return;
        }

        for (let i = 0; i < 3; i++) {
            this.cycles++;

            this.ppu.clock();

            if (i == 2) {
                this.cpu.clock();
                if (APU_ENABLED) {
                    this.apu!.clock();
                }
            }
        }
    }

    togglePause() {
        this._isPaused = !this._isPaused;
        if (this._isPaused) {
            this.onPausedListeners.forEach(listener => listener());
        }
    }

    async loadROM(romBytes: Uint8Array) {
        const cartidge = await this.cartridgeLoader.loadCartridge(romBytes);
        if (!cartidge) {
            throw new Error("Failed to load ROM");
        }

        this.cartridge = cartidge;

        if (!this.cartridge) {
            throw new Error("Failed to load ROM 2");
        }

    }

    isNormalAddress(address: number): boolean {
        if (address >= 0x2000 && address <= 0x3FFF) {
            return false;
        }
        else if (address >= 0x4000 && address <= 0x4017) {
            return false;
        }
        else {
            return true;
        }
    }

    read16(address: number): number {
        const lowByte = this.read(address);
        const highByte = this.read(address + 1);
        return (highByte << 8) | lowByte;
    }

    read(address: number): number {
        if (address >= 0x0000 && address <= 0x07FF) {
            return this.ram.read(address);
        }
        else if (address >= 0x0800 && address <= 0x0FFF) {
            return this.ram.read(address - 0x0800);
        }
        else if (address >= 0x1000 && address <= 0x17FF) {
            return this.ram.read(address - 0x1000);
        }
        else if (address >= 0x1800 && address <= 0x1FFF) {
            return this.ram.read(address - 0x1800);
        }
        else if (address == 0x4016) {
            const controllerState = this.getControllerState(0);
            return controllerState;
        }
        else if (address == 0x4017) {
            return 0;// this.getControllerState(1);
        }
        else if (address >= 0x4020 && address <= 0xFFFF) {
            return this.cartridge!.read(address);
        }
        else if (address == this.CPU_BUSADDRESS_REGISTER_A) {
            return this.cpu.register_A;
        }
        else if (address >= 0x2000 && address <= 0x3FFF) {
            return this.ppu.read(address);
        }
        else if ((address >= 0x4000 && address <= 0x4013) || address >= 0x4015 || address <= 0x4017) {
            if (APU_ENABLED) {
                return this.apu!.read(address);
            }
        }

        console.error(`Read from unknown address: ${numberToHex(address)}`);
        return 0;
    }

    write(address: number, value: number): void {
        if (address >= 0x0000 && address <= 0x07FF) {
            this.ram.write(address, value);
        }
        else if (address >= 0x0800 && address <= 0x0FFF) {
            this.ram.write(address - 0x0800, value);
        }
        else if (address >= 0x1000 && address <= 0x17FF) {
            this.ram.write(address - 0x1000, value);
        }
        else if (address >= 0x1800 && address <= 0x1FFF) {
            this.ram.write(address - 0x1800, value);
        }
        else if (address == 0x4016) {
            if ((value & 1) == 0) {
                this.latchControllerStates();
            }
        }
        else if (address >= 0x4020 && address <= 0xFFFF) {
            this.cartridge!.write(address, value);
        }
        else if (address == this.CPU_BUSADDRESS_REGISTER_A) {
            this.cpu.register_A = value;
        }
        else if (address >= 0x2000 && address <= 0x3FFF) {
            this.ppu.write(address, value);
        }
        else if (address == 0x4014) {
            this.cpu.setOAMDMA(value);
        }
        else if ((address >= 0x4000 && address <= 0x4013) || address >= 0x4015 || address <= 0x4017) {
            if (APU_ENABLED) {
                this.apu!.write(address, value);
            }
        }
        else {
            throw new Error(`Write to unknown address: ${numberToHex(address)}`);
        }
    }

    NMI() {
        this.cpu.NMI();
        //console.log("NMI");

        if (this.breakOnNmi) {
            console.log("Break on NMI");
            this.togglePause();
        }
    }

    onFrameReady() {
        this.frameReady = true;
    }
}
