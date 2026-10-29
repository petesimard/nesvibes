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
    public onUnPausedListeners: (() => void)[] = [];
    public breakOnRti: boolean = false;
    public frameReady: boolean = false;
    public outputBuffer: number[] = [];

    // This is a hack to allow the CPU to read the value of the accumulator via the bus
    public CPU_BUSADDRESS_REGISTER_A: number = 0xFFFFFF + 1;
    _isPaused: any;
    breakOnNmi: boolean = false;
    public overscan: boolean = false;

    // Last value seen on the CPU data bus (returned for unmapped / write-only reads)
    public openBus: number = 0;
    private controllerStrobe: boolean = false;
    private controllerShift: number[] = [0, 0];

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

            if (i == 0) {
                // The CPU samples its NMI input early in the cycle (before the next two PPU dots)
                this.cpu.sampleNmi();
            }
            else if (i == 2) {
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
        else {
            this.onUnPausedListeners.forEach(listener => listener());
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
        const value = this.readBus(address);
        this.openBus = value;
        return value;
    }

    private readBus(address: number): number {
        if (address < 0x2000) {
            return this.ram.read(address & 0x07FF);
        }
        else if (address < 0x4000) {
            return this.ppu.read(address);
        }
        else if (address == 0x4015) {
            if (APU_ENABLED) {
                return this.apu!.read(address) | (this.openBus & 0x20);
            }
            return this.openBus;
        }
        else if (address == 0x4016) {
            return this.readController(0);
        }
        else if (address == 0x4017) {
            return this.readController(1);
        }
        else if (address < 0x4020) {
            // Write-only APU/IO registers and the unused $4018-$401F test registers
            return this.openBus;
        }
        else if (address <= 0xFFFF) {
            return this.cartridge!.read(address);
        }
        else if (address == this.CPU_BUSADDRESS_REGISTER_A) {
            return this.cpu.register_A;
        }

        console.error(`Read from unknown address: ${numberToHex(address)}`);
        return this.openBus;
    }

    // Standard controller: 8-bit shift register reloaded while the strobe ($4016 bit 0) is high.
    // Reads return bit 0 of the register in D0 with open-bus upper bits; after 8 reads it returns 1.
    private reloadControllers() {
        this.latchControllerStates();
        let state = 0;
        for (let i = 0; i < 8; i++) {
            state |= (this.getControllerState(0) & 1) << i;
        }
        this.controllerShift[0] = state;
        this.controllerShift[1] = 0; // Controller 2: connected, no buttons pressed
    }

    private readController(controller: number): number {
        if (this.controllerStrobe) {
            this.reloadControllers();
        }

        const bit = this.controllerShift[controller] & 1;
        if (!this.controllerStrobe) {
            this.controllerShift[controller] = (this.controllerShift[controller] >> 1) | 0x80;
        }
        return 0x40 | bit;
    }

    write(address: number, value: number): void {
        this.openBus = value;

        if (address < 0x2000) {
            this.ram.write(address & 0x07FF, value);
        }
        else if (address < 0x4000) {
            this.ppu.write(address, value);
        }
        else if (address == 0x4014) {
            this.cpu.setOAMDMA(value);
        }
        else if (address == 0x4016) {
            const strobe = (value & 1) != 0;
            if (strobe || this.controllerStrobe) {
                // Reload while high; the state at the high->low transition is what gets shifted out
                this.reloadControllers();
            }
            this.controllerStrobe = strobe;
        }
        else if (address <= 0x4017) {
            // $4000-$4013, $4015, $4017
            if (APU_ENABLED) {
                this.apu!.write(address, value);
            }
        }
        else if (address < 0x4020) {
            // $4018-$401F: unused, ignore
        }
        else if (address <= 0xFFFF) {
            this.cartridge!.write(address, value);
        }
        else if (address == this.CPU_BUSADDRESS_REGISTER_A) {
            this.cpu.register_A = value;
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
