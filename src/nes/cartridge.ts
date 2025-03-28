import { bytesToHex, numberToHex } from "../emulator/utils";
import { BusDevice } from "../emulator/busdevice_interface";
import { Nes } from "./nes";
import { CartridgeHeader } from "./cartridge_loader";

export abstract class Cartridge implements BusDevice {
    programRom: Uint8Array = new Uint8Array();
    programRam: Uint8Array = new Uint8Array(0x2000);
    characterRom: Uint8Array = new Uint8Array();
    characterRam: Uint8Array = new Uint8Array(0x2000);
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

        this.initialize();
    }

    abstract ppu_read(address: number): number;
    abstract ppu_write(address: number, value: number): void;
    abstract read(address: number): number;
    abstract write(address: number, value: number): void;
    abstract initialize(): void;

    mapNametableAddress(address: number): number {
        if (this.header.isHorizontalMirroring) {
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
        else {
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

        return address;
    }
}

