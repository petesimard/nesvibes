import { Instruction } from "./cpu_2A03";

// Interface for instruction metadata
export interface InstructionMetadata {
    name: string;
    mode: AddressingMode;
    cycles: number;
    instruction_length: number;
    instruction?: Instruction;
    noInitialCycleDelay?: boolean;
    checkForOopsCycle?: boolean;
}


export enum AddressingMode {
    Immediate,
    Relative,
    Indirect,
    ZeroPage,
    ZeroPageX,
    ZeroPageY,
    Absolute,
    AbsoluteX,
    AbsoluteY,
    IndirectX,
    IndirectY,
    Implied,
    Accumulator,
}

export const AddressingModeNames = {
    [AddressingMode.Immediate]: "Immediate",
    [AddressingMode.Relative]: "Relative",
    [AddressingMode.Indirect]: "Indirect",
    [AddressingMode.ZeroPage]: "ZeroPage",
    [AddressingMode.ZeroPageX]: "ZeroPageX",
    [AddressingMode.ZeroPageY]: "ZeroPageY",
    [AddressingMode.Absolute]: "Absolute",
    [AddressingMode.AbsoluteX]: "AbsoluteX",
    [AddressingMode.AbsoluteY]: "AbsoluteY",
    [AddressingMode.IndirectX]: "IndirectX",
    [AddressingMode.IndirectY]: "IndirectY",
    [AddressingMode.Implied]: "Implied",
    [AddressingMode.Accumulator]: "Accumulator",
}

// Complete instruction map for the 2A03/6502 CPU
export const instructionMap: InstructionMetadata[] = new Array(256).fill(null);

// Load/Store Operations
instructionMap[0xA9] = { name: 'LDA', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0xA5] = { name: 'LDA', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0xB5] = { name: 'LDA', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0xAD] = { name: 'LDA', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0xBD] = { name: 'LDA', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0xB9] = { name: 'LDA', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0xA1] = { name: 'LDA', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0xB1] = { name: 'LDA', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true };

instructionMap[0xA2] = { name: 'LDX', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0xA6] = { name: 'LDX', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0xB6] = { name: 'LDX', mode: AddressingMode.ZeroPageY, cycles: 4, instruction_length: 2 };
instructionMap[0xAE] = { name: 'LDX', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0xBE] = { name: 'LDX', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };

instructionMap[0xA0] = { name: 'LDY', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0xA4] = { name: 'LDY', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0xB4] = { name: 'LDY', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0xAC] = { name: 'LDY', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0xBC] = { name: 'LDY', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };

instructionMap[0x85] = { name: 'STA', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x95] = { name: 'STA', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0x8D] = { name: 'STA', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0x9D] = { name: 'STA', mode: AddressingMode.AbsoluteX, cycles: 5, instruction_length: 3 };
instructionMap[0x99] = { name: 'STA', mode: AddressingMode.AbsoluteY, cycles: 5, instruction_length: 3 };
instructionMap[0x81] = { name: 'STA', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0x91] = { name: 'STA', mode: AddressingMode.IndirectY, cycles: 6, instruction_length: 2 };

instructionMap[0x86] = { name: 'STX', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x96] = { name: 'STX', mode: AddressingMode.ZeroPageY, cycles: 4, instruction_length: 2 };
instructionMap[0x8E] = { name: 'STX', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };

instructionMap[0x84] = { name: 'STY', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x94] = { name: 'STY', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0x8C] = { name: 'STY', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };

// Register Transfers
instructionMap[0xAA] = { name: 'TAX', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xA8] = { name: 'TAY', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xBA] = { name: 'TSX', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x8A] = { name: 'TXA', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x9A] = { name: 'TXS', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x98] = { name: 'TYA', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };

