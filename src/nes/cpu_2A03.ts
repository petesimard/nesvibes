import { numberToHex, u8toSigned } from "../emulator/utils";
import { AddressingMode, AddressingModeNames, instructionMap, InstructionMetadata } from "./2A03_instruction_map";
import { Nes } from "./nes";

export type Instruction = () => boolean;
export type AddressFunction = () => boolean;

const DEBUG_BREAKPOINT_CYCLE: number | undefined = undefined;
//const DEBUG_BREAKPOINT_CYCLE: number | undefined = 2560;

const LOG_INSTRUCTIONS: boolean = false;

// Instructions that always take the extra indexed-addressing cycle (writes and read-modify-writes).
const STORE_INSTRUCTIONS = new Set<string>([
    "STA", "STX", "STY",
    "ASL", "LSR", "ROL", "ROR", "INC", "DEC",
    "DCP", "ISB", "SLO", "SRE", "RLA", "RRA",
    "SHY", "SHX", "AHX", "TAS",
]);

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
    FLAG_BREAK: number = 1 << 4;
    FLAG_UNUSED: number = 1 << 5;
    FLAG_OVERFLOW: number = 1 << 6;
    FLAG_NEGATIVE: number = 1 << 7;

    pendingNonMaskableInterruptFlag: boolean = false;
    // One-shot IRQ request (legacy IRQ() shim). Prefer setIrqLine().
    pendingIRQFlag: boolean = false;

    // Level-triggered IRQ line: one bit per source. The CPU takes an IRQ at an instruction
    // boundary while any bit is set and the I flag is clear.
    static readonly IRQ_SOURCE_MAPPER = 1 << 0;
    static readonly IRQ_SOURCE_APU_FRAME = 1 << 1;
    static readonly IRQ_SOURCE_APU_DMC = 1 << 2;
    irqLines: number = 0;

    // CLI/SEI/PLP change I after the interrupt poll of their last cycle, so the poll at the next
    // instruction boundary must see the I value from before the change.
    irqPollUseOldIFlag: boolean = false;
    irqPollOldIFlag: boolean = false;

    // Set by KIL/JAM opcodes. The CPU stops until reset.
    halted: boolean = false;
    // Interrupt state sampled as the current instruction's last cycle began. The 6502 polls
    // interrupts before the final cycle, so an interrupt raised during that cycle waits for
    // the next instruction.
    nmiPolled: boolean = false;
    nmiSampled: boolean = false; // NMI state latched by sampleNmi() earlier in this cycle
    irqPolled: boolean = false;
    private hasWarnedHalt: boolean = false;
    private hasPoweredOn: boolean = false;
    // True if the current instruction always takes the extra indexed-addressing cycle (stores / RMW).
    private currentInstructionIsStore: boolean = false;
    private dmaAlignCycles: number = 0;

    STACK_START: number = 0x0100;

    status_flags: number = this.FLAG_INTERRUPT | this.FLAG_UNUSED;
    current_instruction: Instruction | undefined = undefined;
    currentInstructionCycle: number = 0;
    currentInstructionAddressingMode: AddressingMode = AddressingMode.Implied;
    currentInstructionAddress: number | undefined = undefined;
    addressRegister: number = 0x00;
    instructionResult: InstructionResult = new InstructionResult();
    debug_break_on_next_instruction: boolean = false;
    currentInstructionAddressFunction: AddressFunction | undefined = undefined;
    tempAddressArg: number = 0x00;
    hasOopsCycles: boolean = false;

    nmiInstruction: Instruction;
    irqInstruction: Instruction;
    dmaInstruction: Instruction;

    constructor(nes: Nes) {
        this.nes = nes;

        this.nmiInstruction = this.wrapInstruction(this.ExecuteNMI, instructionMap[0x100]);
        this.irqInstruction = this.wrapInstruction(this.ExecuteIRQ, instructionMap[0x101]);
        this.dmaInstruction = this.wrapInstruction(this.ExecuteOAMDMA, instructionMap[0x102]);
    }

    onReset() {
        if (!this.hasPoweredOn) {
            // Power-on state
            this.hasPoweredOn = true;
            this.status_flags = this.FLAG_INTERRUPT | this.FLAG_UNUSED;
            this.register_X = 0x00;
            this.register_Y = 0x00;
            this.register_SP = 0xFD;
            this.register_A = 0x00;
        }
        else {
            // Soft reset: A/X/Y kept, SP decremented by 3 (suppressed pushes), I set
            this.register_SP = (this.register_SP - 3) & 0xFF;
            this.status_flags = (this.status_flags | this.FLAG_INTERRUPT | this.FLAG_UNUSED) & ~this.FLAG_BREAK;
        }
        this.addressRegister = 0x00;
        this.register_PC = this.nes.read16(0xFFFC);
        this.current_instruction = undefined;
        this.currentInstructionAddressFunction = undefined;
        this.currentInstructionCycle = 0;
        this.currentInstructionIsStore = false;
        this.cpuCycles = 0;
        this.hasOopsCycles = false;
        this.register_OAMDMA = undefined;
        this.oamDataCount = 0;
        this.pendingNonMaskableInterruptFlag = false;
        this.pendingIRQFlag = false;
        this.irqLines = 0;
        this.irqPollUseOldIFlag = false;
        this.irqPollOldIFlag = false;
        this.halted = false;
        this.hasWarnedHalt = false;
        this.nmiPolled = false;
        this.nmiSampled = false;
        this.irqPolled = false;
        //this.register_PC = 0x6000;
        console.log(`Initial PC: ${numberToHex(this.register_PC)}`);
    }

    clock() {
        this.cpuCycles++;

        if (this.cpuCycles < 7) {
            return;
        }

        if (this.halted) {
            return;
        }

        //console.log(`Clock Start PC: ${numberToHex(this.register_PC)}`);
        if (this.current_instruction != undefined) {
            // If this turns out to be the instruction's last cycle, the poll uses this state
            this.nmiPolled = this.nmiSampled;
            this.irqPolled = this.irqLines != 0 || this.pendingIRQFlag;
            this.processCurrentInstruction();
            return;
        }

        // Instruction boundary
        if (this.register_OAMDMA != undefined) {
            // OAM DMA halts the CPU right after the $4014 write: 1 halt cycle (+1 alignment cycle
            // when starting on an odd CPU cycle) then 256 read/write pairs = 513/514 cycles.
            this.dmaAlignCycles = (this.cpuCycles & 1) != 0 ? 1 : 0;
            this.currentInstructionAddressingMode = AddressingMode.Implied;
            this.currentInstructionIsStore = false;
            this.setInstruction(this.dmaInstruction);
            this.currentInstructionCycle = 0;
            this.processCurrentInstruction();
            return;
        }

        // Interrupt poll. CLI/SEI/PLP: use I as it was before the last instruction changed it.
        const interruptDisabled = this.irqPollUseOldIFlag ? this.irqPollOldIFlag : (this.status_flags & this.FLAG_INTERRUPT) != 0;
        this.irqPollUseOldIFlag = false;
        const irqActive = this.irqPolled && (this.irqLines != 0 || this.pendingIRQFlag) && !interruptDisabled;

        if (this.pendingNonMaskableInterruptFlag && this.nmiPolled) {
            this.pendingNonMaskableInterruptFlag = false;
            this.currentInstructionAddressingMode = AddressingMode.Implied;
            this.currentInstructionIsStore = false;
            this.setInstruction(this.nmiInstruction);
            this.currentInstructionCycle = 0;
        }
        else if (irqActive) {
            this.pendingIRQFlag = false;
            this.currentInstructionAddressingMode = AddressingMode.Implied;
            this.currentInstructionIsStore = false;
            this.setInstruction(this.irqInstruction);
            this.currentInstructionCycle = 0;
        }
        else {

            const instructionOpCode = this.nes.read(this.register_PC);
            this.logInstruction(instructionOpCode);

            //console.log(`Instruction: ${numberToHex(instructionOpCode)}`);
            const newInstruction = this.getInstructionFunc(instructionOpCode);
            this.setInstruction(newInstruction);
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
        this.register_PC = (this.register_PC + 1) & 0xFFFF;
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
        // Cycle 0 is the halt cycle (+ optional alignment cycle), then alternating get/put cycles.
        const firstGetCycle = 1 + this.dmaAlignCycles;
        const cycle = this.currentInstructionCycle - firstGetCycle;
        if (cycle < 0) {
            return false;
        }

        if (cycle % 2 != 0) {
            // Put cycle. The DMA ends with the put of the 256th byte.
            return cycle >= 511;
        }

        const address = this.register_OAMDMA! + this.oamDataCount;
        const value = this.nes.read(address);
        this.nes.write(this.nes.getPpu().register_address_OAMDATA, value);

        this.oamDataCount++;
        if (this.oamDataCount >= 256) {
            this.register_OAMDMA = undefined;
        }
        return false;
    }

    // Shared 7-cycle interrupt sequence (cycle 0 = the replaced opcode fetch).
    private executeInterruptSequence(vector: number, pushedFlags: number, cycle: number): boolean {
        if (cycle == 2) {
            this.pushStack((this.register_PC >> 8) & 0xFF);
            return false;
        }

        if (cycle == 3) {
            this.pushStack(this.register_PC & 0xFF);
            return false;
        }

        if (cycle == 4) {
            // NMI hijack: an NMI arriving before the vector fetch takes over the vector.
            if (vector != 0xFFFA && this.pendingNonMaskableInterruptFlag) {
                this.pendingNonMaskableInterruptFlag = false;
                this.interruptVector = 0xFFFA;
            }
            else {
                this.interruptVector = vector;
            }
            this.pushStack(pushedFlags);
            return false;
        }

        if (cycle == 5) {
            this.toggleFlag(this.FLAG_INTERRUPT, true);
            return false;
        }

        if (cycle == 6) {
            this.register_PC = this.nes.read16(this.interruptVector);
            return true;
        }

        return false;
    }

    interruptVector: number = 0xFFFE;

    ExecuteNMI(): boolean {
        const flags = (this.status_flags & ~this.FLAG_BREAK) | this.FLAG_UNUSED;
        return this.executeInterruptSequence(0xFFFA, flags, this.currentInstructionCycle);
    }

    // BRK - Break. Opcode fetch is cycle 1, this function runs for cycles 2..7.
    processInstruction_BRK(): boolean {
        if (this.currentInstructionCycle == 0) {
            // Read (and skip) the padding byte; return address is opcode + 2
            this.nes.read(this.register_PC);
            this.advancePC();
            return false;
        }

        const flags = this.status_flags | this.FLAG_BREAK | this.FLAG_UNUSED;
        return this.executeInterruptSequence(0xFFFE, flags, this.currentInstructionCycle + 1);
    }

    // IRQ - Interrupt Request
    ExecuteIRQ(): boolean {
        // Push P as it was (I not yet set), then set I.
        const flags = (this.status_flags & ~this.FLAG_BREAK) | this.FLAG_UNUSED;
        return this.executeInterruptSequence(0xFFFE, flags, this.currentInstructionCycle);
    }

    // ANC - AND immediate, then C = N
    processInstruction_ANC(): boolean {
        this.register_A &= this.loadValue();
        this.setZN(this.register_A);
        this.toggleFlag(this.FLAG_CARRY, (this.register_A & 0x80) != 0);
        return true;
    }

    // ALR (ASR) - AND immediate, then LSR A
    processInstruction_ALR(): boolean {
        const value = this.register_A & this.loadValue();
        this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
        this.register_A = value >> 1;
        this.setZN(this.register_A);
        return true;
    }

    // ARR - AND immediate, then ROR A; C = bit 6, V = bit 6 ^ bit 5
    processInstruction_ARR(): boolean {
        const value = this.register_A & this.loadValue();
        this.register_A = (value >> 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 0x80 : 0);
        this.setZN(this.register_A);
        this.toggleFlag(this.FLAG_CARRY, (this.register_A & 0x40) != 0);
        this.toggleFlag(this.FLAG_OVERFLOW, (((this.register_A >> 6) ^ (this.register_A >> 5)) & 1) != 0);
        return true;
    }

    // XAA (ANE) - unstable: A = (A | magic) & X & imm
    processInstruction_XAA(): boolean {
        this.register_A = (this.register_A | 0xEE) & this.register_X & this.loadValue();
        this.setZN(this.register_A);
        return true;
    }

    // LXA (LAX #imm) - unstable; most emulators use A = X = imm
    processInstruction_LXA(): boolean {
        const value = this.loadValue();
        this.register_A = value;
        this.register_X = value;
        this.setZN(value);
        return true;
    }

    // AXS (SBX) - X = (A & X) - imm, flags like CMP
    processInstruction_AXS(): boolean {
        const value = this.loadValue();
        const ax = this.register_A & this.register_X;
        this.compare(ax, value);
        this.register_X = (ax - value) & 0xFF;
        return true;
    }

    // LAS - A = X = SP = mem & SP
    processInstruction_LAS(): boolean {
        const value = this.loadValue() & this.register_SP;
        this.register_A = value;
        this.register_X = value;
        this.register_SP = value;
        this.setZN(value);
        return true;
    }

    // SHY / SHX / AHX (SHA) / TAS: store value & (base high byte + 1). On a page cross the
    // high byte of the target address is replaced by the stored value.
    private storeHighAnd(value: number, index: number) {
        const finalAddress = this.currentInstructionAddress!;
        const baseAddress = (finalAddress - index) & 0xFFFF;
        const result = value & (((baseAddress >> 8) + 1) & 0xFF);
        let address = finalAddress;
        if ((baseAddress & 0xFF00) != (finalAddress & 0xFF00)) {
            address = (result << 8) | (finalAddress & 0xFF);
        }
        this.nes.write(address, result);
    }

    processInstruction_SHY(): boolean {
        this.storeHighAnd(this.register_Y, this.register_X);
        return true;
    }

    processInstruction_SHX(): boolean {
        this.storeHighAnd(this.register_X, this.register_Y);
        return true;
    }

    processInstruction_AHX(): boolean {
        this.storeHighAnd(this.register_A & this.register_X, this.register_Y);
        return true;
    }

    processInstruction_TAS(): boolean {
        this.register_SP = this.register_A & this.register_X;
        this.storeHighAnd(this.register_SP, this.register_Y);
        return true;
    }

    // KIL (JAM) - halts the CPU until reset
    processInstruction_KIL(): boolean {
        this.halted = true;
        if (!this.hasWarnedHalt) {
            this.hasWarnedHalt = true;
            console.warn(`CPU halted by KIL/JAM opcode at ${numberToHex((this.register_PC - 1) & 0xFFFF)}`);
        }
        return true;
    }

    // RRA - Rotate Right then Add with Carry
    processInstruction_RRA(): boolean {
        return this.readModifyWrite((value) => {
            const result = (value >> 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 0x80 : 0);
            this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
            this.addWithCarry(result);
            return result;
        });
    }

    // SRE - Shift Right then EOR
    processInstruction_SRE(): boolean {
        return this.readModifyWrite((value) => {
            const result = value >> 1;
            this.register_A ^= result;
            this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
            this.setZN(this.register_A);
            return result;
        });
    }

    // RLA - Rotate Left then AND
    processInstruction_RLA(): boolean {
        return this.readModifyWrite((value) => {
            const result = ((value << 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 : 0)) & 0xFF;
            this.register_A &= result;
            this.toggleFlag(this.FLAG_CARRY, (value & 0x80) != 0);
            this.setZN(this.register_A);
            return result;
        });
    }

    // SLO - Shift Left then OR
    processInstruction_SLO(): boolean {
        return this.readModifyWrite((value) => {
            const result = (value << 1) & 0xFF;
            this.register_A |= result;
            this.toggleFlag(this.FLAG_CARRY, (value & 0x80) != 0);
            this.setZN(this.register_A);
            return result;
        });
    }

    // ISB - Increment Memory then Subtract with Carry
    processInstruction_ISB(): boolean {
        return this.readModifyWrite((value) => {
            const result = (value + 1) & 0xFF;
            this.addWithCarry(result ^ 0xFF);
            return result;
        });
    }

    // DCP - Decrement Memory then Compare
    processInstruction_DCP(): boolean {
        return this.readModifyWrite((value) => {
            const result = (value - 1) & 0xFF;
            this.compare(this.register_A, result);
            return result;
        });
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
        return this.readModifyWrite((value) => {
            const result = ((value << 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 1 : 0)) & 0xFF;
            this.toggleFlag(this.FLAG_CARRY, (value & 0x80) != 0);
            this.setZN(result);
            return result;
        });
    }

    // ROR - Rotate Right
    processInstruction_ROR(): boolean {
        return this.readModifyWrite((value) => {
            const result = (value >> 1) | ((this.status_flags & this.FLAG_CARRY) != 0 ? 0x80 : 0);
            this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
            this.setZN(result);
            return result;
        });
    }

    // LSR - Logical Shift Right
    processInstruction_LSR(): boolean {
        return this.readModifyWrite((value) => {
            const result = value >> 1;
            this.toggleFlag(this.FLAG_CARRY, (value & 1) != 0);
            this.setZN(result);
            return result;
        });
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
        return this.readModifyWrite((value) => {
            const result = (value - 1) & 0xFF;
            this.setZN(result);
            return result;
        });
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
        return this.readModifyWrite((value) => {
            const result = (value + 1) & 0xFF;
            this.setZN(result);
            return result;
        });
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

        // PHP pushes with B and bit 5 set
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
        this.setInterruptDisableDelayed((newFlags & this.FLAG_INTERRUPT) != 0);

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
        this.setInterruptDisableDelayed(false);
        return true;
    }

    // CLI/SEI/PLP: the flag changes immediately, but the IRQ poll at the next instruction boundary
    // still uses the previous value (one-instruction latency).
    private setInterruptDisableDelayed(value: boolean) {
        this.irqPollOldIFlag = (this.status_flags & this.FLAG_INTERRUPT) != 0;
        this.irqPollUseOldIFlag = true;
        this.toggleFlag(this.FLAG_INTERRUPT, value);
    }

    // SEI - Set Interrupt Disable
    processInstruction_SEI(): boolean {
        this.setInterruptDisableDelayed(true);
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
        this.store(this.register_X);
        return true;
    }

    // STY - Store Y Register
    processInstruction_STY(): boolean {
        this.store(this.register_Y);
        return true;
    }

    // STA - Store Accumulator
    processInstruction_STA(): boolean {
        this.store(this.register_A);
        return true;
    }

    private store(value: number) {
        const address = this.currentInstructionAddress!;
        if (LOG_INSTRUCTIONS && address < 0x2000) {
            // Side-effect free peek of internal RAM for the instruction log
            this.instructionResult.target_address_value = this.nes.getRam().read(address & 0x7FF);
        }
        this.nes.write(address, value);
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

        this.pushStack16((this.register_PC - 1) & 0xFFFF);
        this.register_PC = this.currentInstructionAddress!;
        return true;
    }

    // RTS - Return from Subroutine
    processInstruction_RTS(): boolean {
        if (this.currentInstructionCycle <= 3)
            return false;

        this.register_PC = (this.popStack16() + 1) & 0xFFFF;
        return true;
    }

    // RTI - Return from Interrupt
    processInstruction_RTI(): boolean {
        if (this.currentInstructionCycle <= 3)
            return false;

        // RTI restores I immediately; B and bit 5 from the stack are ignored
        this.status_flags = (this.popStack() & ~this.FLAG_BREAK) | this.FLAG_UNUSED;
        this.register_PC = this.popStack16();

        if (this.nes.breakOnRti) {
            this.nes.togglePause();
        }
        return true;
    }

    // ASL - Arithmetic Shift Left
    processInstruction_ASL(): boolean {
        return this.readModifyWrite((value) => {
            const result = (value << 1) & 0xFF;
            this.toggleFlag(this.FLAG_CARRY, (value & 0x80) != 0);
            this.setZN(result);
            return result;
        });
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
        this.addWithCarry(this.loadValue());
        return true;
    }

    // SBC - Subtract with Carry
    processInstruction_SBC(): boolean {
        this.addWithCarry(this.loadValue() ^ 0xFF);
        return true;
    }

    private addWithCarry(value: number) {
        const result = this.register_A + value + (this.status_flags & this.FLAG_CARRY ? 1 : 0);

        this.toggleFlag(this.FLAG_CARRY, result > 0xFF);
        this.toggleFlag(this.FLAG_OVERFLOW, ((result ^ this.register_A) & (result ^ value) & 0x80) != 0);
        this.register_A = result & 0xFF;
        this.setZN(this.register_A);
    }

    private compare(register: number, value: number) {
        this.toggleFlag(this.FLAG_CARRY, register >= value);
        this.setZN((register - value) & 0xFF);
    }

    private setZN(value: number) {
        this.toggleFlag(this.FLAG_ZERO, (value & 0xFF) == 0);
        this.toggleFlag(this.FLAG_NEGATIVE, (value & 0x80) != 0);
    }

    // Read-modify-write: read (cycle 0), dummy write of the original value (cycle 1), final write (cycle 2).
    private readModifyWrite(operation: (value: number) => number): boolean {
        if (this.currentInstructionAddressingMode == AddressingMode.Accumulator) {
            this.register_A = operation(this.register_A) & 0xFF;
            return true;
        }

        if (this.currentInstructionCycle == 0) {
            this.tempAddressArg = this.nes.read(this.currentInstructionAddress!);
            this.instructionResult.target_address_value = this.tempAddressArg;
            return false;
        }

        if (this.currentInstructionCycle == 1) {
            this.nes.write(this.currentInstructionAddress!, this.tempAddressArg);
            return false;
        }

        this.nes.write(this.currentInstructionAddress!, operation(this.tempAddressArg) & 0xFF);
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
        const final_address = (this.register_PC + address) & 0xFFFF;
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
        this.nes.write(this.STACK_START + this.register_SP, value & 0xFF);
        this.register_SP = (this.register_SP - 1) & 0xFF;
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
        this.register_SP = (this.register_SP + 1) & 0xFF;
        const value = this.nes.read(this.STACK_START + this.register_SP);
        return value;
    }


    // Stores and read-modify-write instructions always take the extra indexed-addressing cycle.
    isStoreInstruction(): boolean {
        return this.currentInstructionIsStore;
    }

    NMI() {
        this.pendingNonMaskableInterruptFlag = true;
        //console.log(`NMI triggered on ${numberToHex(this.register_PC)} Instruction: ${this.instructionResult.instructionMetadata?.name}`);
    }

    sampleNmi() {
        this.nmiSampled = this.pendingNonMaskableInterruptFlag;
    }

    // Withdraw an NMI that hasn't been taken yet (PPU $2002 read race at VBL start).
    cancelNMI() {
        this.pendingNonMaskableInterruptFlag = false;
    }

    // Level-triggered IRQ input. `source` is a bitmask (Cpu2A03.IRQ_SOURCE_*). A source must keep its
    // line asserted until the IRQ is acknowledged by the program.
    setIrqLine(source: number, asserted: boolean) {
        if (asserted) {
            this.irqLines |= source;
        }
        else {
            this.irqLines &= ~source;
        }
    }

    // Legacy one-shot IRQ request. Kept for compatibility; prefer setIrqLine().
    IRQ() {
        this.pendingIRQFlag = true;
    }

    getInstructionFunc(instructionOpCode: number): Instruction {
        const instructionData = instructionMap[instructionOpCode];

        let instructionFunc: Instruction | undefined = undefined;

        this.currentInstructionAddressingMode = instructionData.mode;
        this.currentInstructionIsStore = STORE_INSTRUCTIONS.has(instructionData.name);

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
            case "ANC":
                instructionFunc = this.processInstruction_ANC;
                break;
            case "ALR":
                instructionFunc = this.processInstruction_ALR;
                break;
            case "ARR":
                instructionFunc = this.processInstruction_ARR;
                break;
            case "XAA":
                instructionFunc = this.processInstruction_XAA;
                break;
            case "LXA":
                instructionFunc = this.processInstruction_LXA;
                break;
            case "AXS":
                instructionFunc = this.processInstruction_AXS;
                break;
            case "LAS":
                instructionFunc = this.processInstruction_LAS;
                break;
            case "SHY":
                instructionFunc = this.processInstruction_SHY;
                break;
            case "SHX":
                instructionFunc = this.processInstruction_SHX;
                break;
            case "AHX":
                instructionFunc = this.processInstruction_AHX;
                break;
            case "TAS":
                instructionFunc = this.processInstruction_TAS;
                break;
            case "KIL":
                instructionFunc = this.processInstruction_KIL;
                break;

            default:
                throw new Error(`Unknown instruction: ${instructionData.name}`);
        }

        const wrappedInstruction = this.wrapInstruction(instructionFunc, instructionData);

        instructionData.instruction = wrappedInstruction;

        if (instructionData.instruction == undefined) {
            throw new Error(`Unknown instruction: ${instructionData.name}`);
        }

        return wrappedInstruction;
    }

    private wrapInstruction(instructionFunc: Instruction, instructionData: InstructionMetadata) {
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
        return wrappedInstruction;
    }
}
