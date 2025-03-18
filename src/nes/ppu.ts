import { BusDevice } from "../emulator/busdevice_interface";
import { Nes } from "./nes";

export class PPU implements BusDevice {
    private nes: Nes;

    register_PPUCTRL: number = 0;
    register_PPUMASK: number = 0;
    register_PPUSTATUS: number = 0;
    register_OAMADDR: number = 0;
    register_OAMDATA: number = 0;
    register_PPUSCROLL: number = 0;
    register_PPUADDR: number = 0;
    register_PPUDATA: number = 0;
    register_OAMDMA: number = 0;

    register_internal_V: number = 0;
    register_internal_T: number = 0;
    register_internal_X: number = 0;
    register_internal_W: number = 0;
    register_internal_isEvenFrame: boolean = false;
    register_internal_scanline: number = 0;
    register_internal_point: number = 0;

    register_address_PPUCTRL: number = 0x2000;
    register_address_PPUMASK: number = 0x2001;
    register_address_PPUSTATUS: number = 0x2002;
    register_address_OAMADDR: number = 0x2003;
    register_address_OAMDATA: number = 0x2004;
    register_address_PPUSCROLL: number = 0x2005;
    register_address_PPUADDR: number = 0x2006;
    register_address_PPUDATA: number = 0x2007;
    register_address_OAMDMA: number = 0x4014;

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
        this.register_OAMDATA = 0;
        this.register_PPUSCROLL = 0;
        this.register_PPUADDR = 0;
        this.register_PPUDATA = 0;
        this.register_OAMDMA = 0;
    }

    isInInitialReset(): boolean {
        return this.nes.cycles < 29658;
    }

    read(address: number): number {
        address = 0x2000 + (address & 0x0007);

        if (address == this.register_address_PPUCTRL) {
            //return this.register_PPUCTRL;
            throw new Error("PPUCTRL is not readable");
        }
        else if (address == this.register_address_PPUMASK) {
            //return this.register_PPUMASK;
            throw new Error("PPUMASK is not readable");
        }
        else if (address == this.register_address_PPUSTATUS) {
            return this.register_PPUSTATUS;
        }
        else if (address == this.register_address_OAMADDR) {
            //return this.register_OAMADDR;
            throw new Error("OAMADDR is not readable");
        }
        else if (address == this.register_address_OAMDATA) {
            return this.register_OAMDATA;
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

        if (address == this.register_address_PPUCTRL) {
            if (!this.isInInitialReset()) {
                this.register_PPUCTRL = value;
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
            this.register_OAMDATA = value;
        }
        else if (address == this.register_address_PPUSCROLL) {
            if (!this.isInInitialReset()) {
                this.register_PPUSCROLL = value;
            }
        }
        else if (address == this.register_address_PPUADDR) {
            if (!this.isInInitialReset()) {
                this.register_PPUADDR = value;
            }
        }
        else if (address == this.register_address_PPUDATA) {
            this.register_PPUDATA = value;
        }
        else if (address == this.register_address_OAMDMA) {
            this.register_OAMDMA = value;
        }
    }

    clock() {

        if (this.register_internal_scanline >= 241 && this.register_internal_scanline <= 260) {
            // VBlank

            if (this.register_internal_scanline == 241 && this.register_internal_point == 1) {
                this.nes.NMI();
            }
        }

        if (this.register_internal_scanline == 262) {
            this.register_internal_scanline = 0;
            this.register_internal_point = 0;
        }

        this.register_internal_point++;
        if (this.register_internal_point == 341) {
            this.register_internal_point = 0;
            this.register_internal_scanline++;
        }
    }

    onReset() {
        this.register_PPUCTRL = 0;
        this.register_PPUMASK = 0;
        //this.register_PPUSTATUS = 0;
        this.register_OAMDATA = 0;
        this.register_PPUSCROLL = 0;
        this.register_PPUDATA = 0;
        this.register_OAMDMA = 0;

        this.register_internal_scanline = 0;
        this.register_internal_point = 0;
    }
}