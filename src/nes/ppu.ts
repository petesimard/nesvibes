import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { Nes } from "./nes";

export class PPU implements BusDevice {
    private nes: Nes;

    private vram: Uint8Array = new Uint8Array(2048); // 2KB for nametables
    private oam: Uint8Array = new Uint8Array(256); // 256 bytes for OAM

    register_PPUCTRL: number = 0;
    register_PPUMASK: number = 0;
    register_PPUSTATUS: number = 0;
    register_OAMADDR: number = 0;
    register_PPUSCROLL: number = 0;
    register_PPUADDR: number = 0;
    register_PPUDATA: number = 0;
    register_OAMDMA: number = 0;

    register_internal_V: number = 0;
    register_internal_T: number = 0;
    register_internal_X: number = 0;
    register_internal_W: number = 0;

    isEvenFrame: boolean = false;
    current_scanline: number = 0;
    current_dot: number = 0;
    preRenderScanlineHit: boolean = false;

    register_address_PPUCTRL: number = 0x2000;
    register_address_PPUMASK: number = 0x2001;
    register_address_PPUSTATUS: number = 0x2002;
    register_address_OAMADDR: number = 0x2003;
    register_address_OAMDATA: number = 0x2004;
    register_address_PPUSCROLL: number = 0x2005;
    register_address_PPUADDR: number = 0x2006;
    register_address_PPUDATA: number = 0x2007;
    register_address_OAMDMA: number = 0x4014;

    address_PATTERNTABLE_0: number = 0x0000;
    address_PATTERNTABLE_1: number = 0x1000;

    flags_PPUCTRL_BASE_NAMETABLE_ADDRESS1: number = 1 << 0;
    flags_PPUCTRL_BASE_NAMETABLE_ADDRESS2: number = 1 << 1;
    flags_PPUCTRL_VRAM_ADDRESS_INCREMENT: number = 1 << 2;
    flags_PPUCTRL_SPRITE_PATTERN_TABLE_ADDRESS: number = 1 << 3;
    flags_PPUCTRL_BACKGROUND_PATTERN_TABLE_ADDRESS: number = 1 << 4;
    flags_PPUCTRL_SPRITE_SIZE: number = 1 << 5;
    flags_PPUCTRL_MASTER_SLAVE_SELECT: number = 1 << 6;
    flags_PPUCTRL_NMI_ENABLE: number = 1 << 7;

    flags_PPUMASK_GREYSCALE: number = 1 << 0;
    flags_PPUMASK_SHOW_BACKGROUND_IN_LEFT_8: number = 1 << 1;
    flags_PPUMASK_SHOW_SPRITES_IN_LEFT_8: number = 1 << 2;
    flags_PPUMASK_ENABLE_BACKGROUND: number = 1 << 3;
    flags_PPUMASK_ENABLE_SPRITES: number = 1 << 4;
    flags_PPUMASK_EMPHASIZE_RED: number = 1 << 5;
    flags_PPUMASK_EMPHASIZE_GREEN: number = 1 << 6;
    flags_PPUMASK_EMPHASIZE_BLUE: number = 1 << 7;

    flags_PPUSTATUS_SPRITE_OVERFLOW: number = 1 << 5;
    flags_PPUSTATUS_SPRITE_ZERO_HIT: number = 1 << 6;
    flags_PPUSTATUS_VBLANK: number = 1 << 7;


    constructor(nes: Nes) {
        this.nes = nes;
        this.onPower();
    }

    onPower() {
        this.register_PPUCTRL = 0;
        this.register_PPUMASK = 0;
        this.register_PPUSTATUS = 0;
        this.register_OAMADDR = 0;
        this.register_PPUSCROLL = 0;
        this.register_PPUADDR = 0;
        this.register_PPUDATA = 0;
        this.register_OAMDMA = 0;
    }

    isInInitialReset(): boolean {
        return this.nes.cycles < 29658;
    }

    read_internal(address: number): number {
        if (address <= 0x0FFF) {
            return this.nes.getCartridge().ppu_read(address);

        }
        else if (address >= 0x2000 && address <= 0x2FFF) {
            return this.fetch_nametable(address);
        }
        else {
            throw new Error("PPU read_internal: Invalid address " + numberToHex(address));
        }

    }

    write_internal(address: number, value: number): void {
        if (address <= 0x0FFF) {
            this.nes.getCartridge().ppu_write(address, value);
        }
        else {
            throw new Error("PPU write_internal: Invalid address " + numberToHex(address));
        }
    }

