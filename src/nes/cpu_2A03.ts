import { numberToHex, u8toSigned } from "../emulator/utils";
import { AddressingMode, AddressingModeNames, instructionMap, InstructionMetadata } from "./2A03_instruction_map";
import { Nes } from "./nes";

export type Instruction = Generator;
export type InstructionFunc = (mode: AddressingMode) => Instruction;

const DEBUG_BREAKPOINT_CYCLE: number | undefined = undefined;
//const DEBUG_BREAKPOINT_CYCLE: number | undefined = 2560;

export class InstructionResult {
    cycles: number = 0;
    instructionMetadata: InstructionMetadata | undefined = undefined;
    instructionBytes: number[] = [];
    register_PC: number = 0xFFFC;
    register_SP: number = 0xFD;
    register_X: number = 0x00;
    register_Y: number = 0x00;
    register_A: number = 0x00;
    status_flags: number = 0;
    target_address: number | undefined = undefined;
    target_address_memory: number | undefined = undefined;
    indirectOffsetBase: number | undefined = undefined;
    indirectOffset: number | undefined = undefined;
    ppu_scanline: number = 0;
    ppu_dot: number = 0;
}

export class Cpu2A03 {

    nes: Nes;

    cpuCycles: number = 0;

    register_PC: number = 0xFFFC;
    register_SP: number = 0xFD;
    register_X: number = 0x00;
    register_Y: number = 0x00;
    register_A: number = 0x00;
    register_OAMDMA: number | undefined = undefined;


    FLAG_CARRY: number = 1 << 0;
    FLAG_ZERO: number = 1 << 1;
    FLAG_INTERRUPT: number = 1 << 2;
    FLAG_DECIMAL: number = 1 << 3;
    FLAG_UNUSED: number = 1 << 4;
    FLAG_BREAK: number = 1 << 5;
    FLAG_OVERFLOW: number = 1 << 6;
    FLAG_NEGATIVE: number = 1 << 7;

    pendingNonMaskableInterruptFlag: boolean = false;

    STACK_START: number = 0x0100;

    status_flags: number = this.FLAG_INTERRUPT;
    instruction: Instruction | undefined = undefined;
    addressRegister: number = 0x00;
    instructionResult: InstructionResult = new InstructionResult();
    pendingInterruptDisableFlag: boolean | undefined = undefined;
    debug_break_on_next_instruction: boolean = false;

    constructor(nes: Nes) {
        this.nes = nes;
    }

    onReset() {
        this.status_flags = this.FLAG_INTERRUPT;
        this.addressRegister = 0x00;
        this.register_X = 0x00;
        this.register_Y = 0x00;
        this.register_SP = 0xFD;
        this.register_A = 0x00;
        this.register_PC = this.nes.read16(0xFFFC);
        this.instruction = undefined;
        this.cpuCycles = 0;
        this.register_OAMDMA = undefined;
        //this.register_PC = 0x6000;
        console.log(`Initial PC: ${numberToHex(this.register_PC)}`);
    }

    clock() {
        this.cpuCycles++;

        if (this.cpuCycles < 7) {
            return;
        }

        //console.log(`Clock Start PC: ${numberToHex(this.register_PC)}`);
        if (this.instruction != undefined) {
            this.processCurrentInstruction();
            return;
        }

        if (this.pendingInterruptDisableFlag != undefined) {
            this.toggleFlag(this.FLAG_INTERRUPT, this.pendingInterruptDisableFlag);
            this.pendingInterruptDisableFlag = undefined;
        }


        if (this.pendingNonMaskableInterruptFlag) {
            this.pendingNonMaskableInterruptFlag = false;
            this.instruction = this.ExecuteNMI();
            this.logInstruction(0x00);
        }
        else if (this.register_OAMDMA != undefined) {
            this.instruction = this.ExecuteOAMDMA();
            this.logInstruction(0x00);
        }
        else {

            const instructionOpCode = this.nes.read(this.register_PC);
            this.logInstruction(instructionOpCode);

            //console.log(`Instruction: ${numberToHex(instructionOpCode)}`);
            this.instruction = this.getInstructionFunc(instructionOpCode);
            this.toggleFlag(this.FLAG_BREAK, true);

            // Advance PC to next instruction
            this.advancePC();
        }

        this.processCurrentInstruction();
    }

    private processCurrentInstruction() {
        if (this.instruction == undefined) {
            throw new Error("Instruction is undefined");
        }

        const result = this.instruction.next();
        if (result.done) {
            this.instruction = undefined;

            this.nes.logInstruction(this.instructionResult);

            if (DEBUG_BREAKPOINT_CYCLE != undefined && this.instructionResult.cycles >= DEBUG_BREAKPOINT_CYCLE) {
                throw new Error("Breakpoint reached");
            }

            if (this.debug_break_on_next_instruction) {
                console.log(`Breakpoint reached from debug_break_on_next_instruction`);
                throw new Error("Breakpoint reached");
            }
        }
    }

    setOAMDMA(value: number) {
        this.register_OAMDMA = value;
        this.nes.log(`OAMDMA: ${numberToHex(value)}`);
    }

    private advancePC() {
        this.register_PC++;
    }

