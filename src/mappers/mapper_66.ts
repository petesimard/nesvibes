import { Cartridge } from "../nes/cartridge";

// GxROM (mapper 66): a write to $8000-$FFFF selects a 32KB PRG bank (bits 4-5)
// and an 8KB CHR bank (bits 0-1). Used by Super Mario Bros. + Duck Hunt.
export class Mapper66 extends Cartridge {
    prgBank: number = 0;
    chrBank: number = 0;

    initialize(): void {
        this.prgBank = 0;
        this.chrBank = 0;
    }

    ppu_read(address: number): number {
        if (address <= 0x1FFF) {
            if (this.header.chrRomSize > 0) {
                return this.characterRom[(this.chrBank * 0x2000 + address) % this.characterRom.length];
            }
            return this.characterRam[address];
        }
        return 0;
    }

    ppu_write(address: number, value: number): void {
        if (address <= 0x1FFF) {
            // CHR ROM is read-only; only CHR RAM carts can be written
            if (this.header.chrRomSize == 0) {
                this.characterRam[address] = value;
            }
        }
    }

    read(address: number): number {
        if (address >= 0x8000 && address <= 0xFFFF) {
            return this.programRom[(this.prgBank * 0x8000 + (address - 0x8000)) % this.programRom.length];
        }
        return 0;
    }

    write(address: number, value: number): void {
        if (address >= 0x8000 && address <= 0xFFFF) {
            this.prgBank = (value >> 4) & 0x3;
            this.chrBank = value & 0x3;
        }
    }
}