    read(address: number): number {
        address = 0x2000 + (address & 0x0007);

        //console.log("PPU read", numberToHex(address));

        if (address == this.register_address_PPUCTRL) {
            //return this.register_PPUCTRL;
            throw new Error("PPUCTRL is not readable");
        }
        else if (address == this.register_address_PPUMASK) {
            //return this.register_PPUMASK;
            throw new Error("PPUMASK is not readable");
        }
        else if (address == this.register_address_PPUSTATUS) {
            const result = this.register_PPUSTATUS;

            // Clear VBLANK flag on read
            this.register_PPUSTATUS &= ~this.flags_PPUSTATUS_VBLANK;
            this.register_internal_W = 0;
            return result;
        }
        else if (address == this.register_address_OAMADDR) {
            //return this.register_OAMADDR;
            throw new Error("OAMADDR is not readable");
        }
        else if (address == this.register_address_OAMDATA) {
            return this.oam[this.register_OAMADDR];
        }
        else if (address == this.register_address_PPUSCROLL) {
            //return this.register_PPUSCROLL;
            throw new Error("PPUSCROLL is not readable");
        }
        else if (address == this.register_address_PPUADDR) {
            //return this.register_PPUADDR;
            throw new Error("PPUADDR is not readable");
        }
        else if (address == this.register_address_PPUDATA) {
            return this.register_PPUDATA;
        }
        else if (address == this.register_address_OAMDMA) {
            //return this.register_OAMDMA;
            throw new Error("OAMDMA is not readable");
        }
        return 0;
    }

    write(address: number, value: number): void {
        address = 0x2000 + (address & 0x0007);

        //console.log("PPU write", numberToHex(address), numberToHex(value));

        if (address == this.register_address_PPUCTRL) {
            if (!this.isInInitialReset()) {
                this.setPPUCTRL(value);
            }
        }
        else if (address == this.register_address_PPUMASK) {
            if (!this.isInInitialReset()) {
                this.register_PPUMASK = value;
            }
        }
        else if (address == this.register_address_PPUSTATUS) {
            this.register_PPUSTATUS = value;
        }
        else if (address == this.register_address_OAMADDR) {
            this.register_OAMADDR = value;
        }
        else if (address == this.register_address_OAMDATA) {
            this.oam[this.register_OAMADDR] = value;
            this.register_OAMADDR++;
        }
        else if (address == this.register_address_PPUSCROLL) {
            if (!this.isInInitialReset()) {
                if (this.register_internal_W == 0) {
                    // First write - X scroll
                    this.register_internal_T = (this.register_internal_T & 0xFFE0) | (value >> 10); // Coarse X scroll (5 bits)
                    this.register_internal_X = (value & 0x07);
                } else {
                    // Second write - Y scroll
                    this.register_internal_T |= ((value & 0x07) << 12); // Fine Y scroll (3 bits)
                    this.register_internal_T = (this.register_internal_T & 0x3E0) | ((value >> 3) << 5); // Coarse Y scroll (5 bits)
                }
                this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
            }
        }
        else if (address == this.register_address_PPUADDR) {
            if (!this.isInInitialReset()) {
                this.register_PPUADDR = value;
                this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
            }
        }
        else if (address == this.register_address_PPUDATA) {
            this.register_PPUDATA = value;
        }
        else if (address == this.register_address_OAMDMA) {
            this.register_OAMDMA = value;
        }
    }

    private setPPUCTRL(value: number) {
        const oldValue = this.register_PPUCTRL;
        this.register_PPUCTRL = value;

        if ((oldValue & this.flags_PPUCTRL_NMI_ENABLE) == 0 && (value & this.flags_PPUCTRL_NMI_ENABLE) != 0) {
            if (this.register_PPUSTATUS & this.flags_PPUSTATUS_VBLANK) {
                // Changing NMI enable from 0 to 1 while the vblank flag in PPUSTATUS is 1 will immediately trigger an NMI.
                this.nes.NMI();
            }
        }

        if (this.register_internal_W == 0) {
            this.register_internal_T = (this.register_internal_T & 0xE7FF) | (value & 0x3) << 10;
        }

        this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
    }