    public getCycles(): number {
        return this.cpuCycles;
    }

    public getPC(): number {
        return this.register_PC;
    }

    public getA(): number {
        return this.register_A;
    }

    public getX(): number {
        return this.register_X;
    }

    public getY(): number {
        return this.register_Y;
    }

    public getP(): number {
        return this.status_flags;
    }

    public getSP(): number {
        return this.register_SP;
    }


    private logInstruction(instructionOpCode: number) {

        const instructionData = instructionMap[instructionOpCode];
        if (!instructionData) {
            throw new Error(`Unknown instruction: ${numberToHex(instructionOpCode)}`);
        }

        this.instructionResult = new InstructionResult();
        this.instructionResult.instructionMetadata = instructionMap[instructionOpCode];
        this.instructionResult.cycles = this.cpuCycles;
        for (let i = 0; i < instructionData.instruction_length; i++) {
            this.instructionResult.instructionBytes.push(this.nes.read(this.register_PC + i));
        }

        this.instructionResult.register_PC = this.register_PC;
        this.instructionResult.register_SP = this.register_SP;
        this.instructionResult.register_X = this.register_X;
        this.instructionResult.register_Y = this.register_Y;
        this.instructionResult.register_A = this.register_A;
        this.instructionResult.status_flags = this.status_flags;
        this.instructionResult.ppu_scanline = this.nes.getPpu().current_scanline;
        this.instructionResult.ppu_dot = this.nes.getPpu().current_dot;
    }

    * ExecuteOAMDMA(): Instruction {
        yield;

        let baseAddress = this.register_OAMDMA! << 8;

        for (let i = 0; i < 256; i++) {
            const address = baseAddress + i;
            const value = this.nes.read(address);
            yield;
            this.nes.write(this.nes.getPpu().register_address_OAMDATA, value);
            yield;
        }

        this.register_OAMDMA = undefined;
    }


    * ExecuteNMI(): Instruction {
        const currentPC = this.register_PC;
        this.nes.log(`NMI Start: Saved PC: ${numberToHex(currentPC)}`);

        yield;
        yield;
        this.pushStack(currentPC >> 8);
        yield;
        this.pushStack(currentPC & 0xFF);
        yield;
        this.pushStack(this.status_flags & ~this.FLAG_BREAK);
        yield;
        this.register_PC = this.nes.read16(0xFFFA);
        this.toggleFlag(this.FLAG_INTERRUPT, true);
        yield;
        yield;

        this.nes.log(`NMI End: New PC: ${numberToHex(this.register_PC)}`);
    }

    // BRK - Break
    * processInstruction_BRK(): Instruction {
        this.pushStack16(this.register_PC + 2);
        this.pushStack(this.status_flags | this.FLAG_BREAK);
        this.register_PC = this.nes.read16(0xFFFE);

        this.toggleFlag(this.FLAG_INTERRUPT, true);
    }

    // RRA - Rotate Right and Accumulator
    * processInstruction_RRA(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);
        yield;

        this.nes.write(address!, value); // Read, modify, write back
        yield;

        const result = (value >> 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 << 7 : 0);
        this.nes.write(address!, result);

        var rorCarry = (value & 1) != 0;

        // ADC
        var adc_result = this.register_A + result + (rorCarry ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, adc_result > 0xFF);
        this.toggleFlag(this.FLAG_ZERO, (adc_result & 0xFF) == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, ((adc_result ^ this.register_A) & (adc_result ^ result) & 0x80) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (adc_result & (1 << 7)) != 0);

