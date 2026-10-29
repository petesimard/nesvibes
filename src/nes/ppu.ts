import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { Nes } from "./nes";
import { NES_PALETTE } from "./palettes/palette";

// The PPU ignores writes to PPUCTRL/PPUMASK/PPUSCROLL/PPUADDR for this many CPU cycles after power/reset.
const PPU_WARMUP_CPU_CYCLES = 29658;

// MMC3 only counts a rising edge of PPU A12 after A12 has been low for a while
// (it counts M2 falling edges while A12 is low; ~3 CPU cycles). Expressed in PPU dots.
const A12_LOW_FILTER_DOTS = 10;

// Colour emphasis: each set emphasis bit attenuates the other colour channels.
const EMPHASIS_ATTENUATION = 0.75;

export class PPU implements BusDevice {

    private nes: Nes;

    private vram: Uint8Array = new Uint8Array(0x1000); // 4KB for nametables (2KB used unless four-screen)
    private OAM: Uint8Array = new Uint8Array(256); // 256 bytes for OAM
    private secondaryOAM: Uint8Array = new Uint8Array(32); // 32 bytes for secondary OAM
    private palette: Uint8Array = new Uint8Array(32);
    private colorBuffer: number[] = [0, 0, 0, 255];
    // RGB for every (emphasis bits, palette index) pair: index ((emphasis << 6) | colour) * 3
    private colorTable: Uint8Array = new Uint8Array(8 * 64 * 3);

    private sprites_tiles_low: Uint8Array = new Uint8Array(8);
    private sprites_tiles_high: Uint8Array = new Uint8Array(8);
    private sprites_tiles_attributes: Uint8Array = new Uint8Array(8);
    private sprites_xPos: Int16Array = new Int16Array(8).fill(-1);

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

    // PPU open bus: the last value driven onto the CPU<->PPU data bus (no decay emulated)
    ioLatch: number = 0;

    latched_tileLow: number = 0;
    latched_tileHigh: number = 0;
    latched_attributeTable: number = 0;

    // Sprite evaluation state (nesdev "Sprite evaluation")
    internal_oam_N: number = 0;
    internal_oam_M: number = 0;
    internal_secondaryOAM_count: number = 0;
    internal_oam_evalDone: boolean = false;
    internal_oam_copyWait: number = 0;
    internal_secondaryOAM_sprite0: number = -1;
    internal_latched_secondaryOAM_sprite0: number = -1;
    internal_spritePatternAddress: number = 0;

    // VBL/NMI race: $2002 read one dot before VBL is set suppresses the flag for that frame
    suppressVbl: boolean = false;

    // Monotonic PPU dot counter (used for A12 filtering)
    ppuCycle: number = 0;
    lastA12Value: number = 0; // Used for IRQ tracking in some mappers
    a12LastHighCycle: number = -1000;
    a12LowSinceCycle: number = -1000;
    a12HighIsStatic: boolean = false;

