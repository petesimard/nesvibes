import { BusDevice } from "../emulator/busdevice_interface";
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
        this.memory[address] = value & 0xFF;
    }
}