import { Cartridge } from "./cartridge";
import { Cpu2A03 } from "./cpu_2A03";
import { RAM } from "./ram";
import { numberToHex } from "../emulator/utils";

export class Nes {
    private cpu: Cpu2A03;
    private cartridge: Cartridge;
    private ram: RAM;
    private logger: (message: string) => void;

    public cycles: number = 0;

    // This is a hack to allow the CPU to read the value of the accumulator via the bus
    public CPU_BUSADDRESS_REGISTER_A: number = 0xFFFFFF + 1;

    constructor(logger: (message: string) => void) {
        this.logger = logger;
        this.cpu = new Cpu2A03(this);
        this.cartridge = new Cartridge(this);
        this.ram = new RAM(this, 2048);
    }

    public getCpu(): Cpu2A03 {
        return this.cpu;
    }

    log(message: string) {
        this.logger(message);
    }

    onReset() {
        this.cpu.onReset();
        this.cycles = 6;
    }

    clock() {
        this.cycles++;
        this.cpu.clock();
    }

    loadROM(rom: Uint8Array) {
        this.cartridge.loadROM(rom);
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
        else {
            throw new Error(`Write to unknown address: ${numberToHex(address)}`);
        }

    }
}