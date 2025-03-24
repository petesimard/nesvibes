import { bytesToHex, numberToHex } from "../emulator/utils";
import { BusDevice } from "../emulator/busdevice_interface";
import { Nes } from "./nes";
import { CartridgeHeader } from "./cartridge_loader";

export abstract class Cartridge implements BusDevice {
    programRom: Uint8Array = new Uint8Array();
    programRam: Uint8Array = new Uint8Array(0x2000);
    characterRom: Uint8Array = new Uint8Array();
    nes: Nes;
    header: CartridgeHeader;

    constructor(nes: Nes, rom: Uint8Array, header: CartridgeHeader) {
        this.nes = nes;

        console.log(`Loading ROM with ${rom.length} bytes`);

        this.header = header;

        const prgRomBytesLength = 16384 * this.header.prgRomSize;

        const prgEnd = 16 + prgRomBytesLength;
        this.programRom = rom.slice(16, prgEnd);

        const chrRomBytesLength = 8192 * this.header.chrRomSize;

        const chrEnd = prgEnd + chrRomBytesLength;
        this.characterRom = rom.slice(prgEnd, chrEnd);
    }

    abstract ppu_read(address: number): number;
    abstract ppu_write(address: number, value: number): void;
    abstract read(address: number): number;
    abstract write(address: number, value: number): void;

    public isHorizontalMirroring(): boolean {
        return this.header.isHorizontalMirroring;
    }
}