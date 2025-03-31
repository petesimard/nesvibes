import JSZip from "jszip";
import { Nes } from "./nes";
import { bytesToHex, numberToHex } from "../emulator/utils";
import { Cartridge } from "./cartridge";

import { Mapper00 } from "../mappers/mapper_00";
import { Mapper01 } from "../mappers/mapper_01";
import { Mapper04 } from "../mappers/mapper_04";
import { Mapper02 } from "../mappers/mapper_02";
export class CartridgeLoader {
    constructor(private nes: Nes) {
        this.nes = nes;
    }

    async loadCartridge(rom: Uint8Array): Promise<Cartridge> {
        const cartridgeBytes = await this.cartridgeBytes(rom);
        if (!cartridgeBytes) {
            throw new Error("Failed to load ROM");
        }

        let MapperClass: new (nes: Nes, rom: Uint8Array, header: CartridgeHeader) => Cartridge;
        const header = new CartridgeHeader(cartridgeBytes);

        switch (header.mapperNumber) {
            case 0:
                MapperClass = Mapper00;
                break;
            case 1:
                MapperClass = Mapper01;
                break;
            case 2:
                MapperClass = Mapper02;
                break;
            case 4:
                MapperClass = Mapper04;
                break;
            default:
                throw new Error(`Unsupported mapper number: ${header.mapperNumber}`);
        }

        return new MapperClass(this.nes, cartridgeBytes, header);
    }

    private isValidNESHeader(rom: Uint8Array) {
        return rom[0] === 0x4E && rom[1] === 0x45 && rom[2] === 0x53 && rom[3] === 0x1A;
    }


    async cartridgeBytes(rom: Uint8Array) {
        // Check for iNES header magic number
        if (this.isValidNESHeader(rom)) {
            // Valid iNES format
            return rom;
        }

        // Check for ZIP header magic number (PK\x03\x04)
        if (rom[0] === 0x50 && rom[1] === 0x4B && rom[2] === 0x03 && rom[3] === 0x04) {
            // Valid ZIP format
            // Use JSZip to decompress the ZIP file
            const data = await JSZip.loadAsync(rom);
            const nesFile = Object.values(data.files).find(file => file.name.toLowerCase().endsWith('.nes'));
            if (!nesFile) {
                throw new Error('No .nes file found in ZIP archive');
            }

            const zipBytes = await nesFile.async('uint8array');
            if (this.isValidNESHeader(zipBytes)) {
                return zipBytes;
            }
            else {
                throw new Error('Invalid NES header in ZIP archive');
            }
        }

        throw new Error(`Invalid ROM format Length: ${rom.length} 0: ${numberToHex(rom[0])} 1: ${numberToHex(rom[1])} 2: ${numberToHex(rom[2])} 3: ${numberToHex(rom[3])}`);
    }
}

export class CartridgeHeader {

    mapperNumber: number = 0;
    prgRomSize: number = 0;
    chrRomSize: number = 0;
    prgRamSize: number = 0;
    alternativeNametableLoyout: boolean = false;
    isHorizontalMirroring: boolean = false;

    constructor(private rom: Uint8Array) {
        // Load header
        const header = rom.slice(0, 16);
        console.log(`Header: ${bytesToHex(header)}`);

        const magicBytes = bytesToHex(header.slice(0, 4));
        const expectedMagicBytes = '4E45531A';
        if (magicBytes != expectedMagicBytes) {
            throw new Error(`Invalid magic bytes. Expected ${expectedMagicBytes}, got ${magicBytes}`);
        }

        this.prgRomSize = header[4];
        this.chrRomSize = header[5];
        const flags6 = header[6];

        this.isHorizontalMirroring = (flags6 & 0x01) == 0;
        this.alternativeNametableLoyout = (flags6 & 0x08) == 0;

        const flags7 = header[7];

        this.mapperNumber = (flags6 >> 4) | (flags7 & 0xF0);
        console.log(`Mapper number: ${this.mapperNumber}`);

        const flags8 = header[8];
        const flags9 = header[9];
        const flags10 = header[10];
    }
}