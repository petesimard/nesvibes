import { bytesToHex, numberToHex } from "../emulator/utils";
import { BusDevice } from "../emulator/busdevice_interface";
import { Nes } from "./nes";

export class Cartridge implements BusDevice {
    programRom: Uint8Array = new Uint8Array();
    programRam: Uint8Array = new Uint8Array(0x2000);
    characterRom: Uint8Array = new Uint8Array();
    nes: Nes;
    mapperNumber: number = 0;
    flags6: number = 0;

    constructor(nes: Nes) {
        this.nes = nes;
    }

    ppu_read(address: number): number {
        if (address <= 0x1FFF) {
            return this.characterRom[address];
        }
        else {
            throw new Error("PPU read: Invalid address " + numberToHex(address));
        }
    }

    ppu_write(address: number, value: number): void {
        if (address <= 0x1FFF) {
            this.characterRom[address] = value;
        }
        else {
            throw new Error("PPU write: Invalid address " + numberToHex(address));
        }
    }

    read(address: number): number {
        if (address >= 0x6000 && address <= 0x7FFF) {
            const readAddress = (address - 0x6000) % 0x2000;
            //console.log(`Reading from program ROM at address ${readAddress} Raw address: ${numberToHex(address)} ${numberToHex(this.programRom[readAddress])}`);
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

    public isHorizontalMirroring(): boolean {
        return (this.flags6 & 1) == 1;
    }

    loadROM(rom: Uint8Array) {
        console.log(`Loading ROM with ${rom.length} bytes`);

        // Load header
        const header = rom.slice(0, 16);
        console.log(`Header: ${bytesToHex(header)}`);

        const magicBytes = bytesToHex(header.slice(0, 4));
        const expectedMagicBytes = '4E45531A';
        if (magicBytes != expectedMagicBytes) {
            throw new Error(`Invalid magic bytes. Expected ${expectedMagicBytes}, got ${magicBytes}`);
        }

        const prgRomSize = header[4];
        //console.log(`PRG ROM size: ${prgRomSize}`);

        const chrRomSize = header[5];
        //console.log(`CHR ROM size: ${chrRomSize}`);

        this.flags6 = header[6];
        //console.log(`Flags 6: ${flags6}`);

        const flags7 = header[7];
        //console.log(`Flags 7: ${flags7}`);

        this.mapperNumber = (this.flags6 >> 4) | (flags7 & 0xF0);
        console.log(`Mapper number: ${this.mapperNumber}`);

        const flags8 = header[8];
        //console.log(`Flags 8: ${flags8}`);

        const flags9 = header[9];
        //console.log(`Flags 9: ${flags9}`);

        const flags10 = header[10];
        //console.log(`Flags 10: ${flags10}`);

        //const hasTrainer = (flags6 & 0x04) != 0;
        //console.log(`Has trainer: ${hasTrainer}`);

        const prgRomBytesLength = 16384 * prgRomSize;
        //console.log(`PRG ROM Length: ${prgRomBytesLength}`);

        const prgEnd = 16 + prgRomBytesLength;
        this.programRom = rom.slice(16, prgEnd);

        const chrRomBytesLength = 8192 * chrRomSize;
        //console.log(`CHR ROM Length: ${chrRomBytesLength}`);

        const chrEnd = prgEnd + chrRomBytesLength;
        this.characterRom = rom.slice(prgEnd, chrEnd);
    }
}