// Stack Operations
instructionMap[0x48] = { name: 'PHA', mode: AddressingMode.Implied, cycles: 3, instruction_length: 1 };
instructionMap[0x08] = { name: 'PHP', mode: AddressingMode.Implied, cycles: 3, instruction_length: 1 };
instructionMap[0x68] = { name: 'PLA', mode: AddressingMode.Implied, cycles: 4, instruction_length: 1 };
instructionMap[0x28] = { name: 'PLP', mode: AddressingMode.Implied, cycles: 4, instruction_length: 1 };

// Logical Operations
instructionMap[0x29] = { name: 'AND', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0x25] = { name: 'AND', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x35] = { name: 'AND', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0x2D] = { name: 'AND', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0x3D] = { name: 'AND', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x39] = { name: 'AND', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x21] = { name: 'AND', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0x31] = { name: 'AND', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true };

instructionMap[0x49] = { name: 'EOR', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0x45] = { name: 'EOR', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x55] = { name: 'EOR', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0x4D] = { name: 'EOR', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0x5D] = { name: 'EOR', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x59] = { name: 'EOR', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x41] = { name: 'EOR', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0x51] = { name: 'EOR', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true };

instructionMap[0x09] = { name: 'ORA', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0x05] = { name: 'ORA', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x15] = { name: 'ORA', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0x0D] = { name: 'ORA', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0x1D] = { name: 'ORA', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x19] = { name: 'ORA', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x01] = { name: 'ORA', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0x11] = { name: 'ORA', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true };

instructionMap[0x24] = { name: 'BIT', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x2C] = { name: 'BIT', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };

// Arithmetic Operations
instructionMap[0x69] = { name: 'ADC', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0x65] = { name: 'ADC', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0x75] = { name: 'ADC', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0x6D] = { name: 'ADC', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0x7D] = { name: 'ADC', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x79] = { name: 'ADC', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0x61] = { name: 'ADC', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0x71] = { name: 'ADC', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true };

instructionMap[0xE9] = { name: 'SBC', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0xE5] = { name: 'SBC', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0xF5] = { name: 'SBC', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0xED] = { name: 'SBC', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0xFD] = { name: 'SBC', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0xF9] = { name: 'SBC', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0xE1] = { name: 'SBC', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0xF1] = { name: 'SBC', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true };

instructionMap[0xC9] = { name: 'CMP', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0xC5] = { name: 'CMP', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0xD5] = { name: 'CMP', mode: AddressingMode.ZeroPageX, cycles: 4, instruction_length: 2 };
instructionMap[0xCD] = { name: 'CMP', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };
instructionMap[0xDD] = { name: 'CMP', mode: AddressingMode.AbsoluteX, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0xD9] = { name: 'CMP', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true };
instructionMap[0xC1] = { name: 'CMP', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 };
instructionMap[0xD1] = { name: 'CMP', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true };

instructionMap[0xE0] = { name: 'CPX', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0xE4] = { name: 'CPX', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0xEC] = { name: 'CPX', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };

instructionMap[0xC0] = { name: 'CPY', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 };
instructionMap[0xC4] = { name: 'CPY', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 };
instructionMap[0xCC] = { name: 'CPY', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 };

// Increments & Decrements
instructionMap[0xE6] = { name: 'INC', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 };
instructionMap[0xF6] = { name: 'INC', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 };
instructionMap[0xEE] = { name: 'INC', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 };
instructionMap[0xFE] = { name: 'INC', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 };

instructionMap[0xE8] = { name: 'INX', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xC8] = { name: 'INY', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };

instructionMap[0xC6] = { name: 'DEC', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 };
instructionMap[0xD6] = { name: 'DEC', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 };
instructionMap[0xCE] = { name: 'DEC', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 };
instructionMap[0xDE] = { name: 'DEC', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 };

instructionMap[0xCA] = { name: 'DEX', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x88] = { name: 'DEY', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };

// Shifts & Rotates
instructionMap[0x0A] = { name: 'ASL', mode: AddressingMode.Accumulator, cycles: 2, instruction_length: 1 };
instructionMap[0x06] = { name: 'ASL', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 };
instructionMap[0x16] = { name: 'ASL', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 };
instructionMap[0x0E] = { name: 'ASL', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 };
instructionMap[0x1E] = { name: 'ASL', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 };

