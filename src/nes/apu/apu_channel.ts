import { Nes } from "../nes";

export abstract class APUChannel {
    constructor(protected nes: Nes) {

    }

    isEnabled: boolean = false;

    abstract clock(): void;
    abstract quarter_clock(): void;
    abstract half_clock(): void;
    abstract getOutput(): number;
    abstract reset(): void;
    abstract onWrite(address: number, value: number): void;
}