    fetch_nametable(address: number): number {

        const isHorizontalMirroring = this.nes.getCartridge().isHorizontalMirroring();

        if (isHorizontalMirroring) {
            if (address < 0x2800) {
                // Top nametable
                address = address & 0x03FF;
            }
            else {
                // Bottom nametable
                address = (address & 0x03FF) - 0x0400;
            }
        }
        else {
        }

        // Fetch from VRAM
        address -= 0x2000;
        return this.vram[address];
    }

    clock() {

        if (this.current_scanline >= 0 && this.current_scanline <= 239) {
            // Visible scanlines

            if (this.current_dot >= 257 && this.current_dot <= 320) {
                //OAMADDR is set to 0 during each of ticks 257–320 (the sprite tile loading interval) of the pre-render and visible scanlines. 
                this.register_OAMADDR = 0;
            }
        }

        if (this.current_scanline >= 241 && this.current_scanline <= 260) {
            // VBlank

            if (this.current_scanline == 241 && this.current_dot == 1) {
                this.register_PPUSTATUS |= this.flags_PPUSTATUS_VBLANK;

                if ((this.register_PPUCTRL & this.flags_PPUCTRL_NMI_ENABLE) != 0) {
                    // Trigger NMI from VBlank
                    this.nes.NMI();
                }
            }
        }

        this.current_dot++;
        if (this.current_dot == 341) {
            // End of scanline, move to next scanline
            this.current_dot = 0;
            this.current_scanline++;
        }

        if (this.current_scanline == 261) {
            // Pre-render scanline

            if (this.current_dot >= 257 && this.current_dot <= 320) {
                //OAMADDR is set to 0 during each of ticks 257–320 (the sprite tile loading interval) of the pre-render and visible scanlines. 
                this.register_OAMADDR = 0;
            }

            this.preRenderScanlineHit = true;
            if (this.current_dot == 1) {
                // CLear status flags
                this.register_PPUSTATUS &= ~this.flags_PPUSTATUS_VBLANK & ~this.flags_PPUSTATUS_SPRITE_OVERFLOW & ~this.flags_PPUSTATUS_SPRITE_ZERO_HIT;
            }
        }

        if (this.current_scanline == 262) {
            // End of frame
            this.current_scanline = 0;
            this.current_dot = 0;
            this.isEvenFrame = !this.isEvenFrame;
        }
    }

    onReset() {
        this.register_PPUCTRL = 0;
        this.register_PPUMASK = 0;
        this.isEvenFrame = true;
        this.register_PPUSCROLL = 0;
        this.register_PPUDATA = 0;
        this.register_OAMDMA = 0;
        this.current_scanline = 0;
        this.current_dot = 0;
        this.preRenderScanlineHit = false;
    }

    getPatternTableImage(table: number): ImageData {
        const patternTableAddress = table == 0 ? this.address_PATTERNTABLE_0 : this.address_PATTERNTABLE_1;

        const image = new ImageData(128, 128);
        const bitPlane0 = new Uint8Array(8);
        const bitPlane1 = new Uint8Array(8);

        for (let tileY = 0; tileY < 16; tileY++) {
            for (let tileX = 0; tileX < 16; tileX++) {

                // Read bit planes
                for (let k = 0; k < 8; k++) {
                    bitPlane0[k] = this.nes.getCartridge().ppu_read(patternTableAddress + (tileX * 16) + (tileY * 256) + k);
                    bitPlane1[k] = this.nes.getCartridge().ppu_read(patternTableAddress + (tileX * 16) + (tileY * 256) + k + 8);
                }

                for (let pixelY = 0; pixelY < 8; pixelY++) {
                    for (let pixelX = 0; pixelX < 8; pixelX++) {
                        const planeIndex = pixelY;
                        let lowBit = (bitPlane0[planeIndex] & (1 << (7 - pixelX))) != 0 ? 1 : 0;
                        let highBit = (bitPlane1[planeIndex] & (1 << (7 - pixelX))) != 0 ? 1 : 0;

                        const value = lowBit | (highBit << 1);
                        //console.log(`Tile ${tileX}, ${tileY}, Pixel ${pixelX}, ${pixelY}, Value ${value}`);

                        const imagePixelX = (tileX * 8) + pixelX;
                        const imagePixelY = (tileY * 8) + pixelY;

                        const pixelIndex = (imagePixelX + imagePixelY * 128) * 4;

                        image.data[pixelIndex] = value * 85;
                        image.data[pixelIndex + 1] = value * 85;
                        image.data[pixelIndex + 2] = value * 85;
                        image.data[pixelIndex + 3] = 255;
                    }
                }
            }
        }

        return image;
    }
}