import { numberToHex } from "../emulator/utils";
import { Cartridge } from "../nes/cartridge";

export class Mapper01 extends Cartridge {
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
        if (address >= 0x6000 && address <= 0x7FFF) {
            const readAddress = (address - 0x6000) % 0x2000;
            return this.programRom[readAddress];
        }
        else if (address >= 0x8000 && address <= 0xFFFF) {
            const readAddress = (address - 0x8000) % this.programRom.length;
            //console.log(`Reading from program ROM at address ${readAddress} Raw address: ${numberToHex(address)} ${numberToHex(this.programRom[readAddress])}`);
            return this.programRom[readAddress];
        }
        else {
            console.error(`Read from unknown cartridge address: ${numberToHex(address)}`);
        }

        return 0;
    }

    write(address: number, value: number): void {
        if (address >= 0x6000 && address <= 0x7FFF) {
            this.programRom[(address - 0x6000)] = value; // Should be ram?
        }
        else if (address >= 0x8000 && address <= 0xFFFF) {
            this.programRom[(address - 0x8000) % this.programRom.length] = value;
        }
        else {
            console.error(`Write to unknown cartridge address: ${numberToHex(address)}`);
        }
    }

}