export abstract class APUChannel {
    constructor() {

    }

    isEnabled: boolean = false;

    abstract clock(): void;
    abstract quarter_clock(): void;
    abstract half_clock(): void;
    abstract getOutput(): number;
    abstract reset(): void;
    abstract onWrite(address: number, value: number): void;
}