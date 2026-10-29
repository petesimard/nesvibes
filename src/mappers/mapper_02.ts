import { Cartridge } from "../nes/cartridge";

// UxROM: switchable 16KB PRG bank at $8000, last bank fixed at $C000, CHR RAM (or ROM).
export class Mapper02 extends Cartridge {
    currentBank: number = 0;

    ppu_read(address: number): number {
        address &= 0x1FFF;
        if (this.header.chrRomSize > 0) {
            return this.characterRom[address];
        }
        return this.characterRam[address];
    }

    ppu_write(address: number, value: number): void {
        // CHR ROM is read-only; only CHR RAM carts can be written
        if (this.header.chrRomSize == 0) {
            this.characterRam[address & 0x1FFF] = value;
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
        else if (address >= 0x6000 && address <= 0x7FFF) {
            return this.programRam[address - 0x6000];
        }
        return 0;
    }

    write(address: number, value: number): void {
        if (address >= 0x8000 && address <= 0xFFFF) {
            // UNROM uses 3 bits, UOROM 4, UNROM 512 5: wrap by the actual bank count
            this.currentBank = (value & 0xFF) % Math.max(1, this.header.prgRomSize);
        }
        else if (address >= 0x6000 && address <= 0x7FFF) {
            this.programRam[address - 0x6000] = value;
        }
    }

    initialize(): void {
        this.currentBank = 0;
    }
}
