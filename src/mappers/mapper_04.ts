import { numberToHex } from "../emulator/utils";
import { Cartridge } from "../nes/cartridge";

export class Mapper04 extends Cartridge {
    bankRegisterToUpdate: number = 0;
    prgRomBankMode: number = 0;
    chrInversion: number = 0;
    nametableArrangement: number = 0;
    bankRegisters: number[] = [];
    irqCounterReload: number = 0;
    irqCounter: number = 0;
    irqPendingReload: boolean = false;
    irqEnabled: boolean = false;


    initialize(): void {
        this.bankRegisters = new Array(8).fill(0);
        for (let i = 0; i < 8; i++) {
            this.bankRegisters[i] = 0;
        }
    }

    ppu_read(address: number): number {
        address = this.mapPPUAddress(address);
        return this.characterRom[address];
    }

    ppu_write(address: number, value: number): void {
        address = this.mapPPUAddress(address);
        this.characterRom[address] = value;
    }


    read(address: number): number {
        if (address >= 0x6000 && address <= 0x7FFF) {
            const readAddress = (address - 0x6000) % this.programRam.length;
            return this.programRam[readAddress];
        }
        else if (address >= 0x8000 && address <= 0xFFFF) {
            address = this.mapROMAddress(address);
            return this.programRom[address];
        }

        throw new Error(`Read from unknown cartridge address: ${numberToHex(address)}`);
    }

    write(address: number, value: number): void {
        if (address >= 0x6000 && address <= 0x7FFF) {
            const readAddress = (address - 0x6000) % this.programRam.length;
            this.programRam[readAddress] = value;
        }
        else if (address >= 0x8000 && address <= 0xFFFF) {
            this.performBankSwitch(address, value);
        }
    }

    performBankSwitch(address: number, value: number) {
        const isEven = (address & 1) == 0;

        if (address >= 0x8000 && address <= 0x9FFF && isEven) {
            // Bank select
            this.bankRegisterToUpdate = value & 0x7;
            this.prgRomBankMode = (value & 0x40) >> 6;
            this.chrInversion = (value & 0x80) >> 7;
        }
        else if (address >= 0x8001 && address <= 0x9FFF && !isEven) {
            // Bank Data
            this.bankRegisters[this.bankRegisterToUpdate] = value;

            if (this.bankRegisterToUpdate > 5) {
                //R6 and R7 will ignore the top two bits, as the MMC3 has only 6 PRG ROM address lines
                this.bankRegisters[this.bankRegisterToUpdate] &= 0x3F;
            }
            if (this.bankRegisterToUpdate < 2) {
                //R0 and R1 ignore the bottom bit, as the value written still counts banks in 1KB units but odd numbered banks can't be selected.
                this.bankRegisters[this.bankRegisterToUpdate] &= 0xFE;
            }
        }
        else if (address >= 0xA000 && address <= 0xBFFF && isEven) {
            // Nametable arrangement
            this.nametableArrangement = (value & 1);
        }
        else if (address >= 0xC000 && address <= 0xDFFF && isEven) {
            // IRQ Latch
            this.irqCounterReload = value;
        }
        else if (address >= 0xC001 && address <= 0xDFFF && !isEven) {
            // IRQ Reload
            this.irqCounter = 0;
            this.irqPendingReload = true;
        }
        else if (address >= 0xE000 && address <= 0xFFFE && isEven) {
            // IRQ Disable
            this.irqEnabled = false;
            // todo acknowledge pending irq
        }
        else if (address >= 0xE001 && address <= 0xFFFF && !isEven) {
            // IRQ Enable
            this.irqEnabled = true;
        }
    }

    private mapPPUAddress(address: number): number {
        let bankAddress = 0;
        let bankSize = 0x400;
        let bankIndex = -1;
        let baseAddress = 0;
        address &= 0x1FFF;

        if (this.chrInversion == 0) {
            if (address < 0x0800) {
                bankIndex = 0;
                bankSize = 0x800;
                baseAddress = 0x0000;
            } else if (address < 0x1000) {
                bankIndex = 1;
                bankSize = 0x800;
                baseAddress = 0x0800;
            } else if (address < 0x1400) {
                bankIndex = 2;
                baseAddress = 0x1000;
            } else if (address < 0x1800) {
                bankIndex = 3;
                baseAddress = 0x1400;
            } else if (address < 0x1C00) {
                bankIndex = 4;
                baseAddress = 0x1800;
            } else {
                bankIndex = 5;
                baseAddress = 0x1C00;
            }
        } else {
            if (address < 0x0400) {
                bankIndex = 2;
                baseAddress = 0x0000;
            } else if (address < 0x0800) {
                bankIndex = 3;
                baseAddress = 0x0400;
            } else if (address < 0x0C00) {
                bankIndex = 4;
                baseAddress = 0x0800;
            } else if (address < 0x1000) {
                bankIndex = 5;
                baseAddress = 0x0C00;
            } else if (address < 0x1800) {
                bankIndex = 0;
                bankSize = 0x800;
                baseAddress = 0x1000;
            } else {
                bankIndex = 1;
                bankSize = 0x800;
                baseAddress = 0x1800;
            }
        }

        if (bankIndex === -1) {
            throw new Error(`Invalid PPU address for mapping: ${numberToHex(address)}`);
        }

        let bankValue = this.bankRegisters[bankIndex];
        if (bankIndex < 2) {
            bankValue &= 0xFE;
            bankAddress = bankValue * 0x400;
        } else {
            bankAddress = bankValue * 0x400;
        }

        let offset = address - baseAddress;

        let finalAddress = (bankAddress + offset) % this.characterRom.length;

        return finalAddress;
    }


    private mapROMAddress(address: number): number {
        let bankAddress = 0;

        if (address >= 0x8000 && address <= 0x9FFF) {
            if (this.prgRomBankMode == 0) {
                bankAddress = this.bankRegisters[6] * 0x2000;
            }
            else {
                bankAddress = ((this.header.prgRomSize * 2) - 2) * 0x2000;
            }
            address -= 0x8000;
        }
        else if (address >= 0xA000 && address <= 0xBFFF) {
            bankAddress = this.bankRegisters[7] * 0x2000;
            address -= 0xA000;
        }
        else if (address >= 0xC000 && address <= 0xDFFF) {
            if (this.prgRomBankMode == 0) {
                bankAddress = ((this.header.prgRomSize * 2) - 2) * 0x2000;
            }
            else {
                bankAddress = this.bankRegisters[6] * 0x2000;
            }
            address -= 0xC000;
        }
        else if (address >= 0xE000 && address <= 0xFFFF) {
            bankAddress = ((this.header.prgRomSize * 2) - 1) * 0x2000;
            address -= 0xE000;
        }
        else {
            throw new Error(`Read from unknown cartridge address: ${numberToHex(address)}`);
        }

        return bankAddress + address;
    }

    mapNametableAddress(address: number): number {

        if (this.nametableArrangement == 0) {
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
        else if (this.nametableArrangement == 1) {
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

    onA12Clock() {
        let isCounter0 = this.irqCounter <= 0;
        if (isCounter0 || this.irqPendingReload) {
            this.irqCounter = this.irqCounterReload;
            this.irqPendingReload = false;
        }
        else {
            this.irqCounter--;
        }

        if (this.irqCounter <= 0 && this.irqEnabled) {
            this.nes.getCpu().IRQ();
        }
    }
}