import { numberToHex, u8toSigned } from "../emulator/utils";
import { AddressingMode, AddressingModeNames, instructionMap, InstructionMetadata } from "./2A03_instruction_map";
import { Nes } from "./nes";

export type Instruction = () => boolean;
export type AddressFunction = () => boolean;

const DEBUG_BREAKPOINT_CYCLE: number | undefined = undefined;
//const DEBUG_BREAKPOINT_CYCLE: number | undefined = 2560;

const LOG_INSTRUCTIONS: boolean = true;

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
    target_address_value: number | undefined = undefined;
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
    oamDataCount: number = 0;


    FLAG_CARRY: number = 1 << 0;
    FLAG_ZERO: number = 1 << 1;
    FLAG_INTERRUPT: number = 1 << 2;
    FLAG_DECIMAL: number = 1 << 3;
    FLAG_UNUSED: number = 1 << 4;
    FLAG_BREAK: number = 1 << 5;
    FLAG_OVERFLOW: number = 1 << 6;
    FLAG_NEGATIVE: number = 1 << 7;

    pendingNonMaskableInterruptFlag: boolean = false;
    pendingIRQFlag: boolean = false;

    STACK_START: number = 0x0100;

    status_flags: number = this.FLAG_INTERRUPT;
    current_instruction: Instruction | undefined = undefined;
    currentInstructionCycle: number = 0;
    currentInstructionAddressingMode: AddressingMode = AddressingMode.Implied;
    currentInstructionAddress: number | undefined = undefined;
    addressRegister: number = 0x00;
    instructionResult: InstructionResult = new InstructionResult();
    pendingInterruptDisableFlag: boolean | undefined = undefined;
    debug_break_on_next_instruction: boolean = false;
    currentInstructionAddressFunction: AddressFunction | undefined = undefined;
    tempAddressArg: number = 0x00;
    hasOopsCycles: boolean = false;

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
        this.current_instruction = undefined;
        this.cpuCycles = 0;
        this.hasOopsCycles = false;
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
        if (this.current_instruction != undefined) {
            this.processCurrentInstruction();
            return;
        }

        if (this.pendingInterruptDisableFlag != undefined) {
            this.toggleFlag(this.FLAG_INTERRUPT, this.pendingInterruptDisableFlag);
            this.pendingInterruptDisableFlag = undefined;
        }


        if (this.pendingNonMaskableInterruptFlag) {
            this.pendingNonMaskableInterruptFlag = false;
            this.pendingIRQFlag = false;
            this.currentInstructionAddressingMode = AddressingMode.Implied;
            this.setInstruction(this.ExecuteNMI);
        }
        else if (this.register_OAMDMA != undefined) {
            this.currentInstructionAddressingMode = AddressingMode.Implied;
            this.setInstruction(this.ExecuteOAMDMA);
        }
        else if (this.pendingIRQFlag) {
            this.pendingIRQFlag = false;
            this.currentInstructionAddressingMode = AddressingMode.Implied;
            this.setInstruction(this.execute_IRQ);
        }
        else {

            const instructionOpCode = this.nes.read(this.register_PC);
            this.logInstruction(instructionOpCode);

            //console.log(`Instruction: ${numberToHex(instructionOpCode)}`);
            const newInstruction = this.getInstructionFunc(instructionOpCode);
            this.setInstruction(newInstruction);
            this.toggleFlag(this.FLAG_BREAK, true);
            // Advance PC to next instruction
            this.advancePC();
        }

        this.processCurrentInstruction();
    }

    private setInstruction(instruction: Instruction) {
        this.currentInstructionCycle = -1;
        this.currentInstructionAddress = undefined;
        this.hasOopsCycles = false;
        this.current_instruction = instruction;
    }

    private processCurrentInstruction() {
        if (this.current_instruction == undefined) {
            throw new Error("Instruction is undefined");
        }

        const result = this.current_instruction.call(this);

        if (result) {
            this.current_instruction = undefined;

            if (LOG_INSTRUCTIONS) {
                this.nes.logInstruction(this.instructionResult);
            }

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
        this.register_OAMDMA = value << 8;
        this.oamDataCount = 0;
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
        if (!LOG_INSTRUCTIONS) {
            return;
        }

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


    ExecuteOAMDMA(): boolean {
        if (this.currentInstructionCycle < 2 || this.currentInstructionCycle % 2 != 0) {
            return false;
        }

        let baseAddress = this.register_OAMDMA!;

        const address = baseAddress + this.oamDataCount;
        const value = this.nes.read(address);
        this.nes.write(this.nes.getPpu().register_address_OAMDATA, value);

        if (this.oamDataCount < 255) {
            this.oamDataCount++;
            return false;
        }

        this.register_OAMDMA = undefined;
        return true;
    }

    ExecuteNMI(): boolean {
        const currentPC = this.register_PC;

        if (this.currentInstructionCycle <= 1)
            return false;


        if (this.currentInstructionCycle == 2) {
            this.pushStack(currentPC >> 8);
            return false;
        }


        if (this.currentInstructionCycle == 3) {
            this.pushStack(currentPC & 0xFF);
            return false;
        }


        if (this.currentInstructionCycle == 4) {
            this.pushStack(this.status_flags & ~this.FLAG_BREAK);
            return false;
        }

        if (this.currentInstructionCycle == 5) {
            this.register_PC = this.nes.read16(0xFFFA);
            this.toggleFlag(this.FLAG_INTERRUPT, true);
        }

        if (this.currentInstructionCycle <= 6)
            return false;

        return true;
    }

    // BRK - Break
    processInstruction_BRK(): boolean {
        this.pushStack16(this.register_PC + 2);
        //console.log(`BRK ${numberToHex(this.register_PC + 2)} ${numberToHex(this.status_flags)}`);

        this.pushStack(this.status_flags | this.FLAG_BREAK);
        this.register_PC = this.nes.read16(0xFFFE);

        this.toggleFlag(this.FLAG_INTERRUPT, true);
        return true;
    }

    // IRQ - Interrupt Request
    execute_IRQ(): boolean {
        if (this.currentInstructionCycle == 0) {
            const currentPC = this.register_PC;
            this.toggleFlag(this.FLAG_INTERRUPT, true);
            this.pushStack16(currentPC);
        }

        if (this.currentInstructionCycle <= 3)
            return false;


        if (this.currentInstructionCycle == 4) {
            this.pushStack(this.status_flags & ~this.FLAG_BREAK);
            return false;
        }

        if (this.currentInstructionCycle == 5) {
            this.register_PC = this.nes.read16(0xFFFE);
        }

        if (this.currentInstructionCycle <= 6)
            return false;

        return true;
    }

    // RRA - Rotate Right and Accumulator
    processInstruction_RRA(): boolean {
        if (this.currentInstructionCycle <= 1)
            return false;

        let address = this.currentInstructionAddress;
        let value = this.nes.read(address!);

        this.nes.write(address!, value); // Read, modify, write back

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
        return true;
    }

    // SRE - Shift Right and Logical OR
    processInstruction_SRE(): boolean {
        if (this.currentInstructionCycle <= 1)
            return false;

        let address = this.currentInstructionAddress;
        let value = this.nes.read(address!);


        this.nes.write(address!, value); // Read, modify, write back

        const result = (value >> 1);
        this.nes.write(address!, result);

        this.register_A = this.register_A ^ result;

        this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // RLA - Rotate Left and Logical AND
    processInstruction_RLA(): boolean {
        if (this.currentInstructionCycle <= 1)
            return false;

        let address = this.currentInstructionAddress;
        const value = this.nes.read(address!);

        const newValue = ((value << 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 : 0)) & 0xFF;
        this.nes.write(address!, newValue);

        const result = this.register_A & newValue;
        this.register_A = result & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // SLO - Shift Left and Logical OR
    processInstruction_SLO(): boolean {
        if (this.currentInstructionCycle <= 1)
            return false;

        let address = this.currentInstructionAddress;
        const value = this.nes.read(address!);
        const newValue = (value << 1) & 0xFF;
        this.nes.write(address!, newValue);

        const result = this.register_A | newValue;
        this.register_A = result & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // ISB - Increment Memory and Subtract
    processInstruction_ISB(): boolean {
        if (this.currentInstructionCycle <= 1)
            return false;

        let address = this.currentInstructionAddress;

        let value = this.nes.read(address!);

        value++;
        value = value & 0xFF;
        this.nes.write(address!, value);

        var result = this.register_A + ~value + (this.status_flags & this.FLAG_CARRY ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, (~result < 0x00));
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, ((result ^ this.register_A) & (result ^ ~value) & 0x80) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);

        this.register_A = result & 0xFF;
        return true;
    }

    // DCP - Decrement Memory and Compare
    processInstruction_DCP(): boolean {
        if (this.currentInstructionCycle <= 1)
            return false;

        let address = this.currentInstructionAddress;
        let value = this.nes.read(address!);

        value--;
        value = value & 0xFF;
        this.nes.write(address!, value);

        const aValue = this.register_A - value;

        this.toggleFlag(this.FLAG_CARRY, ~aValue < 0);
        this.toggleFlag(this.FLAG_ZERO, aValue == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (aValue & (1 << 7)) != 0);
        return true;
    }

    // SAX - Store Accumulator and Index X
    processInstruction_SAX(): boolean {
        let address = this.currentInstructionAddress;

        const value = (this.register_A & this.register_X) & 0xFF;
        this.nes.write(address!, value);
        return true;
    }

    // LAX - Load Accumulator and Index X
    processInstruction_LAX(): boolean {
        let value = this.loadValue();

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_A = value;
        this.register_X = value;
        return true;
    }

    // ROL - Rotate Left
    processInstruction_ROL(): boolean {
        if (this.currentInstructionCycle <= 1 && this.currentInstructionAddressingMode != AddressingMode.Accumulator)
            return false;

        let address = this.currentInstructionAddress;
        let value = this.nes.read(address!);

        const result = ((value << 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 : 0)) & 0xFF;
        this.nes.write(address!, result);

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
        return true;
    }

    // ROR - Rotate Right
    processInstruction_ROR(): boolean {
        if (this.currentInstructionCycle <= 1 && this.currentInstructionAddressingMode != AddressingMode.Accumulator)
            return false;

        let address = this.currentInstructionAddress;
        let value = this.nes.read(address!);

        const result = (value >> 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 << 7 : 0);
        this.nes.write(address!, result);

        this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
        return true;
    }

    // LSR - Logical Shift Right
    processInstruction_LSR(): boolean {
        if (this.currentInstructionCycle <= 1 && this.currentInstructionAddressingMode != AddressingMode.Accumulator)
            return false;

        let address = this.currentInstructionAddress;
        let value = this.nes.read(address!);

        const result = (value >> 1);
        this.nes.write(address!, result);

        this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
        return true;
    }
    // TAX - Transfer Accumulator to Index X
    processInstruction_TAX(): boolean {
        this.register_X = this.register_A;
        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
        return true;
    }

    // TAY - Transfer Accumulator to Index Y
    processInstruction_TAY(): boolean {
        this.register_Y = this.register_A;
        this.toggleFlag(this.FLAG_ZERO, this.register_Y == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_Y & (1 << 7)) != 0);
        return true;
    }

    // TXA - Transfer Index X to Accumulator
    processInstruction_TXA(): boolean {
        this.register_A = this.register_X;
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // TYA - Transfer Index Y to Accumulator
    processInstruction_TYA(): boolean {
        this.register_A = this.register_Y;
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // TSX - Transfer Stack Pointer to Index X
    processInstruction_TSX(): boolean {
        this.register_X = this.register_SP;
        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
        return true;
    }

    // TXS - Transfer Index X to Stack Pointer
    processInstruction_TXS(): boolean {
        this.register_SP = this.register_X;
        return true;
    }

    // DEC - Decrement Memory
    processInstruction_DEC(): boolean {
        if (this.currentInstructionCycle == 0) {
            this.tempAddressArg = this.loadValue();
            return false;
        }

        if (this.currentInstructionCycle == 1) {
            this.nes.write(this.currentInstructionAddress!, this.tempAddressArg); // Read, modify, write back
            return false;
        }

        this.tempAddressArg = (this.tempAddressArg - 1) & 0xFF;
        this.nes.write(this.currentInstructionAddress!, this.tempAddressArg);

        this.toggleFlag(this.FLAG_ZERO, this.tempAddressArg == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.tempAddressArg & (1 << 7)) != 0);
        return true;
    }

    // INX - Increment X Register
    processInstruction_DEX(): boolean {
        this.register_X = (this.register_X - 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
        return true;
    }

    // INY - Increment Y Register
    processInstruction_DEY(): boolean {
        this.register_Y = (this.register_Y - 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_Y == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_Y & (1 << 7)) != 0);
        return true;
    }

    // INC - Increment Memory
    processInstruction_INC(): boolean {
        if (this.currentInstructionCycle == 0) {
            this.tempAddressArg = this.loadValue();
            return false;
        }

        if (this.currentInstructionCycle == 1) {
            this.nes.write(this.currentInstructionAddress!, this.tempAddressArg); // Read, modify, write back
            return false;
        }

        this.tempAddressArg = (this.tempAddressArg + 1) & 0xFF;
        this.nes.write(this.currentInstructionAddress!, this.tempAddressArg);

        this.toggleFlag(this.FLAG_ZERO, this.tempAddressArg == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.tempAddressArg & (1 << 7)) != 0);
        return true;
    }

    // INX - Increment X Register
    processInstruction_INX(): boolean {
        this.register_X = (this.register_X + 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_X == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_X & (1 << 7)) != 0);
        return true;
    }

    // INY - Increment Y Register
    processInstruction_INY(): boolean {
        this.register_Y = (this.register_Y + 1) & 0xFF;

        this.toggleFlag(this.FLAG_ZERO, this.register_Y == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_Y & (1 << 7)) != 0);
        return true;
    }


    // PHP - Push Processor Status
    processInstruction_PHP(): boolean {
        if (this.currentInstructionCycle == 0) {
            return false;
        }

        const flagsBytes = this.status_flags | this.FLAG_UNUSED | this.FLAG_BREAK;
        this.pushStack(flagsBytes);
        return true;
    }

    // PLP - Pull Processor Status
    processInstruction_PLP(): boolean {
        if (this.currentInstructionCycle <= 1) {
            return false;
        }

        const newFlags = this.popStack();

        this.toggleFlag(this.FLAG_CARRY, (newFlags & this.FLAG_CARRY) != 0);
        this.toggleFlag(this.FLAG_ZERO, (newFlags & this.FLAG_ZERO) != 0);
        this.toggleFlag(this.FLAG_DECIMAL, (newFlags & this.FLAG_DECIMAL) != 0);
        this.toggleFlag(this.FLAG_OVERFLOW, (newFlags & this.FLAG_OVERFLOW) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (newFlags & this.FLAG_NEGATIVE) != 0);
        this.pendingInterruptDisableFlag = (newFlags & this.FLAG_INTERRUPT) != 0;

        return true;
    }

    // PHA - Push Accumulator
    processInstruction_PHA(): boolean {
        if (this.currentInstructionCycle == 0) {
            return false;
        }

        this.pushStack(this.register_A);
        return true;
    }

    // PLA - Pull Accumulator
    processInstruction_PLA(): boolean {
        if (this.currentInstructionCycle <= 1) {
            return false;
        }

        this.register_A = this.popStack();
        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);

        return true;
    }


    // BCC - Branch if Carry Clear
    processInstruction_BCC(): boolean {
        if (!(this.status_flags & this.FLAG_CARRY)) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // BCS - Branch if Carry Set
    processInstruction_BCS(): boolean {
        if (this.status_flags & this.FLAG_CARRY) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // BEQ - Branch if Equal
    processInstruction_BEQ(): boolean {
        if (this.status_flags & this.FLAG_ZERO) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // BNE - Branch if Not Equal
    processInstruction_BNE(): boolean {
        if (!(this.status_flags & this.FLAG_ZERO)) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // BPL - Branch if Positive
    processInstruction_BPL(): boolean {
        if (!(this.status_flags & this.FLAG_NEGATIVE)) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // BMI - Branch if Negative
    processInstruction_BMI(): boolean {
        if (this.status_flags & this.FLAG_NEGATIVE) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // BVC - Branch if Overflow Clear
    processInstruction_BVC(): boolean {
        if (!(this.status_flags & this.FLAG_OVERFLOW)) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // BVS - Branch if Overflow Set
    processInstruction_BVS(): boolean {
        if (this.status_flags & this.FLAG_OVERFLOW) {
            if (this.currentInstructionCycle == 0) {
                return false;
            }

            if (this.hasOopsCycles && this.currentInstructionCycle == 1) {
                return false;
            }

            this.register_PC = this.currentInstructionAddress!;
        }

        return true;
    }

    // CMP - Compare
    processInstruction_CMP(): boolean {
        const value = this.loadValue();
        const result = (this.register_A - value) & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, this.register_A >= value);
        this.toggleFlag(this.FLAG_ZERO, this.register_A == value);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
        return true;
    }

    // CPX - Compare X Register
    processInstruction_CPX(): boolean {
        const value = this.loadValue();
        const result = this.register_X - value;

        this.toggleFlag(this.FLAG_CARRY, this.register_X >= value);
        this.toggleFlag(this.FLAG_ZERO, this.register_X == value);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
        return true;
    }

    // CPY - Compare Y Register
    processInstruction_CPY(): boolean {
        const value = this.loadValue();
        const result = this.register_Y - value;

        this.toggleFlag(this.FLAG_CARRY, this.register_Y >= value);
        this.toggleFlag(this.FLAG_ZERO, this.register_Y == value);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);
        return true;
    }

    // SEC - Set Carry Flag
    processInstruction_SEC(): boolean {
        this.toggleFlag(this.FLAG_CARRY, true);
        return true;
    }

    // CLC - Clear Carry Flag
    processInstruction_CLC(): boolean {
        this.toggleFlag(this.FLAG_CARRY, false);
        return true;
    }

    // CLD - Clear Decimal Flag
    processInstruction_CLD(): boolean {
        this.toggleFlag(this.FLAG_DECIMAL, false);
        return true;
    }

    // CLI - Clear Interrupt Disable
    processInstruction_CLI(): boolean {
        this.toggleFlag(this.FLAG_INTERRUPT, false);
        return true;
    }

    // SEI - Set Interrupt Disable
    processInstruction_SEI(): boolean {
        this.pendingInterruptDisableFlag = true;
        return true;
    }

    // CLV - Clear Overflow Flag
    processInstruction_CLV(): boolean {
        this.toggleFlag(this.FLAG_OVERFLOW, false);
        return true;
    }

    // SED - Set Decimal Flag
    processInstruction_SED(): boolean {
        this.toggleFlag(this.FLAG_DECIMAL, true);
        return true;
    }


    // NOP - No Operation
    processInstruction_NOP(extraCycles: number, extraReads: number): boolean {

        if (this.currentInstructionCycle == 0) {
            for (let i = 0; i < extraReads; i++) {
                this.advancePC();
            }
        }

        if (this.currentInstructionCycle < extraCycles)
            return false;

        return true;
    }

    // STX - Store X Register
    processInstruction_STX(): boolean {

        if (this.nes.isNormalAddress(this.currentInstructionAddress!)) {
            this.instructionResult.target_address_value = this.nes.read(this.currentInstructionAddress!);
        }

        this.nes.write(this.currentInstructionAddress!, this.register_X);
        return true;
    }

    // STY - Store Y Register
    processInstruction_STY(): boolean {
        if (this.nes.isNormalAddress(this.currentInstructionAddress!)) {
            this.instructionResult.target_address_value = this.nes.read(this.currentInstructionAddress!);
        }
        this.nes.write(this.currentInstructionAddress!, this.register_Y);
        return true;
    }

    // STA - Store Accumulator
    processInstruction_STA(): boolean {
        if (this.nes.isNormalAddress(this.currentInstructionAddress!)) {
            this.instructionResult.target_address_value = this.nes.read(this.currentInstructionAddress!);
        }
        this.nes.write(this.currentInstructionAddress!, this.register_A);
        return true;
    }

    // LDX - Load X Register
    processInstruction_LDX(): boolean {
        const value = this.loadValue();

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_X = value;
        return true;
    }

    // LDY - Load Y Register
    processInstruction_LDY(): boolean {
        const value = this.loadValue();

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_Y = value;

        return true;
    }

    // LDA - Load Accumulator
    processInstruction_LDA(): boolean {
        const value = this.loadValue();

        this.toggleFlag(this.FLAG_ZERO, value == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        this.register_A = value;

        return true;
    }

    // JMP - Jump
    processInstruction_JMP(): boolean {
        if (this.currentInstructionAddressingMode == AddressingMode.Indirect && this.currentInstructionCycle == 0) {
            return false;
        }

        this.register_PC = this.currentInstructionAddress!;

        return true;
    }


    // JSR - Jump to Subroutine
    processInstruction_JSR(): boolean {
        if (this.currentInstructionCycle <= 2)
            return false;

        this.pushStack16(this.register_PC - 1);
        this.register_PC = this.currentInstructionAddress!;
        return true;
    }

    // RTS - Return from Subroutine
    processInstruction_RTS(): boolean {
        if (this.currentInstructionCycle <= 3)
            return false;

        this.register_PC = this.popStack16() + 1;
        return true;
    }

    // RTI - Return from Interrupt
    processInstruction_RTI(): boolean {
        if (this.currentInstructionCycle <= 3)
            return false;

        this.status_flags = this.popStack() | (this.status_flags & this.FLAG_BREAK);
        this.register_PC = this.popStack16();

        if (this.nes.breakOnRti) {
            this.nes.togglePause();
        }
        return true;
    }

    // ASL - Arithmetic Shift Left
    processInstruction_ASL(): boolean {
        if (this.currentInstructionCycle <= 1 && this.currentInstructionAddressingMode != AddressingMode.Accumulator)
            return false;

        const value = this.loadValue();
        const newValue = (value << 1) & 0xFF;

        this.toggleFlag(this.FLAG_CARRY, (value & (1 << 7)) != 0);
        this.toggleFlag(this.FLAG_ZERO, newValue == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (newValue & (1 << 7)) != 0);

        this.nes.write(this.currentInstructionAddress!, newValue);
        return true;
    }

    // AND - Logical AND
    processInstruction_AND(): boolean {
        const value = this.loadValue();
        this.register_A = this.register_A & value;

        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // BIT - Test Bits
    processInstruction_BIT(): boolean {
        const value = this.loadValue();
        const result = this.register_A & value;

        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, (value & (1 << 6)) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & (1 << 7)) != 0);

        return true;
    }

    // ORA - Logical OR
    processInstruction_ORA(): boolean {
        const value = this.loadValue();

        this.register_A = this.register_A | value;

        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // EOR - Logical Exclusive OR
    processInstruction_EOR(): boolean {
        const value = this.loadValue();

        this.register_A = this.register_A ^ value;

        this.toggleFlag(this.FLAG_ZERO, this.register_A == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (this.register_A & (1 << 7)) != 0);
        return true;
    }

    // ADC - Add with Carry
    processInstruction_ADC(): boolean {
        const value = this.loadValue();

        var result = this.register_A + value + (this.status_flags & this.FLAG_CARRY ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, result > 0xFF);
        this.toggleFlag(this.FLAG_ZERO, (result & 0xFF) == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, ((result ^ this.register_A) & (result ^ value) & 0x80) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);

        this.register_A = result & 0xFF;
        return true;
    }

    // SBC - Subtract with Carry
    processInstruction_SBC(): boolean {
        let value: number = this.loadValue();
        var result = this.register_A + ~value + (this.status_flags & this.FLAG_CARRY ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, (~result < 0x00));
        this.toggleFlag(this.FLAG_ZERO, result == 0);
        this.toggleFlag(this.FLAG_OVERFLOW, ((result ^ this.register_A) & (result ^ ~value) & 0x80) != 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (result & (1 << 7)) != 0);

        this.register_A = result & 0xFF;
        return true;
    }

    private loadValue(): number {
        if (this.currentInstructionAddressingMode == AddressingMode.Immediate) {
            const value = this.nes.read(this.register_PC);
            this.instructionResult.target_address_value = value;
            this.advancePC();
            return value;
        }
        else {
            const value = this.nes.read(this.currentInstructionAddress!);
            this.instructionResult.target_address_value = value;
            return value;
        }
    }


    private getAddressFunction(mode: AddressingMode): AddressFunction {
        let addressFunction = undefined;

        switch (mode) {
            case AddressingMode.ZeroPage:
                addressFunction = this.getZeroPageAddress;
                break;
            case AddressingMode.ZeroPageX:
                addressFunction = this.getZeroPageXAddress;
                break;
            case AddressingMode.ZeroPageY:
                addressFunction = this.getZeroPageYAddress;
                break;
            case AddressingMode.Absolute:
                addressFunction = this.getAbsoluteAddress;
                break;
            case AddressingMode.AbsoluteX:
                addressFunction = this.getAbsoluteXAddress;
                break;
            case AddressingMode.AbsoluteY:
                addressFunction = this.getAbsoluteYAddress;
                break;
            case AddressingMode.IndirectX:
                addressFunction = this.getIndirectXAddress;
                break;
            case AddressingMode.IndirectY:
                addressFunction = this.getIndirectYAddress;
                break;
            case AddressingMode.Relative:
                addressFunction = this.getRelativeAddress;
                break;
            case AddressingMode.Accumulator:
                addressFunction = this.getAccumulatorAddress;
                break;
            case AddressingMode.Indirect:
                addressFunction = this.getIndirectAddress;
                break;
            default:
                throw new Error(`Unknown addressing mode: ${mode} with instruction ${this.instructionResult.instructionMetadata?.name}`);
        }

        if (addressFunction == undefined) {
            throw new Error(`Address function is undefined for mode: ${AddressingMode[mode]} with instruction ${this.instructionResult.instructionMetadata?.name}`);
        }

        return addressFunction;
    }

    ////////////
    // Address Functions
    ////////////

    getAccumulatorAddress(): boolean {
        this.currentInstructionAddress = this.nes.CPU_BUSADDRESS_REGISTER_A;
        return true;
    }

    getRelativeAddress(): boolean {
        const arg = this.nes.read(this.register_PC);
        if (this.currentInstructionCycle == 0)
            this.advancePC();

        let address = u8toSigned(arg);
        const final_address = this.register_PC + address;
        this.currentInstructionAddress = final_address;

        const pc_low_byte = this.register_PC & 0xFF;
        if (pc_low_byte + address > 0xFF || pc_low_byte + address < 0) {
            this.hasOopsCycles = true;
        }

        return true;
    }

    getIndirectYAddress(): boolean {
        // Get the zero page address (arg) and store it in temp_register
        if (this.currentInstructionCycle == 0) {
            this.tempAddressArg = this.nes.read(this.register_PC);
            this.instructionResult.indirectOffsetBase = this.tempAddressArg;
            this.advancePC();
            return false;
        }
        if (this.currentInstructionCycle == 1) {
            // Get the value at the zero page address + Y to get the high byte
            const lowByte = this.nes.read(this.tempAddressArg);
            this.currentInstructionAddress = lowByte;
            return false;
        }

        if (this.currentInstructionAddress == undefined)
            throw new Error(`currentInstructionAddress should be set by now!`);

        if (this.currentInstructionCycle == 2) {
            // Get the value at the zero page address + Y to get the high byte
            const highByte = this.nes.read((this.tempAddressArg + 1) % 0x100);
            this.currentInstructionAddress |= highByte << 8;
            return false;
        }

        const lowByte = this.currentInstructionAddress & 0xFF;

        if (this.isStoreInstruction() || lowByte + this.register_Y > 0xFF) {
            this.hasOopsCycles = true;
        }

        const finalAddress = (this.currentInstructionAddress + this.register_Y) % 0x10000;

        this.instructionResult.indirectOffset = (this.tempAddressArg + this.register_Y) % 0x100;

        //console.log(`getIndirectYAddress (${numberToHex(arg)},Y) @ ${numberToHex(this.register_Y)} = ${numberToHex(finalAddress)} L:${numberToHex(lowByte)} H:${numberToHex(highByte)}`);

        this.currentInstructionAddress = finalAddress;
        //val =  PEEK(arg) + PEEK((arg + 1) % 256) 256 + Y
        return true;
    }

    getIndirectXAddress(): boolean {
        // Get the zero page address (arg) and store it in temp_register
        if (this.currentInstructionCycle == 0) {
            this.tempAddressArg = this.nes.read(this.register_PC);
            this.instructionResult.indirectOffsetBase = this.tempAddressArg;
            this.advancePC();
            return false;
        }
        // Get the value at the zero page address + X to get the high byte
        if (this.currentInstructionCycle == 1) {
            const zeroPageAddress = (this.tempAddressArg + this.register_X) % 0x100;
            this.currentInstructionAddress = this.nes.read(zeroPageAddress);
            return false;
        }

        if (this.currentInstructionAddress == undefined)
            throw new Error(`currentInstructionAddress should be set by now! Cycle: ${this.currentInstructionCycle}`);

        if (this.currentInstructionCycle == 2) {
            // Get the low byte
            const zeroPageAddress2 = (this.tempAddressArg + this.register_X + 1) % 0x100;
            this.currentInstructionAddress |= this.nes.read(zeroPageAddress2) << 8;
            return false;
        }

        if (this.currentInstructionCycle == 3)
            return false;
        //console.log(`LDA (${numberToHex(arg)},X) @ ${numberToHex(this.register_X)} = ${numberToHex(address)} ZPA1: ${numberToHex(zeroPageAddress)} ZPA2: ${numberToHex(zeroPageAddress2)}`);
        //val = PEEK(  PEEK((arg + X) % 256) + PEEK( (arg + X + 1) % 256) 256  )	

        this.instructionResult.indirectOffset = (this.tempAddressArg + this.register_X) % 0xFF;
        return true;
    }

    getAbsoluteXAddress(): boolean {
        if (this.currentInstructionCycle == 0) {
            const lowByte = this.nes.read(this.register_PC);
            this.currentInstructionAddress = lowByte;
            this.advancePC();
            return false;
        }

        if (this.currentInstructionAddress == undefined)
            throw new Error(`currentInstructionAddress should be set by now!`);

        if (this.currentInstructionCycle == 1) {
            const highByte = this.nes.read(this.register_PC) << 8;
            this.currentInstructionAddress |= highByte;
            this.advancePC();
            return false;
        }

        if (this.currentInstructionCycle == 2) {
            const lowByte = this.currentInstructionAddress & 0xFF;

            if (this.isStoreInstruction() || lowByte + this.register_X > 0xFF) {
                this.hasOopsCycles = true;
            }
        }

        this.currentInstructionAddress = (this.currentInstructionAddress + this.register_X) % 0x10000;
        return true;
    }

    getAbsoluteYAddress(): boolean {
        if (this.currentInstructionCycle == 0) {
            const lowByte = this.nes.read(this.register_PC);
            this.currentInstructionAddress = lowByte;
            this.advancePC();
            return false;
        }

        if (this.currentInstructionAddress == undefined)
            throw new Error(`currentInstructionAddress should be set by now!`);

        if (this.currentInstructionCycle == 1) {
            const highByte = this.nes.read(this.register_PC) << 8;
            this.currentInstructionAddress |= highByte;
            this.advancePC();
            return false;
        }

        if (this.currentInstructionCycle == 2) {
            const lowByte = this.currentInstructionAddress & 0xFF;
            if (this.isStoreInstruction() || lowByte + this.register_Y > 0xFF) {
                this.hasOopsCycles = true;
            }
        }

        this.currentInstructionAddress = (this.currentInstructionAddress + this.register_Y) % 0x10000;


        return true;
    }

    getAbsoluteAddress(): boolean {
        if (this.currentInstructionCycle == 0) {
            this.currentInstructionAddress = this.nes.read(this.register_PC);
            this.advancePC();
            return false;
        }

        if (this.currentInstructionAddress == undefined)
            throw new Error(`currentInstructionAddress should be set by now!`);

        if (this.currentInstructionCycle == 1) {
            this.currentInstructionAddress |= this.nes.read(this.register_PC) << 8;
            this.advancePC();
            return false;
        }

        return true;
    }

    getZeroPageAddress(): boolean {
        if (this.currentInstructionCycle == 0) {
            const address = this.nes.read(this.register_PC);
            this.currentInstructionAddress = address;
            this.advancePC();
            return false;
        }

        return true;
    }

    getZeroPageXAddress(): boolean {
        if (this.currentInstructionCycle == 0) {
            const address = this.nes.read(this.register_PC);
            const finalAddress = (address + this.register_X) % 0x100;
            this.currentInstructionAddress = finalAddress;
            this.advancePC();
        }

        if (this.currentInstructionCycle == 0 || this.currentInstructionCycle == 1)
            return false;

        return true;
    }

    getZeroPageYAddress(): boolean {
        if (this.currentInstructionCycle == 0) {
            const address = this.nes.read(this.register_PC);
            this.currentInstructionAddress = (address + this.register_Y) % 0x100;
            this.advancePC();
        }

        if (this.currentInstructionCycle == 0 || this.currentInstructionCycle == 1)
            return false;

        return true;
    }

    getIndirectAddress(): boolean {
        if (this.currentInstructionCycle == 0) {
            const lowByte = this.nes.read(this.register_PC);
            this.currentInstructionAddress = lowByte;
            this.advancePC();
            return false;
        }

        if (this.currentInstructionAddress == undefined)
            throw new Error(`currentInstructionAddress should be set by now!`);

        if (this.currentInstructionCycle == 1) {
            const highByte = this.nes.read(this.register_PC);
            this.currentInstructionAddress |= highByte << 8;
            this.advancePC();
            return false;
        }

        if (this.currentInstructionCycle == 2) {
            return false;
        }

        if (this.currentInstructionCycle == 3) {
            const finalAddressLow = this.nes.read(this.currentInstructionAddress);

            const lowByte = this.currentInstructionAddress & 0xFF;
            const highByte = (this.currentInstructionAddress >> 8) & 0xFF;

            const address = (highByte << 8) | ((lowByte + 1) % 0x100);
            const finalAddressHigh = this.nes.read(address);

            const finalAddress = (finalAddressHigh << 8) | finalAddressLow;

            //console.log(`getIndirectAddress (${numberToHex(highByte)},${numberToHex(lowByte)}) = A: ${numberToHex(address)} F: ${numberToHex(finalAddress)}`);

            this.currentInstructionAddress = finalAddress;
        }

        return true;
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
            this.instructionResult.instructionMetadata?.name == "SRE" ||
            this.instructionResult.instructionMetadata?.name == "RLA" ||
            this.instructionResult.instructionMetadata?.name == "RRA" ||
            this.instructionResult.instructionMetadata?.name.startsWith("AS"))
            ?? false;
    }

    NMI() {
        this.pendingNonMaskableInterruptFlag = true;
        //console.log(`NMI triggered on ${numberToHex(this.register_PC)} Instruction: ${this.instructionResult.instructionMetadata?.name}`);
    }

    IRQ() {
        if ((this.status_flags & this.FLAG_INTERRUPT) == 0) {
            this.pendingIRQFlag = true;
        }
    }



    getInstructionFunc(instructionOpCode: number): Instruction {
        const instructionData = instructionMap[instructionOpCode];

        let instructionFunc: Instruction | undefined = undefined;

        this.currentInstructionAddressingMode = instructionData.mode;

        if (!(this.currentInstructionAddressingMode == AddressingMode.Implied || instructionData.mode == AddressingMode.Immediate))
            this.currentInstructionAddressFunction = this.getAddressFunction(this.currentInstructionAddressingMode);

        if (instructionData.instruction != undefined) {
            return instructionData.instruction;
        }

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
                instructionFunc = (): boolean => { return this.processInstruction_NOP(0, 0); }
                break;
            case "*NOP":
                instructionFunc = (): boolean => { return this.processInstruction_NOP(1, 1); }
                break;
            case "!NOP":
                instructionFunc = (): boolean => { return this.processInstruction_NOP(2, 2); }
                break;
            case "&NOP":
                instructionFunc = (): boolean => { return this.processInstruction_NOP(2, 1); }
                break;
            case "+NOP":
                instructionFunc = (): boolean => { return this.processInstruction_NOP(0, 1); }
                break;
            case "@NOP":
                instructionFunc = (): boolean => { return this.processInstruction_NOP(0, 0); }
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

        const cpu = this;

        const wrappedInstruction = function (): boolean {
            if (instructionFunc == undefined) {
                throw new Error(`Instruction function is undefined!`);
            }

            if (cpu.currentInstructionCycle == -2) {
                // Finish oops cycle
                return true;
            }

            if (cpu.currentInstructionAddressFunction != undefined) {
                cpu.currentInstructionCycle++;
                const result = cpu.currentInstructionAddressFunction.call(cpu);

                if (result) {
                    cpu.currentInstructionAddressFunction = undefined;
                    cpu.instructionResult.target_address = cpu.currentInstructionAddress;
                    cpu.currentInstructionCycle = -1;
                }
                else {
                    return false;
                }
            }

            if (cpu.currentInstructionCycle == -1) {
                cpu.currentInstructionCycle = 0;

                if (!instructionData.noInitialCycleDelay)
                    return false;
            }


            //console.log(`After Memory = clock: ${cpu.cpuCycles} ${AddressingModeNames[cpu.currentInstructionAddressingMode]} ${cpu.currentInstructionAddress}`);

            const result = instructionFunc.call(cpu);
            cpu.currentInstructionCycle++;

            if (result && cpu.hasOopsCycles && (instructionData.checkForOopsCycle || cpu.isStoreInstruction())) {
                cpu.currentInstructionCycle = -2;
                return false;
            }
            return result;
        };

        instructionData.instruction = wrappedInstruction;

        if (instructionData.instruction == undefined) {
            throw new Error(`Unknown instruction: ${instructionData.name}`);
        }

        return wrappedInstruction;
    }
}
