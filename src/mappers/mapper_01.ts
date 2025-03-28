import { numberToHex } from "../emulator/utils";
import { Cartridge } from "../nes/cartridge";

// MMC1
export class Mapper01 extends Cartridge {

    ppu_offset_0000: number = 0;
    ppu_offset_1000: number = 0;

    internal_shift_register: number = 0;
    cycle_onwrite: number = 0;
    nametableArrangement: number = 0;
    prgRomBankMode: number = 0;
    chrRomBankMode: number = 0;
    chrRomBank0: number = 0;
    chrRomBank1: number = 0;
    prgRomBank: number = 0;

    initialize(): void {
        this.reset();
    }

    reset() {
        this.prgRomBankMode = 3;
        this.chrRomBankMode = 0;
        this.chrRomBank0 = 0;
        this.chrRomBank1 = 0;
        this.prgRomBank = 0;
        this.internal_shift_register = 0x10;
        this.nametableArrangement = 0;

        console.log(`MMC1: Reset`);
    }


    ppu_read(address: number): number {
        address = this.mapPPUAddress(address);

        if (this.header.chrRomSize > 0) {
            return this.characterRom[address];
        }
        else {
            return this.characterRam[address];
        }

    }

    ppu_write(address: number, value: number): void {
        address = this.mapPPUAddress(address);

        if (this.header.chrRomSize > 0) {
            this.characterRom[address] = value;
        }
        else {
            this.characterRam[address] = value;
        }
    }

    private mapPPUAddress(address: number) {

        if (this.chrRomBankMode == 0) {
            // 8 KiB mode
            const bank = (this.chrRomBank0 * 0x2000);
            return bank + address;
        }
        else {
            // 4 KiB mode
            if (address >= 0x0000 && address < 0x1000) {
                // CHR Bank 0
                const bank = (this.chrRomBank0 * 0x1000);
                return bank + address;
            }
            else {
                // CHR Bank 1
                const bank = (this.chrRomBank1 * 0x1000);
                return bank + (address - 0x1000);
            }
        }
    }

    private mapROMAddress(address: number) {
        switch (this.prgRomBankMode) {
            case 0:
            case 1:
                //switch 32 KB at $8000
                const bank = this.prgRomBank * 0x8000;
                return bank + (address - 0x8000);
            case 2:
                // fix first bank at $8000 and switch 16 KB bank at $C000;
                if (address >= 0x8000 && address <= 0xBFFF) {
                    let readAddress = (address - 0x8000);
                    return readAddress;
                }
                else if (address >= 0xC000 && address <= 0xFFFF) {
                    const bank = this.prgRomBank * 0x4000;
                    return bank + (address - 0xC000);
                }
                break;
            case 3:
                // fix last bank at $C000 and switch 16 KB bank at $8000)
                if (address >= 0x8000 && address <= 0xBFFF) {
                    const bank = this.prgRomBank * 0x4000;
                    return bank + (address - 0x8000);
                }
                else if (address >= 0xC000 && address <= 0xFFFF) {
                    const bank = (this.header.prgRomSize - 1) * 0x4000;
                    return bank + (address - 0xC000);
                }

        }

        throw new Error(`Invalid ROM address: ${numberToHex(address)}`);
    }



    read(address: number): number {
        if (address >= 0x6000 && address <= 0x7FFF) {
            const readAddress = (address - 0x6000) % this.programRam.length;
            return this.programRam[readAddress];
        }
        else if (address >= 0x8000 && address <= 0xFFFF) {
            const readAddress = this.mapROMAddress(address);
            return this.programRom[readAddress];
        }
        else {
            console.error(`Read from unknown cartridge address: ${numberToHex(address)}`);
        }

        return 0;
    }


