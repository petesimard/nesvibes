import { Cartridge } from "../nes/cartridge";

// NROM: 16/32KB PRG ROM, 8KB CHR ROM (or CHR RAM), optional 8KB PRG RAM at $6000-$7FFF
// (Family Basic; also used by test ROMs to report results).
export class Mapper00 extends Cartridge {
    initialize(): void {
    }

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
        if (address >= 0x8000 && address <= 0xFFFF) {
            return this.programRom[(address - 0x8000) % this.programRom.length];
        }
        else if (address >= 0x6000 && address <= 0x7FFF) {
            return this.programRam[address - 0x6000];
        }
        // $4020-$5FFF: nothing mapped (open bus)
        return 0;
    }

    write(address: number, value: number): void {
        if (address >= 0x6000 && address <= 0x7FFF) {
            this.programRam[address - 0x6000] = value;
        }
        // Writes to ROM ($8000+) and unmapped space are ignored
    }

}
