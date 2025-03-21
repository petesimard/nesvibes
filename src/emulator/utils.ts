export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function numberToHex(number: number): string {
    if (number == undefined)
        return 'UNDEFINED';

    return number.toString(16).padStart(2, '0').toUpperCase();
}

export function u8toSigned(value: number): number {
    return (value & 0x80) ? value - 256 : value;
}