    write(address: number, value: number): void {
        if (address >= 0x6000 && address <= 0x7FFF) {
            const writeAddress = (address - 0x6000) % this.programRam.length;
            this.programRam[writeAddress] = value;
        }
        else if (address >= 0x8000 && address <= 0xFFFF) {
            // Special mapper writes
            if (value & 0x80) {
                // Bit 7 is set, reset the mapper
                this.reset();
            }
            else {
                if (this.cycle_onwrite == this.nes.getCpu().getCycles() - 1) {
                    //console.log(`consecutive cycle on write ignore: ${this.cycle_onwrite}`);
                    this.cycle_onwrite = this.nes.getCpu().getCycles();
                    return;
                }

                this.cycle_onwrite = this.nes.getCpu().getCycles();

                const isSRfull = (this.internal_shift_register & 0x01) == 1;
                this.internal_shift_register = (this.internal_shift_register >> 1) | ((value & 1) << 4);

                if (isSRfull) {
                    this.performBankSwitch(address, this.internal_shift_register);
                    this.internal_shift_register = 0x10;
                }


            }
        }
        else {
            console.error(`Write to unknown cartridge address: ${numberToHex(address)}`);
        }
    }

    performBankSwitch(address: number, shift_register: number) {
        if (address >= 0x8000 && address <= 0x9FFF) {
            // Control
            this.nametableArrangement = (shift_register & 0x03);
            this.prgRomBankMode = (shift_register & 0xC) >> 2;
            this.chrRomBankMode = (shift_register & 0x10) >> 4;

            // console.log(`MMC1: Control register updated: ${numberToHex(shift_register)}`);
            // console.log(`MMC1: Nametable arrangement: ${this.nametableArrangement}`);
            // console.log(`MMC1: PRG ROM bank mode: ${this.prgRomBankMode}`);
            // console.log(`MMC1: CHR ROM bank mode: ${this.chrRomBankMode}`);
        }
        else if (address >= 0xA000 && address <= 0xBFFF) {
            // CHR bank 0 
            this.chrRomBank0 = shift_register;

            if (this.header.chrRomSize == 1) {
                // For carts with 8 KiB of CHR (be it ROM or RAM), MMC1 follows the common behavior of using only the low-order bits: the bank number is in effect ANDed with 1.
                this.chrRomBank0 &= 0x1;

            }

            if (this.chrRomBankMode == 0) {
                this.chrRomBank0 >>= 1;
            }

            //console.log(`MMC1: CHR bank 0 updated: ${numberToHex(this.chrRomBank0)}`);
        }
        else if (address >= 0xC000 && address <= 0xDFFF) {
            // CHR bank 1
            this.chrRomBank1 = shift_register;

            //console.log(`MMC1: CHR bank 1 updated: ${numberToHex(this.chrRomBank1)}`);
        }
        else if (address >= 0xE000 && address <= 0xFFFF) {
            // PRG ROM bank
            this.prgRomBank = (shift_register & 0xF);

            if (this.prgRomBankMode < 2) {
                this.prgRomBank >>= 1;
            }

            //console.log(`MMC1: PRG ROM bank updated: ${numberToHex(this.prgRomBank)}`);
        }
    }

    mapNametableAddress(address: number): number {
        if (this.nametableArrangement == 0) {
            // One screen, lower bank
            if (address < 0x2400) {
                address += 0x400;
            }
            else if (address >= 0x2400 && address < 0x2800) {
            }
            else if (address >= 0x2800 && address < 0x2C00) {
                address -= 0x400;
            }
            else {
                address -= 0x800;
            }
        }
        else if (this.nametableArrangement == 1) {
            // One screen, upper bank
            if (address < 0x2400) {
            }
            else if (address >= 0x2400 && address < 0x2800) {
                address -= 0x400;
            }
            else if (address >= 0x2800 && address < 0x2C00) {
                address -= 0x800;
            }
            else {
                address -= 0xC00;
            }
        }
        else if (this.nametableArrangement == 2) {
            // Vertical mirroring
            if (address < 0x2800) {
                // Top nametable
                address = address;
            }
            else {
                // Bottom nametable
                address = address - 0x0800;
            }
        }
        else if (this.nametableArrangement == 3) {
            // Horizontal mirroring
            if (address < 0x2400) {
                // Left nametable
                address = address;
            }
            else if (address >= 0x2400 && address < 0x2C00) {
                address = address - 0x0400;
            }
            else {
                // Right nametable
                address = address - 0x0800;
            }
        }

        return address;
    }

}