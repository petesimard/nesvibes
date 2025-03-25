import { BusDevice } from "../emulator/busdevice_interface";
import { numberToHex } from "../emulator/utils";
import { Nes } from "./nes";

export class APU implements BusDevice {
    private nes: Nes;

    constructor(nes: Nes) {
        this.nes = nes;
    }

    clock() {

    }

    onReset() {

    }

    read(address: number): number {
        return 0;
    }

    write(address: number, value: number): void {
        //console.log(`APU write ${numberToHex(address)} = ${numberToHex(value)}`);

    }
}
