import { numberToHex } from "../emulator/utils";
import { Cartridge } from "../nes/cartridge";

export class Mapper02 extends Cartridge {
    currentBank: number = 0;

    ppu_read(address: number): number {
        if (address <= 0x1FFF) {
            if (this.header.chrRomSize > 0) {
                return this.characterRom[address];
            }
            else {
                return this.programRam[address];
            }
        }
        else {
            throw new Error("PPU read: Invalid address " + numberToHex(address));
        }
    }

    ppu_write(address: number, value: number): void {
        if (address <= 0x1FFF) {
            if (this.header.chrRomSize > 0) {
                this.characterRom[address] = value;
            }
            else {
                this.programRam[address] = value;
            }
        }
        else {
            throw new Error("PPU write: Invalid address " + numberToHex(address));
        }
    }

    read(address: number): number {
        if (address >= 0x8000 && address <= 0xBFFF) {
            return this.programRom[this.currentBank * 0x4000 + (address - 0x8000)];
        }
        else if (address >= 0xC000 && address <= 0xFFFF) {
            const bank = this.header.prgRomSize - 1;
            return this.programRom[bank * 0x4000 + (address - 0xC000)];
        }
        else {
            throw new Error("Read: Invalid address " + numberToHex(address));
        }
    }

    write(address: number, value: number): void {
        if (address >= 0x8000 && address <= 0xFFFF) {
            this.currentBank = value & 0x7;
        }
        else {
            throw new Error("Write: Invalid address " + numberToHex(address));
        }
    }

    initialize(): void {
        this.currentBank = 0;
    }
}
