import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { Nes } from "./nes";
import { NES_PALETTE } from "./palettes/palette";

export class PPU implements BusDevice {

    private nes: Nes;

    private vram: Uint8Array = new Uint8Array(4048); // 4KB for nametables
    private OAM: Uint8Array = new Uint8Array(256); // 256 bytes for OAM
    private secondaryOAM: Uint8Array = new Uint8Array(32); // 32 bytes for secondary OAM
    private palette: Uint8Array = new Uint8Array(32);
    private colorBuffer: number[] = [0, 0, 0, 255];

    private sprites_tiles_low: number[] = [];
    private sprites_tiles_high: number[] = [];
    private sprites_tiles_attributes: number[] = [];
    private sprites_xPos: number[] = [];

    register_PPUCTRL: number = 0;
    register_PPUMASK: number = 0;
    register_PPUSTATUS: number = 0;
    register_OAMADDR: number = 0;
    register_PPUSCROLL: number = 0;
    register_PPUADDR: number = 0;

    register_internal_V: number = 0;
    register_internal_T: number = 0;
    register_internal_X: number = 0;
    register_internal_W: number = 0;

    register_internal_tileLow: number = 0;
    register_internal_tileHigh: number = 0;

    register_internal_nametableEntry: number = 0;
    register_internal_attributetableEntry: number = 0;

