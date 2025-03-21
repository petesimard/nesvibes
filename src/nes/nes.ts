import { Cartridge } from "./cartridge";
import { Cpu2A03 } from "./cpu_2A03";
import { RAM } from "./ram";
import { PPU } from "./ppu";
import { numberToHex } from "../emulator/utils";
import { APU } from "./apu";
export class Nes {

    private cpu: Cpu2A03;
    private cartridge: Cartridge;
    private ram: RAM;
    private ppu: PPU;
    private apu: APU;

    private logger: (message: string) => void;
    private onRenderedPixel: (x: number, y: number, finalColor: number[]) => void;

    public cycles: number = 0;
    public onPausedListeners: (() => void)[] = [];
    public breakOnRti: boolean = false;

    // This is a hack to allow the CPU to read the value of the accumulator via the bus
    public CPU_BUSADDRESS_REGISTER_A: number = 0xFFFFFF + 1;
    _isPaused: any;
    breakOnNmi: boolean = false;

    constructor(logger: (message: string) => void, onRenderedPixel: (current_dot: number, current_scanline: number, finalColor: number[]) => void) {
        this.logger = logger;
        this.onRenderedPixel = onRenderedPixel;
        this.cpu = new Cpu2A03(this);
        this.cartridge = new Cartridge(this);
        this.ram = new RAM(this, 2048);
        this.ppu = new PPU(this);
        this.apu = new APU(this);
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

    public getApu(): APU {
        return this.apu;
    }

    public toggleBreakOnNmi(value: boolean) {
        this.breakOnNmi = value;
    }

    public toggleBreakOnRti(value: boolean) {
        this.breakOnRti = value;
    }

    getCartridge() {
        return this.cartridge;
    }

    getRam() {
        return this.ram;
    }

    log(message: string) {
        this.logger(message);
    }

    onReset() {
        this.cpu.onReset();
        this.ppu.onReset();
        this.apu.onReset();
        this.cycles = 6;
    }

    clock(step: boolean = false) {
        if (this._isPaused && !step) {
            return;
        }

        for (let i = 0; i < 3; i++) {

            this.ppu.clock();

            if (i == 2) {
                this.cpu.clock();
            }
            this.cycles++;
        }
    }

    togglePause() {
        this._isPaused = !this._isPaused;
        if (this._isPaused) {
            this.onPausedListeners.forEach(listener => listener());
        }
    }

    loadROM(rom: Uint8Array) {
        this.cartridge.loadROM(rom);
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
        else if (address >= 0x4020 && address <= 0xFFFF) {
            return this.cartridge.read(address);
        }
        else if (address == this.CPU_BUSADDRESS_REGISTER_A) {
            return this.cpu.register_A;
        }
        else if (address >= 0x2000 && address <= 0x3FFF) {
            return this.ppu.read(address);
        }
        else if (address >= 0x4000 && address <= 0x4017) {
            return this.apu.read(address);
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
        else if (address >= 0x4020 && address <= 0xFFFF) {
            this.cartridge.write(address, value);
        }
        else if (address == this.CPU_BUSADDRESS_REGISTER_A) {
            this.cpu.register_A = value;
        }
        else if (address >= 0x2000 && address <= 0x3FFF) {
            this.ppu.write(address, value);
        }
        else if (address >= 0x4000 && address <= 0x4017) {
            this.apu.write(address, value);
        }
        else {
            throw new Error(`Write to unknown address: ${numberToHex(address)}`);
        }
    }

    NMI() {
        this.cpu.NMI();
        console.log("NMI");

        if (this.breakOnNmi) {
            console.log("Break on NMI");
            this.togglePause();
        }
    }


    setRenderedPixel(x: number, y: number, finalColor: number[]) {
        this.onRenderedPixel(x, y, finalColor);
    }
}
