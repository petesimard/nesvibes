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
    register_OAMDMA: number = 0;

    register_internal_V: number = 0;
    register_internal_T: number = 0;
    register_internal_X: number = 0;
    register_internal_W: number = 0;

    register_internal_tileLow: number = 0;
    register_internal_tileHigh: number = 0;

    register_internal_nametableEntry: number = 0;
    register_internal_attributetableEntry: number = 0;

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
    ppuDataBuffer: number = 0;
    latched_tileLow: number = 0;
    latched_tileHigh: number = 0;


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
        this.register_OAMDMA = 0;
    }

    isInInitialReset(): boolean {
        return this.nes.cycles < 29658;
    }

    read_internal(address: number): number {
        if (address <= 0x1FFF) {
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
        this.vram[address] = value;
    }

    read(address: number): number {
        address = 0x2000 + (address & 0x0007);

        //console.log("PPU read", numberToHex(address));

        if (address == this.register_address_PPUCTRL) {
            return this.register_PPUCTRL;
        }
        else if (address == this.register_address_PPUMASK) {
            return this.register_PPUMASK;
        }
        else if (address == this.register_address_PPUSTATUS) {
            const result = this.register_PPUSTATUS;

            // Clear VBLANK flag on read
            this.register_PPUSTATUS &= ~this.flags_PPUSTATUS_VBLANK;
            this.register_internal_W = 0;
            return result;
        }
        else if (address == this.register_address_OAMADDR) {
            return this.register_OAMADDR;
        }
        else if (address == this.register_address_OAMDATA) {
            return this.oam[this.register_OAMADDR];
        }
        else if (address == this.register_address_PPUSCROLL) {
            return this.register_PPUSCROLL;
        }
        else if (address == this.register_address_PPUADDR) {
            return this.register_PPUADDR;
        }
        else if (address == this.register_address_PPUDATA) {
            const result = this.ppuDataBuffer;
            this.ppuDataBuffer = this.read_internal(this.register_internal_V);
            this.register_internal_V += (this.register_PPUCTRL & this.flags_PPUCTRL_VRAM_ADDRESS_INCREMENT) != 0 ? 32 : 1;
            return result;
        }
        else if (address == this.register_address_OAMDMA) {
            return this.register_OAMDMA;
        }
        else {
            throw new Error("PPU read: Invalid address " + numberToHex(address));
        }
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
                //console.log(`PPUMASK ${numberToHex(this.register_PPUMASK)}`);
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
                    this.register_internal_T = (this.register_internal_T & 0xFFE0) | (value >> 3); // Coarse X scroll (5 bits)
                    this.register_internal_X = (value & 0x07);
                } else {
                    // Second write - Y scroll
                    this.register_internal_T |= ((value & 0x07) << 12); // Fine Y scroll (3 bits)
                    this.register_internal_T = (this.register_internal_T & 0x7C1F) | ((value >> 3) << 5); // Coarse Y scroll (5 bits)
                }
                this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
            }
        }
        else if (address == this.register_address_PPUADDR) {
            if (!this.isInInitialReset()) {
                this.register_PPUADDR = value;
                if (this.register_internal_W == 0) {
                    this.register_internal_T = (this.register_internal_T & 0x40FF) | (value & 0x3F) << 8;
                    this.register_internal_T &= 0x3FFF; // Clear bit 15
                }
                else {
                    this.register_internal_T = (this.register_internal_T & 0xFF) | (value & 0x3F) << 8;
                    this.register_internal_V = this.register_internal_T;

                }
                this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
            }
        }
        else if (address == this.register_address_PPUDATA) {
            this.write_internal(this.register_internal_V, value);
            //console.log(`write_PPUDATA ${numberToHex(this.register_internal_V)} ${numberToHex(value)}`);
            this.register_internal_V += (this.register_PPUCTRL & this.flags_PPUCTRL_VRAM_ADDRESS_INCREMENT) != 0 ? 32 : 1;
        }
        else if (address == this.register_address_OAMDMA) {
            this.register_OAMDMA = value;
        }
    }

    private isVisualScanline(): boolean {
        return (this.current_scanline >= 0 && this.current_scanline <= 239);
    }

    private isRenderingEnabled(): boolean {
        return ((this.register_PPUMASK & this.flags_PPUMASK_ENABLE_BACKGROUND) != 0 || (this.register_PPUMASK & this.flags_PPUMASK_ENABLE_SPRITES) != 0);
    }

    private setPPUCTRL(value: number) {
        const oldValue = this.register_PPUCTRL;
        this.register_PPUCTRL = value;

        //console.log(`setPPUCTRL ${numberToHex(value)}`);

        if ((oldValue & this.flags_PPUCTRL_NMI_ENABLE) == 0 && (value & this.flags_PPUCTRL_NMI_ENABLE) != 0) {
            if (this.register_PPUSTATUS & this.flags_PPUSTATUS_VBLANK) {
                // Changing NMI enable from 0 to 1 while the vblank flag in PPUSTATUS is 1 will immediately trigger an NMI.
                this.nes.NMI();
            }
        }

        this.register_internal_T = (this.register_internal_T & 0xE7FF) | (value & 0x3) << 10;
    }

    fetch_nametable(address: number): number {
        address = this.nametableAddressToVRAM(address);
        return this.vram[address];
    }

    private nametableAddressToVRAM(address: number) {
        const isHorizontalMirroring = this.nes.getCartridge().isHorizontalMirroring();

        if (isHorizontalMirroring) {
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

        //console.log(`fetch_nametable ${numberToHex(address)} ${isHorizontalMirroring ? 'Horizontal' : 'Vertical'} address ${numberToHex(address)}`);
        // Fetch from VRAM
        address -= 0x2000;
        return address;
    }

    fetch_attribute_table(address: number): number {
        address -= 0x2000;
        return this.vram[address];
    }

    clock() {
        if (this.current_scanline >= 0 && this.current_scanline <= 239) {
            // Visible scanlines

            if (this.isRenderingEnabled()) {
                // Rendering enabled
                this.renderScanline();
            }

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

        if (this.current_scanline == 261) {
            // Pre-render scanline

            if (this.isRenderingEnabled()) {
                // Rendering enabled
                this.renderScanline();
            }

            this.preRenderScanlineHit = true;
            if (this.current_dot == 1) {
                // CLear status flags
                this.register_PPUSTATUS &= ~this.flags_PPUSTATUS_VBLANK & ~this.flags_PPUSTATUS_SPRITE_OVERFLOW & ~this.flags_PPUSTATUS_SPRITE_ZERO_HIT;
            }

            if (this.current_dot >= 257 && this.current_dot <= 320) {
                //OAMADDR is set to 0 during each of ticks 257–320 (the sprite tile loading interval) of the pre-render and visible scanlines. 
                this.register_OAMADDR = 0;
            }

            if (this.current_dot >= 280 && this.current_dot <= 304) {
                //If rendering is enabled, at the end of vblank, shortly after the horizontal bits are copied from t to v at dot 257, the PPU will repeatedly copy the vertical bits from t to v from dots 280 to 304, completing the full initialization of v from t:

                if (this.isRenderingEnabled()) {
                    this.register_internal_V = (this.register_internal_V & 0x41F) | (this.register_internal_T & 0x7BE0);
                }
            }
        }

        if (this.current_scanline == 261 && !this.isEvenFrame && this.current_dot == 339 && this.isRenderingEnabled()) {
            // odd frame skip last dots
            this.current_dot = 0;
            this.current_scanline++;
        }
        else {
            // Advance dot
            this.current_dot++;
            if (this.current_dot == 341) {
                // End of scanline, move to next scanline
                this.current_dot = 0;
                this.current_scanline++;
            }

            if (this.current_scanline == 262) {
                // End of frame
                this.current_scanline = 0;
                this.current_dot = 0;
                this.isEvenFrame = !this.isEvenFrame;
            }
        }


    }

    renderScanline() {
        if ((this.current_dot >= 1 && this.current_dot <= 256) || (this.current_dot >= 321 && this.current_dot <= 336)) {
            this.doMemoryFetches();
        }

        if (this.current_dot > 8 && (this.current_dot - 1) % 8 == 0) {
            // transfer tile to latched tile (aka shift register)
            this.latched_tileLow = ((this.latched_tileLow << 8) & 0xFF00) | this.register_internal_tileLow;
            this.latched_tileHigh = ((this.latched_tileHigh << 8) & 0xFF00) | this.register_internal_tileHigh;
        }

        if (this.current_dot >= 1 && this.current_dot <= 256 && this.isVisualScanline()) {
            this.renderPixel();
        }


        if ((this.current_dot > 0 && this.current_dot <= 256) || this.current_dot >= 328) {
            const isHvIncrement = (this.current_dot) % 8 == 0;

            if (isHvIncrement) {
                if ((this.register_internal_V & 0x001F) == 31) { // if coarse X == 31
                    this.register_internal_V &= ~0x001F          // coarse X = 0
                    this.register_internal_V ^= 0x0400           // switch horizontal nametable
                } else {
                    this.register_internal_V += 1                // increment coarse X
                }
            }
        }

        if (this.isRenderingEnabled()) {
            if (this.current_dot == 256) {
                //If rendering is enabled, the PPU increments the vertical position in v. The effective Y scroll coordinate is incremented, which is a complex operation that will correctly skip the attribute table memory regions, and wrap to the next nametable appropriately

                if ((this.register_internal_V & 0x7000) != 0x7000)        // if fine Y < 7
                    this.register_internal_V += 0x1000                      // increment fine Y
                else {
                    this.register_internal_V &= ~0x7000                     // fine Y = 0

                    let y = (this.register_internal_V & 0x03E0) >> 5        // let y = coarse Y
                    if (y == 29) {
                        y = 0                          // coarse Y = 0
                        this.register_internal_V ^= 0x0800                    // switch vertical nametable
                    }
                    else if (y == 31)
                        y = 0                          // coarse Y = 0, nametable not switched
                    else
                        y += 1                         // increment coarse Y

                    this.register_internal_V = (this.register_internal_V & ~0x03E0) | (y << 5)     // put coarse Y back into v
                }

                //console.log(`renderScanline ${this.current_dot} ${this.current_scanline} ${this.register_internal_V}`);
            }
            else if (this.current_dot == 257) {
                // PPU copies all bits related to horizontal position from t to v
                this.register_internal_V = (this.register_internal_V & 0x7BE0) | (this.register_internal_T & 0x41F);

            }
        }
    }

    private doMemoryFetches() {
        if (this.current_dot == 0) {
            // Idle
        }
        else {
            // Normal rendering
            if (((this.current_dot - 1) % 8) == 1) {
                // Nametable byte
                const tileAddress = 0x2000 + (this.register_internal_V & 0x0FFF);
                this.register_internal_nametableEntry = this.fetch_nametable(tileAddress);

                //console.log(`Nametable byte ${numberToHex(this.register_internal_nametableEntry)} at ${numberToHex(tileAddress)} scanline ${this.current_scanline} dot ${this.current_dot}`);
            }
            else if (((this.current_dot - 1) % 8) == 3) {
                // Attribute table byte
                const atTableAddress = 0x23C0 | (this.register_internal_V & 0x0C00) | ((this.register_internal_V >> 4) & 0x38) | ((this.register_internal_V >> 2) & 0x07);
                this.register_internal_attributetableEntry = this.fetch_attribute_table(atTableAddress);
            }
            else if (((this.current_dot - 1) % 8) == 5) {
                // Pattern table low byte
                const backgroundPatternTableAddress = (this.register_PPUCTRL & this.flags_PPUCTRL_BACKGROUND_PATTERN_TABLE_ADDRESS) ? this.address_PATTERNTABLE_1 : this.address_PATTERNTABLE_0;
                const fineY = (this.register_internal_V >> 12) & 0x7;

                const patternTableAddress = backgroundPatternTableAddress + (this.register_internal_nametableEntry * 16) + fineY;
                //console.log(`patternTableAddress ${numberToHex(patternTableAddress)} backgroundPatternTableAddress ${numberToHex(backgroundPatternTableAddress)} this.register_internal_nametableEntry ${numberToHex(this.register_internal_nametableEntry)} fineY ${numberToHex(fineY)}`);
                this.register_internal_tileLow = this.nes.getCartridge().ppu_read(patternTableAddress);
            }
            else if (((this.current_dot - 1) % 8) == 7) {
                // Pattern table high byte
                const backgroundPatternTableAddress = (this.register_PPUCTRL & this.flags_PPUCTRL_BACKGROUND_PATTERN_TABLE_ADDRESS) ? this.address_PATTERNTABLE_1 : this.address_PATTERNTABLE_0;
                const fineY = (this.register_internal_V >> 12) & 0x7;

                const patternTableAddress = backgroundPatternTableAddress + (this.register_internal_nametableEntry * 16) + fineY + 8;
                this.register_internal_tileHigh = this.nes.getCartridge().ppu_read(patternTableAddress);
            }
        }
    }

    renderPixel() {
        const pixelX = (this.current_dot - 1) % 8;
        let lowBit = (this.latched_tileLow & (1 << (15 - pixelX))) != 0 ? 1 : 0;
        let highBit = (this.latched_tileHigh & (1 << (15 - pixelX))) != 0 ? 1 : 0;

        if (this.current_dot <= 8 && (this.register_PPUMASK & this.flags_PPUMASK_SHOW_BACKGROUND_IN_LEFT_8) == 0) {
            lowBit = 0;
            highBit = 0;
        }

        const value = lowBit | (highBit << 1);

        const finalColor = this.bitsToColor(value);

        this.nes.setRenderedPixel(this.current_dot - 1, this.current_scanline, finalColor);
    }

    private bitsToColor(value: number) {
        let finalColor = [];

        if (value == 0) {
            finalColor = [
                0,
                0,
                0,
                255
            ];
        }
        else if (value == 1) {
            finalColor = [
                255,
                0,
                0,
                255
            ];
        }
        else if (value == 2) {
            finalColor = [
                0,
                255,
                0,
                255
            ];
        }
        else {
            finalColor = [
                0,
                0,
                255,
                255
            ];
        }
        return finalColor;
    }

    onReset() {
        this.register_PPUCTRL = 0;
        this.register_PPUMASK = 0;
        this.isEvenFrame = true;
        this.register_PPUSCROLL = 0;
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

    getNameTableImage(table: number): ImageData {
        const baseNameTableAddress = 0x2000 | (table * 0x400);

        const image = new ImageData(256, 240);
        const bitPlane0 = new Uint8Array(8);
        const bitPlane1 = new Uint8Array(8);

        for (let tileY = 0; tileY < 30; tileY++) {
            for (let tileX = 0; tileX < 32; tileX++) {
                const tileAddress = baseNameTableAddress + (tileY * 32) + tileX;
                const tileValue = this.fetch_nametable(tileAddress);

                const backgroundPatternTableAddress = (this.register_PPUCTRL & this.flags_PPUCTRL_BACKGROUND_PATTERN_TABLE_ADDRESS) ? this.address_PATTERNTABLE_1 : this.address_PATTERNTABLE_0;

                const patternTableAddress = backgroundPatternTableAddress + (tileValue * 16);

                for (let k = 0; k < 8; k++) {
                    bitPlane0[k] = this.nes.getCartridge().ppu_read(patternTableAddress + k);
                    bitPlane1[k] = this.nes.getCartridge().ppu_read(patternTableAddress + k + 8);
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

                        const pixelIndex = (imagePixelX + imagePixelY * 256) * 4;

                        const finalColor = this.bitsToColor(value);

                        image.data[pixelIndex] = finalColor[0];
                        image.data[pixelIndex + 1] = finalColor[1];
                        image.data[pixelIndex + 2] = finalColor[2];
                        image.data[pixelIndex + 3] = 255;
                    }
                }

            }
        }

        return image;
    }
}