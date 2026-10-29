import { Cartridge } from "../nes/cartridge";

// MMC2 (mapper 9), used by Punch-Out!!.
// PRG: $8000-$9FFF is a switchable 8KB bank; $A000-$FFFF is fixed to the last three 8KB banks.
// CHR: two 4KB windows ($0000 and $1000). Each window has two bank registers, picked by a
// latch that flips when the PPU fetches tile $FD or $FE:
//   reading $0FD8 / $0FE8           -> left latch = FD / FE
//   reading $1FD8-$1FDF / $1FE8-$1FEF -> right latch = FD / FE
// The latch changes after the triggering fetch, so that fetch still uses the old bank.
export class Mapper09 extends Cartridge {
    prgBank: number = 0;
    chrBanks: number[] = [0, 0, 0, 0]; // [left FD, left FE, right FD, right FE]
    leftLatchFE: boolean = true;
    rightLatchFE: boolean = true;
    horizontalMirroring: boolean = false;

    initialize(): void {
        this.prgBank = 0;
        this.chrBanks = [0, 0, 0, 0];
        this.leftLatchFE = true;
        this.rightLatchFE = true;
        this.horizontalMirroring = false;
    }

    ppu_read(address: number): number {
        address &= 0x1FFF;
        let value: number;

        if (this.header.chrRomSize == 0) {
            value = this.characterRam[address];
        }
        else {
            const bank = address < 0x1000
                ? this.chrBanks[this.leftLatchFE ? 1 : 0]
                : this.chrBanks[this.rightLatchFE ? 3 : 2];
            value = this.characterRom[(bank * 0x1000 + (address & 0x0FFF)) % this.characterRom.length];
        }

        // Update latches after the fetch
        if (address == 0x0FD8) {
            this.leftLatchFE = false;
        }
        else if (address == 0x0FE8) {
            this.leftLatchFE = true;
        }
        else if (address >= 0x1FD8 && address <= 0x1FDF) {
            this.rightLatchFE = false;
        }
        else if (address >= 0x1FE8 && address <= 0x1FEF) {
            this.rightLatchFE = true;
        }

        return value;
    }

    ppu_write(address: number, value: number): void {
        if (this.header.chrRomSize == 0) {
            this.characterRam[address & 0x1FFF] = value;
        }
    }

    read(address: number): number {
        if (address >= 0x8000 && address <= 0x9FFF) {
            return this.programRom[(this.prgBank * 0x2000 + (address - 0x8000)) % this.programRom.length];
        }
        else if (address >= 0xA000 && address <= 0xFFFF) {
            // Last three 8KB banks
            const offset = this.programRom.length - 0x6000 + (address - 0xA000);
            return this.programRom[offset];
        }
        else if (address >= 0x6000 && address <= 0x7FFF) {
            return this.programRam[address - 0x6000];
        }
        return 0;
    }

    write(address: number, value: number): void {
        if (address >= 0x6000 && address <= 0x7FFF) {
            this.programRam[address - 0x6000] = value;
        }
        else if (address >= 0xA000 && address <= 0xAFFF) {
            this.prgBank = value & 0x0F;
        }
        else if (address >= 0xB000 && address <= 0xEFFF) {
            // $B000, $C000, $D000, $E000 -> chrBanks[0..3]
            this.chrBanks[(address >> 12) - 0xB] = value & 0x1F;
        }
        else if (address >= 0xF000) {
            this.horizontalMirroring = (value & 1) != 0;
        }
    }

    mapNametableAddress(address: number): number {
        if (this.horizontalMirroring) {
            // $2000=$2400, $2800=$2C00
            if (address < 0x2400) {
                return address;
            }
            else if (address < 0x2C00) {
                return address - 0x0400;
            }
            return address - 0x0800;
        }

        // Vertical: $2000=$2800, $2400=$2C00
        if (address < 0x2800) {
            return address;
        }
        return address - 0x0800;
    }
}