    constructor(nes: Nes) {
        this.nes = nes;
        this.buildColorTable();
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

    private buildColorTable() {
        for (let emphasis = 0; emphasis < 8; emphasis++) {
            for (let colour = 0; colour < 64; colour++) {
                const rgb = NES_PALETTE[colour];
                const base = ((emphasis << 6) | colour) * 3;
                for (let channel = 0; channel < 3; channel++) {
                    let value = rgb[channel];
                    // Emphasis bit 0 = red, 1 = green, 2 = blue (NTSC). Each set bit dims the other channels.
                    for (let bit = 0; bit < 3; bit++) {
                        if ((emphasis & (1 << bit)) != 0 && bit != channel) {
                            value *= EMPHASIS_ATTENUATION;
                        }
                    }
                    this.colorTable[base + channel] = Math.round(value);
                }
            }
        }
    }

    isInInitialReset(): boolean {
        // nes.cycles counts PPU dots (3 per CPU cycle)
        return this.nes.cycles < PPU_WARMUP_CPU_CYCLES * 3;
    }

    // Palette RAM index for a $3F00-$3FFF address ($3F10/$3F14/$3F18/$3F1C mirror $3F00/$3F04/$3F08/$3F0C)
    private paletteIndex(address: number): number {
        let index = address & 0x1F;
        if ((index & 0x13) == 0x10) {
            index &= 0x0F;
        }
        return index;
    }

    read_internal(address: number): number {
        address &= 0x3FFF;

        if (address <= 0x1FFF) {
            return this.nes.getCartridge().ppu_read(address);
        }
        else if (address < 0x3F00) {
            // $2000-$2FFF nametables, $3000-$3EFF mirrors $2000-$2EFF
            return this.vram[this.nametableAddressToVRAM(address)];
        }
        else {
            return this.palette[this.paletteIndex(address)];
        }
    }

    write_internal(address: number, value: number): void {
        address &= 0x3FFF;

        if (address <= 0x1FFF) {
            this.nes.getCartridge().ppu_write(address, value);
        }
        else if (address < 0x3F00) {
            // $2000-$2FFF nametables, $3000-$3EFF mirrors $2000-$2EFF
            this.vram[this.nametableAddressToVRAM(address)] = value;
        }
        else {
            // Palette RAM is 6 bits wide
            this.palette[this.paletteIndex(address)] = value & 0x3F;
        }
    }

    // True while the PPU is fetching (rendering enabled on a visible or the pre-render scanline)
    private isRenderingActive(): boolean {
        return this.isRenderingEnabled() && (this.current_scanline < 240 || this.current_scanline == 261);
    }

    read(address: number): number {
        const register = address & 0x0007;
        let result = this.ioLatch;

        switch (register) {
            case 2: { // PPUSTATUS
                if (this.current_scanline == 241) {
                    if (this.current_dot == 1) {
                        // Read one dot before VBL is set: reads clear and the flag/NMI never happen this frame
                        this.suppressVbl = true;
                    }
                    else if (this.current_dot == 2 || this.current_dot == 3) {
                        // Read on the dot VBL was set (or one later): reads set, but the NMI is suppressed
                        this.cancelVblankNmi();
                    }
                }

                // Low 5 bits are open bus
                result = (this.register_PPUSTATUS & 0xE0) | (this.ioLatch & 0x1F);

                // Clear VBLANK flag on read
                this.register_PPUSTATUS &= ~this.flags_PPUSTATUS_VBLANK;
                this.register_internal_W = 0;
                break;
            }
            case 4: { // OAMDATA
                if (this.current_scanline < 240 && this.current_dot >= 1 && this.current_dot <= 64 && this.isRenderingEnabled()) {
                    // Secondary OAM clear in progress: reads return $FF
                    result = 0xFF;
                }
                else {
                    result = this.OAM[this.register_OAMADDR];
                }
                break;
            }
            case 7: { // PPUDATA
                const vramAddress = this.register_internal_V & 0x3FFF;

                if (vramAddress >= 0x3F00) {
                    // Palette reads are immediate (upper 2 bits are open bus); the buffer gets the nametable byte "underneath"
                    result = (this.palette[this.paletteIndex(vramAddress)] & 0x3F) | (this.ioLatch & 0xC0);
                    this.ppuDataBuffer = this.read_internal(vramAddress & 0x2FFF);
                }
                else {
                    result = this.ppuDataBuffer;
                    this.ppuDataBuffer = this.read_internal(vramAddress);
                }

                this.incrementVAfterDataAccess();
                break;
            }
            default:
                // Write-only registers return the open bus latch
                return this.ioLatch;
        }

        this.ioLatch = result;
        return result;
    }

    write(address: number, value: number): void {
        const register = address & 0x0007;
        this.ioLatch = value;

        switch (register) {
            case 0: // PPUCTRL
                if (!this.isInInitialReset()) {
                    this.setPPUCTRL(value);
                }
                break;
            case 1: // PPUMASK
                if (!this.isInInitialReset()) {
                    this.register_PPUMASK = value;
                }
                break;
            case 2: // PPUSTATUS (read only)
                break;
            case 3: // OAMADDR
                this.register_OAMADDR = value;
                break;
            case 4: // OAMDATA (also used by OAM DMA)
                if ((this.register_OAMADDR & 0x3) == 2) {
                    // Attribute bits 2-4 are unimplemented
                    value &= 0xE3;
                }
                this.OAM[this.register_OAMADDR] = value;
                this.register_OAMADDR = (this.register_OAMADDR + 1) & 0xFF;
                break;
            case 5: // PPUSCROLL
                if (!this.isInInitialReset()) {
                    if (this.register_internal_W == 0) {
                        // First write - X scroll
                        this.register_internal_T = (this.register_internal_T & 0x7FE0) | (value >> 3); // Coarse X scroll (5 bits)
                        this.register_internal_X = (value & 0x07);
                    } else {
                        // Second write - Y scroll
                        //FGH..ABCDE.....
                        this.register_internal_T = (this.register_internal_T & 0x0FFF) | ((value & 0x07) << 12); // Fine Y scroll (3 bits)
                        this.register_internal_T = (this.register_internal_T & 0x7C1F) | ((value >> 3) << 5); // Coarse Y scroll (5 bits)
                    }
                    this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
                }
                break;
            case 6: // PPUADDR
                if (!this.isInInitialReset()) {
                    this.register_PPUADDR = value;
                    if (this.register_internal_W == 0) {
                        this.register_internal_T = (this.register_internal_T & 0xFF) | ((value & 0x3F) << 8); // bit 14 cleared
                    }
                    else {
                        this.register_internal_T = (this.register_internal_T & 0x7F00) | value;
                        this.register_internal_V = this.register_internal_T;

                        if (!this.isRenderingActive()) {
                            // Outside rendering the PPU address bus follows v (MMC3 sees A12 changes)
                            this.onA12Updated((this.register_internal_V >> 12) & 1, true);
                        }
                    }
                    this.register_internal_W = (this.register_internal_W == 1 ? 0 : 1);
                }
                break;
            case 7: // PPUDATA
                this.write_internal(this.register_internal_V, value);
                this.incrementVAfterDataAccess();
                break;
        }
    }

    // $2007 access: v += 1 or 32 normally; during rendering the PPU instead performs
    // a coarse X increment and a Y increment at the same time.
    private incrementVAfterDataAccess() {
        if (this.isRenderingActive()) {
            this.incrementCoarseX();
            this.incrementY();
        }
        else {
            const increment = (this.register_PPUCTRL & this.flags_PPUCTRL_VRAM_ADDRESS_INCREMENT) != 0 ? 32 : 1;
            this.register_internal_V = (this.register_internal_V + increment) & 0x7FFF;
            this.onA12Updated((this.register_internal_V >> 12) & 1, true);
        }
    }

    private isVisualScanline(): boolean {
        return (this.current_scanline >= 0 && this.current_scanline <= 239);
    }

    private isRenderingEnabled(): boolean {
        return (this.register_PPUMASK & (this.flags_PPUMASK_ENABLE_BACKGROUND | this.flags_PPUMASK_ENABLE_SPRITES)) != 0;
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
        else if ((oldValue & this.flags_PPUCTRL_NMI_ENABLE) != 0 && (value & this.flags_PPUCTRL_NMI_ENABLE) == 0) {
            if (this.current_scanline == 241 && (this.current_dot == 2 || this.current_dot == 3)) {
                // NMI disabled right as VBL was set: the NMI never reaches the CPU
                this.cancelVblankNmi();
            }
        }

        this.register_internal_T = (this.register_internal_T & 0x73FF) | ((value & 0x3) << 10);
    }

    // Withdraw the NMI raised at VBL start (CPU did not see a long enough NMI pulse).
    private cancelVblankNmi() {
        this.nes.getCpu().cancelNMI();
    }

    fetch_nametable(address: number): number {
        return this.vram[this.nametableAddressToVRAM(address)];
    }

    // Map a $2000-$3EFF address to an offset into the nametable VRAM
    private nametableAddressToVRAM(address: number) {
        const cartridge = this.nes.getCartridge();
        address = 0x2000 | (address & 0x0FFF);

        if (cartridge.header.fourScreen) {
            // Cartridge supplies the extra 2KB: four distinct nametables
            return address & 0x0FFF;
        }

        return (cartridge.mapNametableAddress(address) - 0x2000) & 0x0FFF;
    }

    clock() {
        this.ppuCycle++;
        const scanline = this.current_scanline;
        const dot = this.current_dot;
        const renderingEnabled = this.isRenderingEnabled();

        if (scanline <= 239) {
            // Visible scanlines
            if (renderingEnabled) {
                this.processSprites();
                this.renderScanline();

                if (dot >= 257 && dot <= 320) {
                    this.loadSpriteTiles();
                    //OAMADDR is set to 0 during each of ticks 257–320 (the sprite tile loading interval) of the pre-render and visible scanlines.
                    this.register_OAMADDR = 0;
                }
            }
            else if (dot >= 1 && dot <= 256) {
                this.renderDisabledPixel();
            }
            else if (dot == 257) {
                // No sprite fetches while rendering is disabled: nothing to draw on the next line
                this.sprites_xPos.fill(-1);
            }
        }
        else if (scanline == 241) {
            // VBlank
            if (dot == 1) {
                if (!this.suppressVbl) {
                    this.register_PPUSTATUS |= this.flags_PPUSTATUS_VBLANK;

                    if ((this.register_PPUCTRL & this.flags_PPUCTRL_NMI_ENABLE) != 0 && !this.isInInitialReset()) {
                        // Trigger NMI from VBlank
                        this.nes.NMI();
                    }
                }
                this.suppressVbl = false;
            }
        }
        else if (scanline == 261) {
            // Pre-render scanline
            this.preRenderScanlineHit = true;

            if (dot == 1) {
                // Clear status flags
                this.register_PPUSTATUS &= ~this.flags_PPUSTATUS_VBLANK & ~this.flags_PPUSTATUS_SPRITE_OVERFLOW & ~this.flags_PPUSTATUS_SPRITE_ZERO_HIT;
                this.internal_latched_secondaryOAM_sprite0 = -1;
            }

            if (renderingEnabled) {
                this.renderScanline();

                if (dot >= 257 && dot <= 320) {
                    // Sprite fetches still happen (A12 activity for MMC3) but no sprites appear on scanline 0
                    this.loadSpriteTiles();
                    //OAMADDR is set to 0 during each of ticks 257–320 (the sprite tile loading interval) of the pre-render and visible scanlines.
                    this.register_OAMADDR = 0;
                }

                if (dot >= 280 && dot <= 304) {
                    //If rendering is enabled, at the end of vblank, shortly after the horizontal bits are copied from t to v at dot 257, the PPU will repeatedly copy the vertical bits from t to v from dots 280 to 304, completing the full initialization of v from t:
                    this.register_internal_V = (this.register_internal_V & 0x41F) | (this.register_internal_T & 0x7BE0);
                }
            }
            else if (dot == 257) {
                this.sprites_xPos.fill(-1);
            }
        }

        // Advance dot
        this.current_dot++;

        // On odd frames with rendering enabled the pre-render line is one dot shorter (dot 340 is skipped)
        const skipLastDot = this.current_dot == 340 && this.current_scanline == 261 &&
            (this.frame_counter & 1) == 1 && this.isRenderingEnabled();

        if (this.current_dot == 341 || skipLastDot) {
            // End of scanline, move to next scanline
            this.current_dot = 0;
            this.current_scanline++;

            if (this.current_scanline == 262) {
                // End of frame
                this.current_scanline = 0;
                this.frame_counter++;
                this.nes.onFrameReady();
            }
        }
    }

    private incrementCoarseX() {
        if ((this.register_internal_V & 0x001F) == 31) { // if coarse X == 31
            this.register_internal_V &= ~0x001F          // coarse X = 0
            this.register_internal_V ^= 0x0400           // switch horizontal nametable
        } else {
            this.register_internal_V += 1                // increment coarse X
        }
    }

    // The effective Y scroll coordinate is incremented, which is a complex operation that will correctly skip the attribute table memory regions, and wrap to the next nametable appropriately
    private incrementY() {
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
    }

    // Only called while rendering is enabled
    renderScanline() {
        const dot = this.current_dot;

        if ((dot >= 1 && dot <= 256) || (dot >= 321 && dot <= 336)) {
            this.doMemoryFetches();
        }

        if (dot > 8 && (dot - 1) % 8 == 0) {
            // transfer tile to latched tile (aka shift register)
            this.latched_tileLow = ((this.latched_tileLow << 8) & 0xFF00) | this.register_internal_tileLow;
            this.latched_tileHigh = ((this.latched_tileHigh << 8) & 0xFF00) | this.register_internal_tileHigh;

            this.latched_attributeTable = ((this.latched_attributeTable << 2) & 0xC) | this.register_internal_attributetableEntry;
        }

        if (dot >= 1 && dot <= 256 && this.isVisualScanline()) {
            this.renderPixel();
        }

        if (((dot > 0 && dot <= 256) || dot >= 328) && (dot % 8) == 0) {
            this.incrementCoarseX();
        }

        if (dot == 256) {
            //If rendering is enabled, the PPU increments the vertical position in v.
            this.incrementY();
        }
        else if (dot == 257) {
            // PPU copies all bits related to horizontal position from t to v
            this.register_internal_V = (this.register_internal_V & 0x7BE0) | (this.register_internal_T & 0x41F);
        }
    }


    private doMemoryFetches() {
        const step = (this.current_dot - 1) & 7;

        if (step == 1) {
            // Nametable byte
            const tileAddress = 0x2000 | (this.register_internal_V & 0x0FFF);
            this.register_internal_nametableEntry = this.fetch_nametable(tileAddress);
        }
        else if (step == 3) {
            // Attribute table byte
            const atTableAddress = 0x23C0 | (this.register_internal_V & 0x0C00) | ((this.register_internal_V >> 4) & 0x38) | ((this.register_internal_V >> 2) & 0x07);
            const attributeByte = this.fetch_nametable(atTableAddress);

            //(v & 2) is the bit that decides horizontal quadrant.
            //(v & 64) is the bit that decides vertical quadrant.
            const horizontalQuadrant = (this.register_internal_V & 2) == 0 ? 0 : 1;
            const verticalQuadrant = (this.register_internal_V & 64) == 0 ? 0 : 1;

            const atrBitsIndex = (verticalQuadrant << 1) | horizontalQuadrant;

            const attributeBits = attributeByte >> (atrBitsIndex * 2);
            this.register_internal_attributetableEntry = attributeBits & 0x3;
        }
        else if (step == 5 || step == 7) {
            // Pattern table low (5) / high (7) byte
            const backgroundPatternTableAddress = (this.register_PPUCTRL & this.flags_PPUCTRL_BACKGROUND_PATTERN_TABLE_ADDRESS) ? this.address_PATTERNTABLE_1 : this.address_PATTERNTABLE_0;
            const fineY = (this.register_internal_V >> 12) & 0x7;

            const patternTableAddress = backgroundPatternTableAddress | (this.register_internal_nametableEntry << 4) | fineY | (step == 7 ? 8 : 0);
            const value = this.nes.getCartridge().ppu_read(patternTableAddress);
            if (step == 5) {
                this.register_internal_tileLow = value;
            }
            else {
                this.register_internal_tileHigh = value;
            }
            this.onA12Updated((patternTableAddress >> 12) & 1);
        }
    }

    renderPixel() {
        const x = this.current_dot - 1;
        const mask = this.register_PPUMASK;

        // Background
        const pixelX = (x & 7) + this.register_internal_X;

        const attributeBits = (pixelX & 0x8) == 0 ?
            this.latched_attributeTable >> 2 :
            this.latched_attributeTable & 0x3;

        const tile_lowBit = (this.latched_tileLow >> (15 - pixelX)) & 1;
        const tile_highBit = (this.latched_tileHigh >> (15 - pixelX)) & 1;
        const tile_patternBits = tile_lowBit | (tile_highBit << 1);

        let bgPixel = 0;
        if ((mask & this.flags_PPUMASK_ENABLE_BACKGROUND) != 0 && (x >= 8 || (mask & this.flags_PPUMASK_SHOW_BACKGROUND_IN_LEFT_8) != 0)) {
            bgPixel = tile_patternBits;
        }

        // Sprites: the first opaque sprite in OAM order wins, even if it is behind the background
        let spritePixel = 0;
        let sprite_attributes = 0;
        for (let i = 0; i < 8; i++) {
            const sprite_xPos = this.sprites_xPos[i];
            if (sprite_xPos < 0) {
                continue;
            }

            let spriteFineX = x - sprite_xPos;
            if (spriteFineX < 0 || spriteFineX > 7) {
                continue;
            }

            const attributes = this.sprites_tiles_attributes[i];
            if ((attributes & 0x40) != 0) {
                spriteFineX = 7 - spriteFineX;
            }
            const shift = 7 - spriteFineX;
            const bits = ((this.sprites_tiles_low[i] >> shift) & 1) | (((this.sprites_tiles_high[i] >> shift) & 1) << 1);

            if (bits == 0) {
                // Sprite pixel is transparent
                continue;
            }

            this.doSprite0Check(i, bits, tile_patternBits);
            spritePixel = bits;
            sprite_attributes = attributes;
            break;
        }

        if ((mask & this.flags_PPUMASK_ENABLE_SPRITES) == 0 || (x < 8 && (mask & this.flags_PPUMASK_SHOW_SPRITES_IN_LEFT_8) == 0)) {
            spritePixel = 0;
        }

        // Priority multiplexer
        let paletteIndex = 0;
        if (spritePixel != 0 && (bgPixel == 0 || (sprite_attributes & 0x20) == 0)) {
            paletteIndex = 0x10 | ((sprite_attributes & 0x3) << 2) | spritePixel;
        }
        else if (bgPixel != 0) {
            paletteIndex = (attributeBits << 2) | bgPixel;
        }

        this.outputPixel(this.palette[paletteIndex]);
    }

    // Write one pixel to the frame buffer. The position comes from the current
    // scanline/dot so output stays aligned even when rendering is toggled mid-frame.
    private outputPixel(colour: number) {
        const row = this.current_scanline - (this.nes.overscan ? 8 : 0);
        if (row < 0 || row >= (this.nes.overscan ? 224 : 240)) {
            return;
        }

        const mask = this.register_PPUMASK;
        if ((mask & this.flags_PPUMASK_GREYSCALE) != 0) {
            colour &= 0x30;
        }
        const colorIndex = ((((mask >> 5) & 0x7) << 6) | (colour & 0x3F)) * 3;

        const index = (row * 256 + (this.current_dot - 1)) * 4;
        const output = this.nes.outputBuffer;
        output[index] = this.colorTable[colorIndex];
        output[index + 1] = this.colorTable[colorIndex + 1];
        output[index + 2] = this.colorTable[colorIndex + 2];
    }

    // With rendering disabled the PPU outputs the backdrop color, or the palette
    // entry v points at if v is inside palette RAM ($3F00-$3FFF).
    private renderDisabledPixel() {
        const v = this.register_internal_V & 0x3FFF;
        const paletteAddress = v >= 0x3F00 ? v : 0x3F00;
        this.outputPixel(this.palette[this.paletteIndex(paletteAddress)]);
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

        const color = NES_PALETTE[patternIndex & 0x3F];
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
        this.suppressVbl = false;
        this.register_internal_W = 0;
        this.internal_secondaryOAM_count = 0;
        this.sprites_xPos.fill(-1);

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

    // Sprite evaluation for the next scanline (only called while rendering is enabled on visible scanlines)
    processSprites() {
        const dot = this.current_dot;

        if (dot >= 1 && dot <= 64) {
            // Clear secondary OAM (one byte every 2 dots)
            if ((dot & 1) == 1) {
                this.secondaryOAM[(dot - 1) >> 1] = 0xFF;
            }
        }
        else if (dot >= 65 && dot <= 256) {
            if (dot == 65) {
                this.internal_oam_N = 0;
                this.internal_oam_M = 0;
                this.internal_secondaryOAM_count = 0;
                this.internal_oam_evalDone = false;
                this.internal_oam_copyWait = 0;
                this.internal_secondaryOAM_sprite0 = -1;
            }
            else if ((dot & 1) == 0) {
                // One read/write step every 2 dots
                this.evaluateSpriteStep();
            }
        }
        else if (dot == 321) {
            // End of sprite evaluation
            this.internal_latched_secondaryOAM_sprite0 = this.internal_secondaryOAM_sprite0;
        }
    }

    private evaluateSpriteStep() {
        if (this.internal_oam_evalDone) {
            return;
        }

        if (this.internal_oam_copyWait > 0) {
            // Copying the remaining 3 bytes of an in-range sprite takes 6 more dots
            this.internal_oam_copyWait--;
            return;
        }

        const height = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_SIZE) != 0 ? 16 : 8;

        if (this.internal_secondaryOAM_count < 8) {
            const base = this.internal_oam_N * 4;
            const row = this.current_scanline - this.OAM[base];

            if (row >= 0 && row < height) {
                const slot = this.internal_secondaryOAM_count * 4;
                this.secondaryOAM[slot] = this.OAM[base];
                this.secondaryOAM[slot + 1] = this.OAM[base + 1];
                this.secondaryOAM[slot + 2] = this.OAM[base + 2];
                this.secondaryOAM[slot + 3] = this.OAM[base + 3];

                if (this.internal_oam_N == 0) {
                    this.internal_secondaryOAM_sprite0 = this.internal_secondaryOAM_count;
                }

                this.internal_secondaryOAM_count++;
                this.internal_oam_copyWait = 3;
            }

            this.internal_oam_N = (this.internal_oam_N + 1) & 63;
            if (this.internal_oam_N == 0) {
                this.internal_oam_evalDone = true;
            }
        }
        else {
            // 8 sprites found: look for overflow, with the hardware bug of also incrementing m
            const y = this.OAM[this.internal_oam_N * 4 + this.internal_oam_M];
            const row = this.current_scanline - y;

            if (row >= 0 && row < height) {
                this.register_PPUSTATUS |= this.flags_PPUSTATUS_SPRITE_OVERFLOW;
                // The PPU then reads the next 3 OAM bytes and stops evaluating
                this.internal_oam_evalDone = true;
            }
            else {
                this.internal_oam_N = (this.internal_oam_N + 1) & 63;
                this.internal_oam_M = (this.internal_oam_M + 1) & 3;
                if (this.internal_oam_N == 0) {
                    this.internal_oam_evalDone = true;
                }
            }
        }
    }

    // Sprite pattern fetches for dots 257-320 (8 slots x 8 dots). Low byte at dot 5, high byte at dot 7
    // of each slot. Empty slots fetch tile $FF. On the pre-render line the fetches happen (MMC3 sees A12)
    // but no sprites are loaded for scanline 0.
    loadSpriteTiles() {
        const offset = this.current_dot - 257;
        const step = offset & 7;

        if (step != 4 && step != 6) {
            return;
        }

        const slot = offset >> 3;

        if (step == 4) {
            const is8x16 = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_SIZE) != 0;
            const base = slot * 4;
            const y = this.secondaryOAM[base];
            const tile = this.secondaryOAM[base + 1];
            const attribute = this.secondaryOAM[base + 2];
            const x = this.secondaryOAM[base + 3];

            let fineY = (this.current_scanline - y) & (is8x16 ? 15 : 7);

            if ((attribute & 0x80) != 0) {
                fineY = (is8x16 ? 15 : 7) - fineY;
            }

            let address: number;
            if (is8x16) {
                // 8x16 sprites: bit 0 of the tile selects the pattern table
                let tileIndex = tile & 0xFE;
                if (fineY > 7) {
                    tileIndex++;
                    fineY -= 8;
                }
                address = ((tile & 1) << 12) | (tileIndex << 4) | fineY;
            }
            else {
                const patternTable = (this.register_PPUCTRL & this.flags_PPUCTRL_SPRITE_PATTERN_TABLE_ADDRESS) != 0 ? 0x1000 : 0x0000;
                address = patternTable | (tile << 4) | fineY;
            }
            address &= 0x1FFF;

            this.internal_spritePatternAddress = address;
            const low = this.nes.getCartridge().ppu_read(address);
            this.onA12Updated((address >> 12) & 1);

            if (slot < this.internal_secondaryOAM_count && this.current_scanline != 261) {
                this.sprites_xPos[slot] = x;
                this.sprites_tiles_attributes[slot] = attribute;
                this.sprites_tiles_low[slot] = low;
            }
            else {
                this.sprites_xPos[slot] = -1;
            }
        }
        else {
            const address = this.internal_spritePatternAddress | 8;
            this.sprites_tiles_high[slot] = this.nes.getCartridge().ppu_read(address);
            this.onA12Updated((address >> 12) & 1);
        }
    }

    // Track PPU address line A12 for MMC3-style scanline counters. A rising edge only clocks the
    // mapper when A12 has been low for long enough (MMC3's M2-based filter).
    // isStatic: A12 set by $2006/$2007 (bus stays there) rather than a short rendering fetch.
    onA12Updated(value: number, isStatic: boolean = false) {
        if (value) {
            if (this.lastA12Value == 0 && this.ppuCycle - this.a12LowSinceCycle >= A12_LOW_FILTER_DOTS) {
                this.nes.getCartridge().onA12Clock();
            }
            this.a12LastHighCycle = this.ppuCycle;
            this.a12HighIsStatic = isStatic;
        }
        else if (this.lastA12Value != 0) {
            // A pattern fetch only holds A12 high for ~2 dots, then nametable fetches drive it low
            this.a12LowSinceCycle = this.a12HighIsStatic ? this.ppuCycle : Math.min(this.ppuCycle, this.a12LastHighCycle + 2);
        }

        this.lastA12Value = value;
    }
}
