import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { Nes } from "./nes";

export class RAM implements BusDevice {
    private memory: Uint8Array = new Uint8Array(0);
    private nes: Nes;

    constructor(nes: Nes, size: number) {
        this.memory = new Uint8Array(size);
        this.nes = nes;
    }

    read(address: number): number {
        return this.memory[address];
    }

    write(address: number, value: number): void {
        if (value < 0 || value > 255) {
            throw new Error(`Invalid value ${value} at address ${address}`);
        }

        //console.log(`write(${numberToHex(address)},${numberToHex(value)})`);

        this.memory[address] = value;
    }
}