instructionMap[0x4A] = { name: 'LSR', mode: AddressingMode.Accumulator, cycles: 2, instruction_length: 1 };
instructionMap[0x46] = { name: 'LSR', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 };
instructionMap[0x56] = { name: 'LSR', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 };
instructionMap[0x4E] = { name: 'LSR', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 };
instructionMap[0x5E] = { name: 'LSR', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 };

instructionMap[0x2A] = { name: 'ROL', mode: AddressingMode.Accumulator, cycles: 2, instruction_length: 1 };
instructionMap[0x26] = { name: 'ROL', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 };
instructionMap[0x36] = { name: 'ROL', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 };
instructionMap[0x2E] = { name: 'ROL', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 };
instructionMap[0x3E] = { name: 'ROL', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 };

instructionMap[0x6A] = { name: 'ROR', mode: AddressingMode.Accumulator, cycles: 2, instruction_length: 1 };
instructionMap[0x66] = { name: 'ROR', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 };
instructionMap[0x76] = { name: 'ROR', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 };
instructionMap[0x6E] = { name: 'ROR', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 };
instructionMap[0x7E] = { name: 'ROR', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 };

// Jumps & Calls
instructionMap[0x4C] = { name: 'JMP', mode: AddressingMode.Absolute, cycles: 3, instruction_length: 3, noInitialCycleDelay: true };
instructionMap[0x6C] = { name: 'JMP', mode: AddressingMode.Indirect, cycles: 5, instruction_length: 3, noInitialCycleDelay: true };
instructionMap[0x20] = { name: 'JSR', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3, noInitialCycleDelay: true };
instructionMap[0x60] = { name: 'RTS', mode: AddressingMode.Implied, cycles: 6, instruction_length: 1 };

// Branches
instructionMap[0x90] = { name: 'BCC', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };
instructionMap[0xB0] = { name: 'BCS', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };
instructionMap[0xF0] = { name: 'BEQ', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };
instructionMap[0x30] = { name: 'BMI', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };
instructionMap[0xD0] = { name: 'BNE', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };
instructionMap[0x10] = { name: 'BPL', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };
instructionMap[0x50] = { name: 'BVC', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };
instructionMap[0x70] = { name: 'BVS', mode: AddressingMode.Relative, cycles: 2, instruction_length: 2 };

// Status Flag Changes
instructionMap[0x18] = { name: 'CLC', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xD8] = { name: 'CLD', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x58] = { name: 'CLI', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xB8] = { name: 'CLV', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x38] = { name: 'SEC', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xF8] = { name: 'SED', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x78] = { name: 'SEI', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };

// System Functions
instructionMap[0x00] = { name: 'BRK', mode: AddressingMode.Implied, cycles: 7, instruction_length: 1 };
instructionMap[0x40] = { name: 'RTI', mode: AddressingMode.Implied, cycles: 6, instruction_length: 1 };

instructionMap[0xEA] = { name: 'NOP', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x1A] = { name: 'NOP', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x3A] = { name: 'NOP', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x5A] = { name: 'NOP', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0x7A] = { name: 'NOP', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xDA] = { name: 'NOP', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };
instructionMap[0xFA] = { name: 'NOP', mode: AddressingMode.Implied, cycles: 2, instruction_length: 1 };

instructionMap[0x00] = { name: 'BRK', mode: AddressingMode.Implied, cycles: 7, instruction_length: 1 }; // Unofficial



instructionMap[0x04] = { name: '*NOP', mode: AddressingMode.Immediate, cycles: 3, instruction_length: 2 }; // Unofficial
instructionMap[0x44] = { name: '*NOP', mode: AddressingMode.Immediate, cycles: 3, instruction_length: 2 }; // Unofficial
instructionMap[0x64] = { name: '*NOP', mode: AddressingMode.Immediate, cycles: 3, instruction_length: 2 }; // Unofficial