    frame_counter: number = 0;
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
    latched_attributeTable: number = 0;
    internal_oam_N: number = 0;
    internal_oam_M: number = -1;
    internal_secondaryOAM_sprite0: number = -1;
    internal_latched_secondaryOAM_sprite0: number = -1;
    pixelNumber: number = 0;
    lastA12Value: number = 0; // Used for IRQ tracking in some mappers
    lastA12Clock: number = 0;

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
        else if (address >= 0x2000 && address < 0x3F00) {
            return this.vram[address - 0x2000];
        }
        else if (address >= 0x3F00 && address <= 0x3FFF) {
            if (address % 4 == 0 && (address & 0x10) != 0) {
                address &= ~0x10;
            }

            return this.palette[(address - 0x3F00) % 0x20];
        }
        else {
            throw new Error("PPU read_internal: Invalid address " + numberToHex(address));
        }

    }

    write_internal(address: number, value: number): void {
        if (address < 0x0000 || address > 0x3FFF) {
            throw new Error("PPU write_internal: Invalid address " + numberToHex(address));
        }

        if (address < 0x2000) {
            this.nes.getCartridge().ppu_write(address, value);
        }
        else if (address >= 0x2000 && address <= 0x2FFF) {
            address = this.nametableAddressToVRAM(address);
            this.vram[address] = value;
        }
        else if (address >= 0x2000 && address < 0x3F00) {
            this.vram[address - 0x2000] = value;
        }
        else if (address >= 0x3F00 && address <= 0x3FFF) {
            if (address % 4 == 0 && (address & 0x10) != 0) {
                address &= ~0x10;
            }

            this.palette[(address - 0x3F00) % 0x20] = value;
        }
        else {
            throw new Error("PPU write_internal: Invalid address " + numberToHex(address));
        }
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
            return this.OAM[this.register_OAMADDR];
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
        else {
            throw new Error("PPU read: Invalid address " + numberToHex(address));
        }
    }

    write(address: number, value: number): void {
        address = 0x2000 + (address & 0x0007);
        //console.log("PPU write", numberToHex(address), numberToHex(value));

        if (address == this.register_address_PPUCTRL) {
            //console.log(`PPUCTRL ${numberToHex(value)} ${this.isInInitialReset() ? 'Initial Reset' : 'Not Initial Reset'}`);
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
            //this.register_PPUSTATUS = value;
        }
        else if (address == this.register_address_OAMADDR) {
            this.register_OAMADDR = value;
        }
        else if (address == this.register_address_OAMDATA) {
            this.OAM[this.register_OAMADDR] = value;
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
                    //FGH..ABCDE.....
                    this.register_internal_T = (this.register_internal_T & 0xFFF) | ((value & 0x07) << 12); // Fine Y scroll (3 bits)
                    this.register_internal_T = (this.register_internal_T & 0x7C1F) | ((value >> 3) << 5); // Coarse Y scroll (5 bits)
                }
                this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
            }
        }
        else if (address == this.register_address_PPUADDR) {
            if (!this.isInInitialReset()) {
                this.register_PPUADDR = value;
                if (this.register_internal_W == 0) {
                    this.register_internal_T = (this.register_internal_T & 0xFF) | ((value & 0x3F) << 8);
                    this.register_internal_T &= 0x3FFF; // Clear bit 15
                    //console.log(`PPUADDR ${numberToHex(this.register_internal_V)} HIGH = ${numberToHex((value & 0x3F))}`);
                }
                else {
                    this.register_internal_T = (this.register_internal_T & 0xFF00) | value;
                    this.register_internal_V = this.register_internal_T;

                    //console.log(`PPUADDR ${numberToHex(this.register_internal_V)}`);
                }
                this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
            }
        }
        else if (address == this.register_address_PPUDATA) {
            this.write_internal(this.register_internal_V, value);
            this.register_internal_V += (this.register_PPUCTRL & this.flags_PPUCTRL_VRAM_ADDRESS_INCREMENT) != 0 ? 32 : 1;

            //console.log(`PPUDATA WRITE AT ${numberToHex(this.register_internal_V)}`);
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

        this.register_internal_T = (this.register_internal_T & 0xF3FF) | ((value & 0x3) << 10);
    }

    fetch_nametable(address: number): number {
        address = this.nametableAddressToVRAM(address);
        return this.vram[address];
    }

    private nametableAddressToVRAM(address: number) {
        address = this.nes.getCartridge().mapNametableAddress(address);

        // Fetch from VRAM
        address -= 0x2000;
        return address;
    }


    clock() {
        if (this.current_scanline >= 0 && this.current_scanline <= 239) {
            // Visible scanlines

            if (this.current_dot >= 257 && this.current_dot <= 320) {
                this.loadSpriteTiles();
            }

            if (this.isRenderingEnabled()) {
                // Rendering enabled
                this.processSprites();
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

                if ((this.register_PPUCTRL & this.flags_PPUCTRL_NMI_ENABLE) != 0 && this.nes.cycles >= 29658) {
                    // Trigger NMI from VBlank
                    this.nes.NMI();
                }
            }
        }

        if (this.current_scanline == 261) {
            // Pre-render scanline

            if (this.isRenderingEnabled()) {

                if (this.current_dot >= 257 && this.current_dot <= 320) {
                    this.loadSpriteTiles();
                }

                // Rendering enabled
                this.renderScanline();
            }

            this.preRenderScanlineHit = true;
            if (this.current_dot == 1) {
                // CLear status flags
                this.register_PPUSTATUS &= ~this.flags_PPUSTATUS_VBLANK & ~this.flags_PPUSTATUS_SPRITE_OVERFLOW & ~this.flags_PPUSTATUS_SPRITE_ZERO_HIT;
                this.internal_latched_secondaryOAM_sprite0 = -1;
                //this.onA12Updated(0);
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

        if (this.current_scanline == 261 && this.frame_counter % 2 == 1 && this.current_dot == 339 && this.isRenderingEnabled()) {
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
                this.frame_counter++;
                this.pixelNumber = 0;
                this.nes.onFrameReady();
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

            this.latched_attributeTable = ((this.latched_attributeTable << 2) & 0xC) | this.register_internal_attributetableEntry;
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
                const tileAddress = 0x2000 | (this.register_internal_V & 0x0FFF);
                this.register_internal_nametableEntry = this.fetch_nametable(tileAddress);
                //    console.log(`Nametable byte ${numberToHex(this.register_internal_nametableEntry)} at ${numberToHex(tileAddress)} scanline ${this.current_scanline} dot ${this.current_dot}`);
            }
            else if (((this.current_dot - 1) % 8) == 3) {
                // Attribute table byte
                const atTableAddress = 0x23C0 | (this.register_internal_V & 0x0C00) | ((this.register_internal_V >> 4) & 0x38) | ((this.register_internal_V >> 2) & 0x07);
                const attributeByte = this.read_internal(atTableAddress); arguments

                //(v & 2) is the bit that decides horizontal quadrant.
                //(v & 64) is the bit that decides vertical quadrant.
                const horizontalQuadrant = (this.register_internal_V & 2) == 0 ? 0 : 1;
                const verticalQuadrant = (this.register_internal_V & 64) == 0 ? 0 : 1;

                const atrBitsIndex = (verticalQuadrant << 1) | horizontalQuadrant;

                const attributeBits = attributeByte >> (atrBitsIndex * 2);
                this.register_internal_attributetableEntry = attributeBits & 0x3;
            }
            else if (((this.current_dot - 1) % 8) == 5) {
                // Pattern table low byte
                const backgroundPatternTableAddress = (this.register_PPUCTRL & this.flags_PPUCTRL_BACKGROUND_PATTERN_TABLE_ADDRESS) ? this.address_PATTERNTABLE_1 : this.address_PATTERNTABLE_0;
                const fineY = (this.register_internal_V >> 12) & 0x7;

                const patternTableAddress = backgroundPatternTableAddress + (this.register_internal_nametableEntry * 16) + fineY;
                //console.log(`patternTableAddress ${numberToHex(patternTableAddress)} backgroundPatternTableAddress ${numberToHex(backgroundPatternTableAddress)} this.register_internal_nametableEntry ${numberToHex(this.register_internal_nametableEntry)} fineY ${numberToHex(fineY)}`);
                this.register_internal_tileLow = this.nes.getCartridge().ppu_read(patternTableAddress);
                this.onA12Updated((patternTableAddress & 0x1000) >> 12);
            }
            else if (((this.current_dot - 1) % 8) == 7) {
                // Pattern table high byte
                const backgroundPatternTableAddress = (this.register_PPUCTRL & this.flags_PPUCTRL_BACKGROUND_PATTERN_TABLE_ADDRESS) ? this.address_PATTERNTABLE_1 : this.address_PATTERNTABLE_0;
                const fineY = (this.register_internal_V >> 12) & 0x7;

                const patternTableAddress = backgroundPatternTableAddress + (this.register_internal_nametableEntry * 16) + fineY + 8;
                this.register_internal_tileHigh = this.nes.getCartridge().ppu_read(patternTableAddress);
                this.onA12Updated((patternTableAddress & 0x1000) >> 12);
            }
        }
    }

    renderPixel() {

        // Background
        const pixelX = ((this.current_dot - 1) % 8) + this.register_internal_X;

        const attributeBits = (pixelX & 0x8) == 0 ?
            this.latched_attributeTable >> 2 :
            this.latched_attributeTable & 0x3;


        let tile_lowBit = (this.latched_tileLow & (1 << (15 - pixelX))) != 0 ? 1 : 0;
        let tile_highBit = (this.latched_tileHigh & (1 << (15 - pixelX))) != 0 ? 1 : 0;

        let tile_patternBits = tile_lowBit | (tile_highBit << 1);
        let selectedSprite = -1;
        let sprite_patternBits = 0;
        let sprite_attributes = 0;
        // Sprites
        for (let i = 0; i < 8; i++) {
            const sprite_xPos = this.sprites_xPos[i];
            if (sprite_xPos == -1) {
                continue;
            }

            let spriteFineX = (this.current_dot - 1) - sprite_xPos;

            if (spriteFineX >= 0 && spriteFineX <= 7) {
                sprite_attributes = this.sprites_tiles_attributes[i];

                if ((sprite_attributes & 0x40) != 0) {
                    spriteFineX = 7 - spriteFineX;
                }
                const sprite_tile_low = (this.sprites_tiles_low[i] & (1 << (7 - spriteFineX))) != 0 ? 1 : 0;
                const sprite_tile_high = (this.sprites_tiles_high[i] & (1 << (7 - spriteFineX))) != 0 ? 1 : 0;

                sprite_patternBits = sprite_tile_low | (sprite_tile_high << 1);

                if (sprite_patternBits == 0) {
                    // Sprite pixel is transparent
                    continue;
                }

                this.doSprite0Check(i, sprite_patternBits, tile_patternBits);
                selectedSprite = i;
                break;
            }
        }

        let paletteIndex = 0;
        let isSpriteVisible = false;

        if (selectedSprite != -1) {
            isSpriteVisible = tile_patternBits == 0;

            if (!isSpriteVisible) {
                // Both visible
                const isSpriteInFront = (sprite_attributes & 0x20) == 0;
                if (isSpriteInFront) {
                    isSpriteVisible = true;
                }
            }
        }

        let isTransparent = false;

        if (this.current_dot <= 8 && (this.register_PPUMASK & this.flags_PPUMASK_SHOW_BACKGROUND_IN_LEFT_8) == 0) {
            tile_patternBits = 0;
        }

        if (isSpriteVisible && (this.register_PPUMASK & this.flags_PPUMASK_ENABLE_SPRITES) != 0) {
            // Draw sprite            
            paletteIndex = sprite_patternBits | ((sprite_attributes & 0x3) << 2) | 0x10;

            if ((this.register_PPUMASK & this.flags_PPUMASK_SHOW_SPRITES_IN_LEFT_8) == 0 && this.current_dot < 9)
                paletteIndex = 0;

            isTransparent = sprite_patternBits == 0;

        }
        else {
            // Draw background
            paletteIndex = tile_patternBits | (attributeBits << 2);

            isTransparent = tile_patternBits == 0;

            if ((this.register_PPUMASK & this.flags_PPUMASK_ENABLE_BACKGROUND) == 0) {
                paletteIndex = 0;
            }

            if ((this.register_PPUMASK & this.flags_PPUMASK_SHOW_BACKGROUND_IN_LEFT_8) == 0 && this.current_dot < 9)
                paletteIndex = 0;
        }

        if (isTransparent) {
            paletteIndex = 0;
        }

        const paletteAddress = 0x3F00 | paletteIndex;
        const palette = this.read_internal(paletteAddress);


        if (this.nes.overscan && (this.current_scanline > 239 || this.current_scanline < 8)) {
            return;
        }


        const finalColor = this.bitsToColor(palette);
        const index = (this.pixelNumber) * 4
        this.nes.outputBuffer[index] = finalColor[0];
        this.nes.outputBuffer[index + 1] = finalColor[1];
        this.nes.outputBuffer[index + 2] = finalColor[2];

        this.pixelNumber++;
    }

    private doSprite0Check(selectedSprite: number, sprite_patternBits: number, tile_patternBits: number): boolean {
        if (this.internal_latched_secondaryOAM_sprite0 != -1 && selectedSprite == this.internal_latched_secondaryOAM_sprite0 &&
            (this.register_PPUMASK & this.flags_PPUMASK_ENABLE_BACKGROUND) != 0 &&
            (this.register_PPUMASK & this.flags_PPUMASK_ENABLE_SPRITES) != 0 &&
            (this.register_PPUSTATUS & this.flags_PPUSTATUS_SPRITE_ZERO_HIT) == 0 &&
            sprite_patternBits != 0 && tile_patternBits != 0 &&
            this.current_dot != 256 && this.current_scanline != 255 &&
            !(this.current_dot <= 8 && (((this.register_PPUMASK & this.flags_PPUMASK_SHOW_BACKGROUND_IN_LEFT_8) == 0) || (this.register_PPUMASK & this.flags_PPUMASK_SHOW_SPRITES_IN_LEFT_8) == 0))
        ) {
            // Sprite zero hit
            this.register_PPUSTATUS |= this.flags_PPUSTATUS_SPRITE_ZERO_HIT;
            return true;
        }
        return false;
    }

    private bitsToColor(patternIndex: number) {

        const color = NES_PALETTE[patternIndex];
        this.colorBuffer[0] = color[0];
        this.colorBuffer[1] = color[1];
        this.colorBuffer[2] = color[2];

        return this.colorBuffer;
    }

    getPalette(i: number): number[] {
        const paletteAddress = 0x3F00 | i;
        const palette = this.read_internal(paletteAddress);

        return this.bitsToColor(palette);
    }

    onReset() {
        this.register_PPUCTRL = 0;
        this.register_PPUMASK = 0;
        this.frame_counter = 0;
        this.register_PPUSCROLL = 0;
        this.current_scanline = 0;
        this.current_dot = 0;
        this.preRenderScanlineHit = false;

        for (let i = 0; i < 32; i++) {
            this.secondaryOAM[i] = 0xFF;
        }
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

    getSprite(i: number): [ImageData, string] {

        const is8x16 = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_SIZE) != 0;
        const image = new ImageData(8, is8x16 ? 16 : 8);
        const attribute = this.OAM[i * 4 + 2];

        for (let pixelY = 0; pixelY < (is8x16 ? 16 : 8); pixelY++) {

            for (let pixelX = 0; pixelX < 8; pixelX++) {

                let fineY = pixelY;
                if ((attribute & 0x80) != 0) {
                    fineY = 15 - fineY;
                }


                const spriteY = this.OAM[i * 4];
                let tile = this.OAM[i * 4 + 1];
                const spriteX = this.OAM[i * 4 + 3];


                let patternTableNumber = 0;
                if (is8x16) {
                    // 8x16 sprites
                    patternTableNumber = tile & 0x01;
                    tile &= ~(1);

                    if (fineY > 7) {
                        tile += 1;
                        fineY = fineY - 8;
                    }
                }
                else {
                    patternTableNumber = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_PATTERN_TABLE_ADDRESS) != 0 ? 1 : 0;
                }

                let spriteFineX = pixelX;

                if ((attribute & 0x40) != 0) {
                    spriteFineX = 7 - spriteFineX;
                }

                const patternPatternTableAddress = patternTableNumber == 0 ? this.address_PATTERNTABLE_0 : this.address_PATTERNTABLE_1;

                const patternTableLowAddress = patternPatternTableAddress + (tile * 16) + fineY;
                const lowBits = this.nes.getCartridge().ppu_read(patternTableLowAddress);
                const lowBit = (lowBits & (1 << (spriteFineX))) != 0 ? 1 : 0;

                const patternTableHighAddress = patternPatternTableAddress + (tile * 16) + fineY + 8;
                const highBits = this.nes.getCartridge().ppu_read(patternTableHighAddress);
                const highBit = (highBits & (1 << (spriteFineX))) != 0 ? 1 : 0;
                const sprite_patternBits = lowBit | (highBit << 1);
                const paletteIndex = sprite_patternBits | ((attribute & 0x3) << 2) | 0x10;

                const paletteAddress = 0x3F00 | paletteIndex;
                const palette = this.read_internal(paletteAddress);
                const finalColor = this.bitsToColor(palette);

                const index = (pixelX + pixelY * 8) * 4;
                image.data[index] = finalColor[0];
                image.data[index + 1] = finalColor[1];
                image.data[index + 2] = finalColor[2];
                image.data[index + 3] = 255;
            }
        }

        return [image, numberToHex(this.OAM[i * 4 + 1])];
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

                        const finalColor = value * 85;

                        image.data[pixelIndex] = finalColor;
                        image.data[pixelIndex + 1] = finalColor;
                        image.data[pixelIndex + 2] = finalColor;
                        image.data[pixelIndex + 3] = 255;
                    }
                }

            }
        }

        return image;
    }

    xScroll(): number {
        return ((this.register_internal_V & 0x001F) * 8) + this.register_internal_X;
    }

    yScroll(): number {
        // Get coarse Y scroll (5 bits)
        const coarseY = (this.register_internal_V & 0x03E0) >> 5;
        // Get fine Y scroll (3 bits)
        const fineY = (this.register_internal_V & 0x7000) >> 12;
        // Combine coarse and fine Y to get scanline number
        return (coarseY * 8) + fineY;
    }

    processSprites() {
        if (this.current_dot > 0 && this.current_dot <= 64 && (this.current_dot - 1) % 2 == 0) {
            // Clear secondary OAM
            const oamToClear = (this.current_dot - 1) >> 1;
            this.secondaryOAM[oamToClear] = 0xFF;
            this.internal_oam_N = 0;
            this.internal_oam_M = -1;
            this.internal_secondaryOAM_sprite0 = -1;
            this.lastA12Value = 0;

        }
        else if (this.current_dot == 321) {
            // End of sprite evaluation
            this.internal_latched_secondaryOAM_sprite0 = this.internal_secondaryOAM_sprite0;
        }
        else if (this.current_dot >= 65 && this.current_dot <= 256) {
            // Sprite evaluation

            const is8x16 = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_SIZE) != 0;
            const yOffset = is8x16 ? 15 : 7;

            if (this.current_dot % 2 == 0) {
                // Write on even dots
                if (this.internal_oam_N < 64) {
                    const spriteY = this.OAM[this.internal_oam_N * 4];

                    if (this.internal_oam_M == -1) {
                        // Havent filled all slots
                        let secondaryOamIndex = -1;

                        for (let m1 = 0; m1 < 8; m1++) {
                            if (this.secondaryOAM[(m1 * 4)] == 0xFF) {
                                // Open slot
                                secondaryOamIndex = m1;
                                break;
                            }
                        }


                        if (secondaryOamIndex != -1) {
                            // Slot open
                            const isSpriteInRange = this.current_scanline >= spriteY && this.current_scanline <= spriteY + yOffset;

                            if (isSpriteInRange) {
                                // In range
                                this.secondaryOAM[secondaryOamIndex * 4] = this.OAM[this.internal_oam_N * 4];
                                this.secondaryOAM[(secondaryOamIndex * 4) + 1] = this.OAM[(this.internal_oam_N * 4) + 1];
                                this.secondaryOAM[(secondaryOamIndex * 4) + 2] = this.OAM[(this.internal_oam_N * 4) + 2];
                                this.secondaryOAM[(secondaryOamIndex * 4) + 3] = this.OAM[(this.internal_oam_N * 4) + 3];

                                if (this.internal_oam_N == 0) {
                                    this.internal_secondaryOAM_sprite0 = secondaryOamIndex;
                                }
                            }
                        }
                        else {
                            this.internal_oam_M = 0;
                            // No slots
                        }

                        this.internal_oam_N++;
                    }
                    else {
                        // No open slot
                        const spriteY = this.OAM[(this.internal_oam_N) * 4 + this.internal_oam_M];
                        const isSpriteInRange = spriteY >= this.current_scanline && spriteY <= this.current_scanline + yOffset;

                        if (isSpriteInRange) {
                            // Overflow
                            this.register_PPUSTATUS |= this.flags_PPUSTATUS_SPRITE_OVERFLOW;

                            for (let i = 0; i < 3; i++) {
                                this.internal_oam_M++;
                                if (this.internal_oam_M == 3) {
                                    this.internal_oam_M = 0;
                                    this.internal_oam_N++;
                                }
                            }
                        }
                        else {
                            this.internal_oam_M++; // reproduce sprite overflow bug
                            this.internal_oam_N++;
                        }
                    }
                }
            }
        }
    }


    loadSpriteTiles() {
        const spriteCycle = (this.current_dot - 1) % 8;
        const is8x16 = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_SIZE) != 0;

        if (spriteCycle == 4) {
            const spriteNumber = (this.current_dot - 257) >> 3;

            const y = this.secondaryOAM[spriteNumber * 4];
            let tile = this.secondaryOAM[spriteNumber * 4 + 1];
            const attribute = this.secondaryOAM[spriteNumber * 4 + 2];
            const x = this.secondaryOAM[spriteNumber * 4 + 3];

            if (y == 0xFF) {
                this.sprites_xPos[spriteNumber] = -1;
                this.onA12Updated(1);
                return;
            }

            let fineY = this.current_scanline - y;

            if ((attribute & 0x80) != 0) {
                fineY = (is8x16 ? 15 : 7) - fineY;
            }

            let bottomSprite = false;

            if (fineY > 7) {
                fineY -= 8;
                bottomSprite = true;
            }


            this.sprites_xPos[spriteNumber] = x;
            this.sprites_tiles_attributes[spriteNumber] = attribute;


            let patternTableNumber = 0;
            if (is8x16) {
                // 8x16 sprites
                patternTableNumber = tile & 0x01;
                tile &= ~(1);

                if (bottomSprite) {
                    tile += 1;
                }
            }
            else {
                patternTableNumber = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_PATTERN_TABLE_ADDRESS) != 0 ? 1 : 0;
            }

            const patternPatternTableAddress = patternTableNumber == 0 ? this.address_PATTERNTABLE_0 : this.address_PATTERNTABLE_1;


            //console.log(`spriteNumber ${spriteNumber} fineY ${fineY} yScroll ${this.yScroll()} y ${y} tile ${tile} patternTableNumber ${patternTableNumber} patternPatternTableAddress ${patternPatternTableAddress}`);

            const patternTableLowAddress = patternPatternTableAddress + (tile * 16) + fineY;
            this.sprites_tiles_low[spriteNumber] = this.nes.getCartridge().ppu_read(patternTableLowAddress);
            this.onA12Updated((patternTableLowAddress & 0x1000) >> 12);

            const patternTableHighAddress = patternPatternTableAddress + (tile * 16) + fineY + 8;
            this.sprites_tiles_high[spriteNumber] = this.nes.getCartridge().ppu_read(patternTableHighAddress);
            this.onA12Updated((patternTableHighAddress & 0x1000) >> 12);
        }
    }

    onA12Updated(value: number) {
        const oldValue = this.lastA12Value;
        //console.log(`onA12Updated ${value} oldValue ${oldValue} ${this.nes.cycles - this.lastA12Clock}`);

        if (oldValue == 0 && value == 1 && this.nes.cycles - this.lastA12Clock > 7) {
            this.nes.getCartridge().onA12Clock();
        }

        if (oldValue == 0 && value == 1) {
            this.lastA12Clock = this.nes.cycles;
        }

        this.lastA12Value = value;
    }
}