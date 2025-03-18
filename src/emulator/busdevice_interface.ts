export interface BusDevice {
    read(address: number): number;
    write(address: number, value: number): void;
}