        this.register_A = adc_result & 0xFF;
    }


    // SRE - Shift Right and Logical OR
    * processInstruction_SRE(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);

        yield;
        this.nes.write(address!, value); // Read, modify, write back
        yield;

        const result = (value >> 1);
        this.nes.write(address!, result);

        this.register_A = this.register_A ^ result;

        this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }

    // RLA - Rotate Left and Logical AND
    * processInstruction_RLA(mode: AddressingMode): Instruction {
        let value = undefined;
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        value = this.nes.read(address!);
        yield;
        const newValue = ((value << 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 : 0)) & 0xFF;
        this.nes.write(address!, newValue);
        yield;

        const result = this.register_A & newValue;
        this.register_A = result & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }

    // SLO - Shift Left and Logical OR
    * processInstruction_SLO(mode: AddressingMode): Instruction {
        let value = undefined;
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        value = this.nes.read(address!);
        yield;
        const newValue = (value << 1) & 0xFF;
        this.nes.write(address!, newValue);
        yield;

        const result = this.register_A | newValue;
        this.register_A = result & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }


    // ISB - Increment Memory and Subtract
    * processInstruction_ISB(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);
        yield;
        value++;
        value = value & 0xFF;
        this.nes.write(address!, value);
        yield;

        var result = this.register_A + ~value + (this.status_flags & this.FLAG_CARRY ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, (~result < 0x00));
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, ((result ^ this.register_A) & (result ^ ~value) & 0x80) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);

        this.register_A = result & 0xFF;
    }


    // DCP - Decrement Memory and Compare
    * processInstruction_DCP(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);
        yield;
        value--;
        value = value & 0xFF;
        this.nes.write(address!, value);
        yield;

        const aValue = this.register_A - value;

        this.toggleFlag(this.FLAG_CARRY, ~aValue < 0);
        this.toggleFlag(this.FLAG_ZERO, aValue == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (aValue & (1 << 7)) != 0);
    }


    // SAX - Store Accumulator and Index X
    * processInstruction_SAX(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        const value = (this.register_A & this.register_X) & 0xFF;
        this.nes.write(address!, value);
    }

    // LAX - Load Accumulator and Index X
    * processInstruction_LAX(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_A = value;
        this.register_X = value;
    }

    // ROL - Rotate Left
    * processInstruction_ROL(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);

        if (mode != AddressingMode.Accumulator)
            yield;

        this.nes.write(address!, value); // Read, modify, write back

        if (mode != AddressingMode.Accumulator)
            yield;

        const result = ((value << 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 : 0)) & 0xFF;
        this.nes.write(address!, result);

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
    }

    // ROR - Rotate Right
    * processInstruction_ROR(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);

        if (mode != AddressingMode.Accumulator)
            yield;

        this.nes.write(address!, value); // Read, modify, write back

        if (mode != AddressingMode.Accumulator)
            yield;

        const result = (value >> 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 << 7 : 0);
        this.nes.write(address!, result);

        this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
    }


    // LSR - Logical Shift Right
    * processInstruction_LSR(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);

        if (mode != AddressingMode.Accumulator)
            yield;

        this.nes.write(address!, value); // Read, modify, write back

        if (mode != AddressingMode.Accumulator)
            yield;

        const result = (value >> 1);
        this.nes.write(address!, result);

        this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
    }


    // TAX - Transfer Accumulator to Index X
    * processInstruction_TAX(): Instruction {
        this.register_X = this.register_A;
        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
    }

    // TAY - Transfer Accumulator to Index Y
    * processInstruction_TAY(): Instruction {
        this.register_Y = this.register_A;
        this.toggleFlag(this.FLAG_ZERO, this.register_Y == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_Y & (1 << 7)) != 0);
    }

    // TXA - Transfer Index X to Accumulator
    * processInstruction_TXA(): Instruction {
        this.register_A = this.register_X;
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }

    // TYA - Transfer Index Y to Accumulator
    * processInstruction_TYA(): Instruction {
        this.register_A = this.register_Y;
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }

    // TSX - Transfer Stack Pointer to Index X
    * processInstruction_TSX(): Instruction {
        this.register_X = this.register_SP;
        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
    }

    // TXS - Transfer Index X to Stack Pointer
    * processInstruction_TXS(): Instruction {
        this.register_SP = this.register_X;
    }


    // DEC - Decrement Memory
    * processInstruction_DEC(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);
        yield;
        this.nes.write(address!, value); // Read, modify, write back
        yield;
        value = (value - 1) & 0xFF;
        this.nes.write(address!, value);

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);
    }

    // INX - Increment X Register
    * processInstruction_DEX(): Instruction {
        this.register_X = (this.register_X - 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
    }

    // INY - Increment Y Register
    * processInstruction_DEY(): Instruction {
        this.register_Y = (this.register_Y - 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_Y == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_Y & (1 << 7)) != 0);
    }

    // INC - Increment Memory
    * processInstruction_INC(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);
        yield;
        this.nes.write(address!, value); // Read, modify, write back
        yield;
        value = (value + 1) & 0xFF;
        this.nes.write(address!, value);

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);
    }

    // INX - Increment X Register
    * processInstruction_INX(): Instruction {
        this.register_X = (this.register_X + 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
    }

    // INY - Increment Y Register
    * processInstruction_INY(): Instruction {
        this.register_Y = (this.register_Y + 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_Y == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_Y & (1 << 7)) != 0);
    }


    // PHP - Push Processor Status
    * processInstruction_PHP(): Instruction {
        const flagsBytes = this.status_flags | this.FLAG_UNUSED | this.FLAG_BREAK;
        this.pushStack(flagsBytes);
        yield;
    }

    // PLP - Pull Processor Status
    * processInstruction_PLP(): Instruction {
        const newFlags = this.popStack();
        yield;
        this.toggleFlag(this.FLAG_CARRY, (newFlags & this.FLAG_CARRY) != 0);
        this.toggleFlag(this.FLAG_ZERO, (newFlags & this.FLAG_ZERO) != 0);
        this.toggleFlag(this.FLAG_DECIMAL, (newFlags & this.FLAG_DECIMAL) != 0);
        this.toggleFlag(this.FLAG_OVERFLOW, (newFlags & this.FLAG_OVERFLOW) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (newFlags & this.FLAG_NEGATIVE) != 0);
        yield;

        this.pendingInterruptDisableFlag = (newFlags & this.FLAG_INTERRUPT) != 0;
    }

    // PHA - Push Accumulator
    * processInstruction_PHA(): Instruction {
        this.pushStack(this.register_A);
        yield;
    }

    // PLA - Pull Accumulator
    * processInstruction_PLA(): Instruction {
        this.register_A = this.popStack();

        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        yield;
        yield;
    }


    // BCC - Branch if Carry Clear
    * processInstruction_BCC(mode: AddressingMode): Instruction {
        if (!(this.status_flags & this.FLAG_CARRY)) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // BCS - Branch if Carry Set
    * processInstruction_BCS(mode: AddressingMode): Instruction {
        if (this.status_flags & this.FLAG_CARRY) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // BEQ - Branch if Equal
    * processInstruction_BEQ(mode: AddressingMode): Instruction {
        if (this.status_flags & this.FLAG_ZERO) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // BNE - Branch if Not Equal
    * processInstruction_BNE(mode: AddressingMode): Instruction {
        if (!(this.status_flags & this.FLAG_ZERO)) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // BPL - Branch if Positive
    * processInstruction_BPL(mode: AddressingMode): Instruction {
        if (!(this.status_flags & this.FLAG_NEGATIVE)) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // BMI - Branch if Negative
    * processInstruction_BMI(mode: AddressingMode): Instruction {
        if (this.status_flags & this.FLAG_NEGATIVE) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // BVC - Branch if Overflow Clear
    * processInstruction_BVC(mode: AddressingMode): Instruction {
        if (!(this.status_flags & this.FLAG_OVERFLOW)) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // BVS - Branch if Overflow Set
    * processInstruction_BVS(mode: AddressingMode): Instruction {
        if (this.status_flags & this.FLAG_OVERFLOW) {
            yield* this.doJump(mode);
        }
        else {
            this.advancePC();
        }
    }

    // CMP - Compare
    * processInstruction_CMP(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }

            value = v;
        }

        const result = (this.register_A - value) & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, this.register_A >= value);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == value);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
    }

    // CPX - Compare X Register
    * processInstruction_CPX(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }

            value = v;
        }

        const result = this.register_X - value;

        this.toggleFlag(this.FLAG_CARRY, this.register_X >= value);
        this.toggleFlag(this.FLAG_ZERO, this.register_X == value);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
    }

    // CPY - Compare Y Register
    * processInstruction_CPY(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }

            value = v;
        }

        const result = this.register_Y - value;

        this.toggleFlag(this.FLAG_CARRY, this.register_Y >= value);
        this.toggleFlag(this.FLAG_ZERO, this.register_Y == value);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
    }


    private * doJump(mode: AddressingMode) {
        yield;
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        this.register_PC = address!;
    }

    // SEC - Set Carry Flag
    * processInstruction_SEC(): Instruction {
        this.toggleFlag(this.FLAG_CARRY, true);
    }

    // CLC - Clear Carry Flag
    * processInstruction_CLC(): Instruction {
        this.toggleFlag(this.FLAG_CARRY, false);
    }

    // CLD - Clear Decimal Flag
    * processInstruction_CLD(): Instruction {
        this.toggleFlag(this.FLAG_DECIMAL, false);
    }

    // CLI - Clear Interrupt Disable
    * processInstruction_CLI(): Instruction {
        this.toggleFlag(this.FLAG_INTERRUPT, false);
    }

    // SEI - Set Interrupt Disable
    * processInstruction_SEI(): Instruction {
        this.pendingInterruptDisableFlag = true;
    }

    // CLV - Clear Overflow Flag
    * processInstruction_CLV(): Instruction {
        this.toggleFlag(this.FLAG_OVERFLOW, false);
    }

    // SED - Set Decimal Flag
    * processInstruction_SED(): Instruction {
        this.toggleFlag(this.FLAG_DECIMAL, true);
    }


    // NOP - No Operation
    * processInstruction_NOP(extraCycles: number, extraReads: number): Instruction {
        for (let i = 0; i < extraReads; i++) {
            this.advancePC();
        }

        for (let i = 0; i < extraCycles; i++) {
            yield;
        }
    }

    * processInstruction_NOP_ReadAddress(mode: AddressingMode): Instruction {
        let addressGenerator = this.getAddressGenerator(mode);

        for (const address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }
    }

    // STX - Store X Register
    * processInstruction_STX(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        if (this.nes.isNormalAddress(address!)) {
            this.instructionResult.target_address_memory = this.nes.read(address!);
        }

        this.nes.write(address!, this.register_X);
    }

    // STY - Store Y Register
    * processInstruction_STY(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        if (this.nes.isNormalAddress(address!)) {
            this.instructionResult.target_address_memory = this.nes.read(address!);
        }
        this.nes.write(address!, this.register_Y);
    }

    // STA - Store Accumulator
    * processInstruction_STA(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        if (this.nes.isNormalAddress(address!)) {
            this.instructionResult.target_address_memory = this.nes.read(address!);
        }
        this.nes.write(address!, this.register_A);
    }

    // LDX - Load X Register
    * processInstruction_LDX(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_X = value;

        if (mode == AddressingMode.IndirectX || mode == AddressingMode.IndirectY) {
            this.instructionResult.target_address_memory = value;
        }
    }

    // LDY - Load Y Register
    * processInstruction_LDY(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_Y = value;
        if (mode == AddressingMode.IndirectX || mode == AddressingMode.IndirectY) {
            this.instructionResult.target_address_memory = value;
        }
    }

    // LDA - Load Accumulator
    * processInstruction_LDA(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_A = value;
        if (mode == AddressingMode.IndirectX || mode == AddressingMode.IndirectY) {
            this.instructionResult.target_address_memory = value;
        }
    }


    // JMP - Jump
    * processInstruction_JMP(mode: AddressingMode): Instruction {
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        this.register_PC = address!;
    }

    subCt: number = 0;

    // JSR - Jump to Subroutine
    * processInstruction_JSR(mode: AddressingMode): Instruction {
        this.pushStack16(this.register_PC + 1);
        //console.log(`JSR ${numberToHex(this.register_PC + 1)}`);
        yield* this.noop_loop(3);

        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        this.register_PC = address!;
        this.subCt++;
    }

    // RTS - Return from Subroutine
    * processInstruction_RTS(): Instruction {
        this.register_PC = this.popStack16() + 1;
        //console.log(`RTS ${numberToHex(this.register_PC)}`);
        yield* this.noop_loop(4);
    }

    // RTI - Return from Interrupt
    * processInstruction_RTI(): Instruction {
        this.status_flags = this.popStack();
        this.register_PC = this.popStack16();
        yield* this.noop_loop(4);

        if (this.nes.breakOnRti) {
            this.nes.togglePause();
        }
    }

    // ASL - Arithmetic Shift Left
    * processInstruction_ASL(mode: AddressingMode): Instruction {
        let value = undefined;
        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        value = this.nes.read(address!);

        if (mode != AddressingMode.Accumulator)
            yield;

        const newValue = (value << 1) & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, newValue == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (newValue & (1 << 7)) != 0);

        this.nes.write(address!, newValue);

        if (mode != AddressingMode.Accumulator)
            yield;
    }

    // AND - Logical AND
    * processInstruction_AND(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        this.register_A = this.register_A & value;

        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }

    // BIT - Test Bits
    * processInstruction_BIT(mode: AddressingMode): Instruction {

        let address = undefined;
        let addressGenerator = this.getAddressGenerator(mode);

        for (address of addressGenerator) {
            if (address == undefined) {
                yield;
            }
        }

        let value = this.nes.read(address!);


        const result = this.register_A & value;

        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, (value & (1 << 6)) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        if (this.nes.isNormalAddress(address!)) {
            this.instructionResult.target_address_memory = this.nes.read(address!);
        }
    }

    // ORA - Logical OR
    * processInstruction_ORA(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        this.register_A = this.register_A | value;

        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }

    // EOR - Logical Exclusive OR
    * processInstruction_EOR(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        this.register_A = this.register_A ^ value;

        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
    }

    // ADC - Add with Carry
    * processInstruction_ADC(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        var result = this.register_A + value + (this.status_flags & this.FLAG_CARRY ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, result > 0xFF);
        this.toggleFlag(this.FLAG_ZERO, (result & 0xFF) == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, ((result ^ this.register_A) & (result ^ value) & 0x80) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);

        this.register_A = result & 0xFF;
    }

    // SBC - Subtract with Carry
    * processInstruction_SBC(mode: AddressingMode): Instruction {
        let value!: number;
        for (const v of this.readValue(mode)) {
            if (v == undefined) {
                yield;
                continue;
            }
            value = v;
        }

        var result = this.register_A + ~value + (this.status_flags & this.FLAG_CARRY ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, (~result < 0x00));
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, ((result ^ this.register_A) & (result ^ ~value) & 0x80) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);

        this.register_A = result & 0xFF;
    }

    * readValue(mode: AddressingMode): Generator<number | undefined> {
        let value = undefined;

        switch (mode) {
            case AddressingMode.Immediate:
                value = this.nes.read(this.register_PC);
                this.instructionResult.target_address = value;
                this.advancePC();
                break;
            default:
                let addressGenerator = this.getAddressGenerator(mode);
                let address = undefined;

                for (address of addressGenerator) {
                    if (address == undefined) {
                        yield undefined;
                    }
                }

                if (address == undefined) {
                    throw new Error(`Address is undefined for mode: ${AddressingMode[mode]} with instruction ${this.instructionResult.instructionMetadata?.name}`);
                }

                value = this.nes.read(address!);
                break;
        }

        yield value;
    }


    private getAddressGenerator(mode: AddressingMode): Generator<number | undefined> {
        let addressGenerator = undefined;


        switch (mode) {
            case AddressingMode.ZeroPage:
                addressGenerator = this.getZeroPageAddress();
                break;
            case AddressingMode.ZeroPageX:
                addressGenerator = this.getZeroPageXAddress();
                break;
            case AddressingMode.ZeroPageY:
                addressGenerator = this.getZeroPageYAddress();
                break;
            case AddressingMode.Absolute:
                addressGenerator = this.getAbsoluteAddress();
                break;
            case AddressingMode.AbsoluteX:
                addressGenerator = this.getAbsoluteXAddress();
                break;
            case AddressingMode.AbsoluteY:
                addressGenerator = this.getAbsoluteYAddress();
                break;
            case AddressingMode.IndirectX:
                addressGenerator = this.getIndirectXAddress();
                break;
            case AddressingMode.IndirectY:
                addressGenerator = this.getIndirectYAddress();
                break;
            case AddressingMode.Relative:
                addressGenerator = this.getRelativeAddress();
                break;
            case AddressingMode.Accumulator:
                addressGenerator = this.getAccumulatorAddress();
                break;
            case AddressingMode.Indirect:
                addressGenerator = this.getIndirectAddress();
                break;
            default:
                throw new Error(`Unknown addressing mode: ${mode} with instruction ${this.instructionResult.instructionMetadata?.name}`);
        }

        const instructionResult = this.instructionResult;

        let addressGeneratorWrapper = function* () {
            let finalAddress = undefined;
            for (const address of addressGenerator) {
                finalAddress = address;
                yield address;
            }
            instructionResult.target_address = finalAddress!;
        }();

        return addressGeneratorWrapper;
    }

    * getAccumulatorAddress(): Generator<number | undefined> {
        yield this.nes.CPU_BUSADDRESS_REGISTER_A;
    }

    * getRelativeAddress(): Generator<number | undefined> {
        const arg = this.nes.read(this.register_PC);
        this.advancePC();

        let address = u8toSigned(arg);
        const final_address = this.register_PC + address;

        const pc_low_byte = this.register_PC & 0xFF;
        if (pc_low_byte + address > 0xFF || pc_low_byte + address < 0) {
            // Oops cycle
            yield undefined;
        }

        yield final_address;
    }

    * getIndirectYAddress(): Generator<number | undefined> {
        // Get the zero page address (arg) and store it in temp_register
        const arg = this.nes.read(this.register_PC);
        this.instructionResult.indirectOffsetBase = arg;
        this.advancePC();
        yield undefined;
        // Get the value at the zero page address + Y to get the high byte
        const lowByte = this.nes.read(arg);
        let address = lowByte;
        yield undefined;
        // Get the value at the zero page address + Y to get the high byte
        const highByte = this.nes.read((arg + 1) % 0x100);
        address |= highByte << 8;
        yield undefined;

        if (this.isStoreInstruction() || lowByte + this.register_Y > 0xFF) {
            // Oops cycle
            yield undefined;
        }

        const finalAddress = (address + this.register_Y) % 0x10000;

        this.instructionResult.indirectOffset = arg + this.register_Y;

        //console.log(`getIndirectYAddress (${numberToHex(arg)},Y) @ ${numberToHex(this.register_Y)} = ${numberToHex(finalAddress)} L:${numberToHex(lowByte)} H:${numberToHex(highByte)}`);

        yield finalAddress;
        //val =  PEEK(arg) + PEEK((arg + 1) % 256) * 256 + Y
    }

    * getIndirectXAddress(): Generator<number | undefined> {
        // Get the zero page address (arg) and store it in temp_register
        let arg = this.nes.read(this.register_PC);
        this.instructionResult.indirectOffsetBase = arg;
        this.advancePC();
        yield undefined;
        // Get the value at the zero page address + X to get the high byte
        const zeroPageAddress = (arg + this.register_X) % 0x100;
        let address = this.nes.read(zeroPageAddress);
        yield undefined;
        // Get the low byte
        const zeroPageAddress2 = (arg + this.register_X + 1) % 0x100;
        address |= this.nes.read(zeroPageAddress2) << 8;
        yield undefined;
        yield undefined;
        //console.log(`LDA (${numberToHex(arg)},X) @ ${numberToHex(this.register_X)} = ${numberToHex(address)} ZPA1: ${numberToHex(zeroPageAddress)} ZPA2: ${numberToHex(zeroPageAddress2)}`);
        yield address;
        //val = PEEK(  PEEK((arg + X) % 256) + PEEK( (arg + X + 1) % 256) * 256  )	

        this.instructionResult.indirectOffset = arg + this.register_X;
    }

    * getAbsoluteXAddress(): Generator<number | undefined> {
        const lowByte = this.nes.read(this.register_PC);
        this.advancePC();
        yield undefined;
        const highByte = this.nes.read(this.register_PC) << 8;
        this.advancePC();
        yield undefined;

        const address = highByte | lowByte;

        if (this.isStoreInstruction() || lowByte + this.register_X > 0xFF) {
            // Oops cycle
            yield undefined;
        }

        yield (address + this.register_X) % 0x10000;
    }

    * getAbsoluteYAddress(): Generator<number | undefined> {
        const lowByte = this.nes.read(this.register_PC);
        this.advancePC();
        yield undefined;
        const highByte = this.nes.read(this.register_PC) << 8;
        this.advancePC();
        yield undefined;

        const address = highByte | lowByte;

        if (this.isStoreInstruction() || lowByte + this.register_Y > 0xFF) {
            // Oops cycle
            yield undefined;
        }

        yield (address + this.register_Y) % 0x10000;
    }

    * getAbsoluteAddress(): Generator<number | undefined> {
        let address = this.nes.read(this.register_PC);
        this.advancePC();
        yield undefined;
        address |= this.nes.read(this.register_PC) << 8;
        yield undefined;
        this.advancePC();
        yield address;
    }

    * getZeroPageAddress(): Generator<number | undefined> {
        const address = this.nes.read(this.register_PC);
        this.advancePC();
        yield undefined;
        yield address;
    }

    * getZeroPageXAddress(): Generator<number | undefined> {
        const address = this.nes.read(this.register_PC);
        this.advancePC();
        yield undefined;
        yield undefined; // Yield extra cycle

        const finalAddress = (address + this.register_X) % 0x100;
        yield finalAddress;
    }

    * getZeroPageYAddress(): Generator<number | undefined> {
        const address = this.nes.read(this.register_PC);
        this.advancePC();
        yield undefined;
        yield undefined; // Yield extra cycle

        yield ((address + this.register_Y) % 0x100);
    }

    * getIndirectAddress(): Generator<number | undefined> {
        const lowByte = this.nes.read(this.register_PC);
        this.advancePC();
        yield undefined;
        const highByte = this.nes.read(this.register_PC);
        this.advancePC();
        let address = (highByte << 8) | lowByte;
        const finalAddressLow = this.nes.read(address);

        address = (highByte << 8) | ((lowByte + 1) % 0x100);
        const finalAddressHigh = this.nes.read(address);
        yield* this.noop_loop(3);

        const finalAddress = (finalAddressHigh << 8) | finalAddressLow;

        //console.log(`getIndirectAddress (${numberToHex(highByte)},${numberToHex(lowByte)}) = A: ${numberToHex(address)} F: ${numberToHex(finalAddress)}`);

        yield finalAddress;
    }


    toggleFlag(flag: number, value: boolean) {
        if (value) {
            this.status_flags |= flag;
        }
        else {
            this.status_flags &= ~flag;
        }
    }

    pushStack(value: number) {
        this.nes.write(this.STACK_START + this.register_SP, value);
        this.register_SP--;
    }

    pushStack16(value: number) {
        this.pushStack(value >> 8);
        this.pushStack(value & 0xFF);
    }

    popStack16(): number {
        const valueLow = this.popStack();
        const valueHigh = this.popStack();
        return (valueHigh << 8) | valueLow;
    }

    popStack(): number {
        this.register_SP++;
        const value = this.nes.read(this.STACK_START + this.register_SP);
        return value;
    }


    * noop_loop(count: number) {
        for (let i = 0; i < count; i++) {
            yield;
        }
    }

    isStoreInstruction(): boolean {
        return (this.instructionResult.instructionMetadata?.name.startsWith("ST") ||
            this.instructionResult.instructionMetadata?.name.startsWith("LS") ||
            this.instructionResult.instructionMetadata?.name.startsWith("RO") ||
            this.instructionResult.instructionMetadata?.name.startsWith("LO") ||
            this.instructionResult.instructionMetadata?.name == "INC" ||
            this.instructionResult.instructionMetadata?.name == "DEC" ||
            this.instructionResult.instructionMetadata?.name == "DCP" ||
            this.instructionResult.instructionMetadata?.name == "ISB" ||
            this.instructionResult.instructionMetadata?.name == "SLO" ||
            this.instructionResult.instructionMetadata?.name.startsWith("AS"))
            ?? false;
    }

    NMI() {
        this.pendingNonMaskableInterruptFlag = true;
        //console.log(`NMI triggered on ${numberToHex(this.register_PC)} Instruction: ${this.instructionResult.instructionMetadata?.name}`);
    }


    getInstructionFunc(instructionOpCode: number): Instruction {
        const instructionData = instructionMap[instructionOpCode];

        let instructionFunc: InstructionFunc | undefined = undefined;

        //console.log(`Processing instruction: ${instructionData.name} ${AddressingModeNames[instructionData.mode]}`);

        if (instructionData.instruction != undefined) {
            instructionFunc = instructionData.instruction;
        }
        else {

            switch (instructionData.name) {
                case "ADC":
                    instructionFunc = this.processInstruction_ADC;
                    break;
                case "SBC":
                    instructionFunc = this.processInstruction_SBC;
                    break;
                case "AND":
                    instructionFunc = this.processInstruction_AND;
                    break;
                case "BIT":
                    instructionFunc = this.processInstruction_BIT;
                    break;
                case "ORA":
                    instructionFunc = this.processInstruction_ORA;
                    break;
                case "EOR":
                    instructionFunc = this.processInstruction_EOR;
                    break;
                case "ASL":
                    instructionFunc = this.processInstruction_ASL;
                    break;
                case "JMP":
                    instructionFunc = this.processInstruction_JMP;
                    break;
                case "JSR":
                    instructionFunc = this.processInstruction_JSR;
                    break;
                case "RTS":
                    instructionFunc = this.processInstruction_RTS;
                    break;
                case "RTI":
                    instructionFunc = this.processInstruction_RTI;
                    break;
                case "LDX":
                    instructionFunc = this.processInstruction_LDX;
                    break;
                case "LDY":
                    instructionFunc = this.processInstruction_LDY;
                    break;
                case "LDA":
                    instructionFunc = this.processInstruction_LDA;
                    break;
                case "STX":
                    instructionFunc = this.processInstruction_STX;
                    break;
                case "STY":
                    instructionFunc = this.processInstruction_STY;
                    break;
                case "STA":
                    instructionFunc = this.processInstruction_STA;
                    break;
                case "NOP":
                    instructionFunc = () => this.processInstruction_NOP(0, 0);
                    break;
                case "*NOP":
                    instructionFunc = () => this.processInstruction_NOP(1, 1);
                    break;
                case "!NOP":
                    instructionFunc = () => this.processInstruction_NOP(2, 2);
                    break;
                case "&NOP":
                    instructionFunc = () => this.processInstruction_NOP(2, 1);
                    break;
                case "+NOP":
                    instructionFunc = () => this.processInstruction_NOP(0, 1);
                    break;
                case "@NOP":
                    instructionFunc = this.processInstruction_NOP_ReadAddress;
                    break;
                case "SEC":
                    instructionFunc = this.processInstruction_SEC;
                    break;
                case "CLC":
                    instructionFunc = this.processInstruction_CLC;
                    break;
                case "CLD":
                    instructionFunc = this.processInstruction_CLD;
                    break;
                case "SED":
                    instructionFunc = this.processInstruction_SED;
                    break;
                case "CLI":
                    instructionFunc = this.processInstruction_CLI;
                    break;
                case "SEI":
                    instructionFunc = this.processInstruction_SEI;
                    break;
                case "CLV":
                    instructionFunc = this.processInstruction_CLV;
                    break;
                case "BCC":
                    instructionFunc = this.processInstruction_BCC;
                    break;
                case "BCS":
                    instructionFunc = this.processInstruction_BCS;
                    break;
                case "BEQ":
                    instructionFunc = this.processInstruction_BEQ;
                    break;
                case "BNE":
                    instructionFunc = this.processInstruction_BNE;
                    break;
                case "BPL":
                    instructionFunc = this.processInstruction_BPL;
                    break;
                case "BMI":
                    instructionFunc = this.processInstruction_BMI;
                    break;
                case "BVC":
                    instructionFunc = this.processInstruction_BVC;
                    break;
                case "BVS":
                    instructionFunc = this.processInstruction_BVS;
                    break;
                case "CMP":
                    instructionFunc = this.processInstruction_CMP;
                    break;
                case "CPX":
                    instructionFunc = this.processInstruction_CPX;
                    break;
                case "CPY":
                    instructionFunc = this.processInstruction_CPY;
                    break;
                case "PHP":
                    instructionFunc = this.processInstruction_PHP;
                    break;
                case "PLP":
                    instructionFunc = this.processInstruction_PLP;
                    break;
                case "PLA":
                    instructionFunc = this.processInstruction_PLA;
                    break;
                case "PHA":
                    instructionFunc = this.processInstruction_PHA;
                    break;
                case "INC":
                    instructionFunc = this.processInstruction_INC;
                    break;
                case "INX":
                    instructionFunc = this.processInstruction_INX;
                    break;
                case "INY":
                    instructionFunc = this.processInstruction_INY;
                    break;
                case "DEC":
                    instructionFunc = this.processInstruction_DEC;
                    break;
                case "DEX":
                    instructionFunc = this.processInstruction_DEX;
                    break;
                case "DEY":
                    instructionFunc = this.processInstruction_DEY;
                    break;
                case "TAX":
                    instructionFunc = this.processInstruction_TAX;
                    break;
                case "TAY":
                    instructionFunc = this.processInstruction_TAY;
                    break;
                case "TXA":
                    instructionFunc = this.processInstruction_TXA;
                    break;
                case "TYA":
                    instructionFunc = this.processInstruction_TYA;
                    break;
                case "TSX":
                    instructionFunc = this.processInstruction_TSX;
                    break;
                case "TXS":
                    instructionFunc = this.processInstruction_TXS;
                    break;
                case "LSR":
                    instructionFunc = this.processInstruction_LSR;
                    break;
                case "ROL":
                    instructionFunc = this.processInstruction_ROL;
                    break;
                case "ROR":
                    instructionFunc = this.processInstruction_ROR;
                    break;
                case "*LAX":
                    instructionFunc = this.processInstruction_LAX;
                    break;
                case "*SAX":
                    instructionFunc = this.processInstruction_SAX;
                    break;
                case "DCP":
                    instructionFunc = this.processInstruction_DCP;
                    break;
                case "ISB":
                    instructionFunc = this.processInstruction_ISB;
                    break;
                case "SLO":
                    instructionFunc = this.processInstruction_SLO;
                    break;
                case "RLA":
                    instructionFunc = this.processInstruction_RLA;
                    break;
                case "SRE":
                    instructionFunc = this.processInstruction_SRE;
                    break;
                case "RRA":
                    instructionFunc = this.processInstruction_RRA;
                    break;
                case "BRK":
                    instructionFunc = this.processInstruction_BRK;
                    break;

                default:
                    throw new Error(`Unknown instruction: ${instructionData.name}`);
            }

            instructionData.instruction = instructionFunc;
        }

        if (instructionFunc == undefined) {
            throw new Error(`Unknown instruction: ${instructionData.name}`);
        }

        const instructionFunctionGenerator = instructionFunc.call(this, instructionData.mode);

        let instructionWrapper = function* () {
            // Jump function should execute immediately
            if (!(instructionData.name == "JMP" || instructionData.name == "JSR")) {
                yield;
            }

            yield* instructionFunctionGenerator;
        }();

        return instructionWrapper;
    }
}