instructionMap[0x14] = { name: '&NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 2 }; // Unofficial
instructionMap[0x34] = { name: '&NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 2 }; // Unofficial
instructionMap[0x54] = { name: '&NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 2 }; // Unofficial
instructionMap[0x74] = { name: '&NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 2 }; // Unofficial
instructionMap[0xD4] = { name: '&NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 2 }; // Unofficial
instructionMap[0xF4] = { name: '&NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 2 }; // Unofficial

instructionMap[0x0C] = { name: '!NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 3 }; // Unofficial

instructionMap[0x80] = { name: '+NOP', mode: AddressingMode.Immediate, cycles: 4, instruction_length: 3 }; // Unofficial

instructionMap[0x1C] = { name: '@NOP', mode: AddressingMode.AbsoluteX, cycles: 5, instruction_length: 3, checkForOopsCycle: true }; // Unofficial
instructionMap[0x3C] = { name: '@NOP', mode: AddressingMode.AbsoluteX, cycles: 5, instruction_length: 3, checkForOopsCycle: true }; // Unofficial
instructionMap[0x5C] = { name: '@NOP', mode: AddressingMode.AbsoluteX, cycles: 5, instruction_length: 3, checkForOopsCycle: true }; // Unofficial
instructionMap[0x7C] = { name: '@NOP', mode: AddressingMode.AbsoluteX, cycles: 5, instruction_length: 3, checkForOopsCycle: true }; // Unofficial
instructionMap[0xDC] = { name: '@NOP', mode: AddressingMode.AbsoluteX, cycles: 5, instruction_length: 3, checkForOopsCycle: true }; // Unofficial
instructionMap[0xFC] = { name: '@NOP', mode: AddressingMode.AbsoluteX, cycles: 5, instruction_length: 3, checkForOopsCycle: true }; // Unofficial

instructionMap[0xA7] = { name: '*LAX', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 }; // Unofficial
instructionMap[0xB7] = { name: '*LAX', mode: AddressingMode.ZeroPageY, cycles: 4, instruction_length: 2 }; // Unofficial
instructionMap[0xAF] = { name: '*LAX', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 }; // Unofficial
instructionMap[0xBF] = { name: '*LAX', mode: AddressingMode.AbsoluteY, cycles: 4, instruction_length: 3, checkForOopsCycle: true }; // Unofficial
instructionMap[0xA3] = { name: '*LAX', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 }; // Unofficial
instructionMap[0xB3] = { name: '*LAX', mode: AddressingMode.IndirectY, cycles: 5, instruction_length: 2, checkForOopsCycle: true }; // Unofficial

instructionMap[0x87] = { name: '*SAX', mode: AddressingMode.ZeroPage, cycles: 3, instruction_length: 2 }; // Unofficial
instructionMap[0x97] = { name: '*SAX', mode: AddressingMode.ZeroPageY, cycles: 4, instruction_length: 2 }; // Unofficial
instructionMap[0x8F] = { name: '*SAX', mode: AddressingMode.Absolute, cycles: 4, instruction_length: 3 }; // Unofficial
instructionMap[0x83] = { name: '*SAX', mode: AddressingMode.IndirectX, cycles: 6, instruction_length: 2 }; // Unofficial

instructionMap[0xEB] = { name: 'SBC', mode: AddressingMode.Immediate, cycles: 2, instruction_length: 2 }; // SBC

instructionMap[0xC7] = { name: 'DCP', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 }; // Unofficial
instructionMap[0xD7] = { name: 'DCP', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 }; // Unofficial
instructionMap[0xCF] = { name: 'DCP', mode: AddressingMode.Absolute, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0xDF] = { name: 'DCP', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0xDB] = { name: 'DCP', mode: AddressingMode.AbsoluteY, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0xC3] = { name: 'DCP', mode: AddressingMode.IndirectX, cycles: 8, instruction_length: 2 }; // Unofficial
instructionMap[0xD3] = { name: 'DCP', mode: AddressingMode.IndirectY, cycles: 8, instruction_length: 2 }; // Unofficial

instructionMap[0xE7] = { name: 'ISB', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 }; // Unofficial
instructionMap[0xF7] = { name: 'ISB', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 }; // Unofficial
instructionMap[0xEF] = { name: 'ISB', mode: AddressingMode.Absolute, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0xFF] = { name: 'ISB', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0xFB] = { name: 'ISB', mode: AddressingMode.AbsoluteY, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0xE3] = { name: 'ISB', mode: AddressingMode.IndirectX, cycles: 8, instruction_length: 2 }; // Unofficial
instructionMap[0xF3] = { name: 'ISB', mode: AddressingMode.IndirectY, cycles: 8, instruction_length: 2 }; // Unofficial

instructionMap[0x07] = { name: 'SLO', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 }; // Unofficial
instructionMap[0x17] = { name: 'SLO', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 }; // Unofficial
instructionMap[0x0F] = { name: 'SLO', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 }; // Unofficial
instructionMap[0x1F] = { name: 'SLO', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x1B] = { name: 'SLO', mode: AddressingMode.AbsoluteY, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x03] = { name: 'SLO', mode: AddressingMode.IndirectX, cycles: 8, instruction_length: 2 }; // Unofficial
instructionMap[0x13] = { name: 'SLO', mode: AddressingMode.IndirectY, cycles: 8, instruction_length: 2 }; // Unofficial

instructionMap[0x27] = { name: 'RLA', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 }; // Unofficial
instructionMap[0x37] = { name: 'RLA', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 }; // Unofficial
instructionMap[0x2F] = { name: 'RLA', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 }; // Unofficial
instructionMap[0x3F] = { name: 'RLA', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x3B] = { name: 'RLA', mode: AddressingMode.AbsoluteY, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x23] = { name: 'RLA', mode: AddressingMode.IndirectX, cycles: 8, instruction_length: 2 }; // Unofficial
instructionMap[0x33] = { name: 'RLA', mode: AddressingMode.IndirectY, cycles: 8, instruction_length: 2 }; // Unofficial

instructionMap[0x47] = { name: 'SRE', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 }; // Unofficial
instructionMap[0x57] = { name: 'SRE', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 }; // Unofficial
instructionMap[0x4F] = { name: 'SRE', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 }; // Unofficial
instructionMap[0x5F] = { name: 'SRE', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x5B] = { name: 'SRE', mode: AddressingMode.AbsoluteY, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x43] = { name: 'SRE', mode: AddressingMode.IndirectX, cycles: 8, instruction_length: 2 }; // Unofficial
instructionMap[0x53] = { name: 'SRE', mode: AddressingMode.IndirectY, cycles: 8, instruction_length: 2 }; // Unofficial

instructionMap[0x67] = { name: 'RRA', mode: AddressingMode.ZeroPage, cycles: 5, instruction_length: 2 }; // Unofficial
instructionMap[0x77] = { name: 'RRA', mode: AddressingMode.ZeroPageX, cycles: 6, instruction_length: 2 }; // Unofficial
instructionMap[0x6F] = { name: 'RRA', mode: AddressingMode.Absolute, cycles: 6, instruction_length: 3 }; // Unofficial
instructionMap[0x7F] = { name: 'RRA', mode: AddressingMode.AbsoluteX, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x7B] = { name: 'RRA', mode: AddressingMode.AbsoluteY, cycles: 7, instruction_length: 3 }; // Unofficial
instructionMap[0x63] = { name: 'RRA', mode: AddressingMode.IndirectX, cycles: 8, instruction_length: 2 }; // Unofficial
instructionMap[0x73] = { name: 'RRA', mode: AddressingMode.IndirectY, cycles: 8, instruction_length: 2 }; // Unofficial

export default instructionMap;
