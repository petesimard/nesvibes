import P5 from "p5";
import { Nes } from "../nes/nes";
import { numberToHex } from "./utils";
import p5 from "p5";
import { InstructionResult } from "../nes/cpu_2A03";
import { AddressingMode } from "../nes/2A03_instruction_map";






// Download test log from logs/nestest.log
async function downloadTestLog() {
    try {
        const response = await fetch('logs/nestest.log');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        return text;
    } catch (error) {
        console.error('Error downloading test log:', error);
        return '';
    }
}

//const testLog = await downloadTestLog();
//const logLines = testLog.split('\n');
const logContainer = document.getElementById('log-container');
const line = document.getElementById('log-line');
const stackContainer = document.getElementById('stack-container');
const patternTable0 = document.getElementById('pattern-table-0') as HTMLCanvasElement;
const patternTable1 = document.getElementById('pattern-table-1') as HTMLCanvasElement;
const nameTable0 = document.getElementById('name-table-0') as HTMLCanvasElement;
const breakNmi = document.getElementById('break-nmi') as HTMLInputElement;
const breakRti = document.getElementById('break-sti') as HTMLInputElement;
const breakInstruction = document.getElementById('break-instruction') as HTMLInputElement;
const breakCycle = document.getElementById('break-cycle') as HTMLInputElement;
const pauseResumeButton = document.getElementById('pause-resume');
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const stepButton = document.getElementById('step') as HTMLButtonElement;
const paletteView = document.getElementById('palette-view');
const paletteCells: HTMLDivElement[] = [];

// Create 32 8x8 divs for palette view
if (paletteView) {
    paletteView.style.display = 'grid';
    paletteView.style.gridTemplateColumns = 'repeat(4, 32px)';
    paletteView.style.gap = '1px';

    for (let i = 0; i < 32; i++) {
        const paletteCell = document.createElement('div');
        paletteCell.style.width = '32px';
        paletteCell.style.height = '32px';
        paletteCell.style.backgroundColor = '#000000';
        paletteCell.style.border = '1px solid #222';
        paletteView.appendChild(paletteCell);
        paletteCells.push(paletteCell);
    }
}


const logMessages: string[] = [];
const instructionLogMessages: InstructionResult[] = [];

export class NesVibes {
    private p5: P5;
    private scale: number;
    private nes: Nes;

    private currentRenderedFrame: p5.Image;
    private nextRenderedFrame: p5.Image;

    constructor(scale: number = 1) {
        this.scale = scale;

        const sketch = (p5: P5) => {
            p5.setup = () => {
                const canvas = document.getElementById('canvas')!;
                p5.createCanvas(256 * scale, 240 * scale).parent(canvas);
                p5.background(0);
            };
        };

        const onRenderedPixel = (x: number, y: number, finalColor: number[]) => {
            this.nextRenderedFrame.set(x, y, finalColor)

            if (x == 255 && y == 239) {
                const oldFrame = this.currentRenderedFrame;
                this.currentRenderedFrame = this.nextRenderedFrame;
                this.currentRenderedFrame.updatePixels();
                this.nextRenderedFrame = oldFrame;
            }
        }

        this.p5 = new P5(sketch);
        this.nes = new Nes((message: string) => {
            if (!logContainer)
                return;

            logMessages.push(message);
            if (logMessages.length > 100000) {
                logMessages.shift();
            }

            if (!this.nes.isPaused())
                return;

            this.updateLogWindow();
        },
            (instruction: InstructionResult) => {
                instructionLogMessages.push(instruction);

                if (instructionLogMessages.length > 20000) {
                    instructionLogMessages.shift();
                }
            },

            onRenderedPixel);

        this.currentRenderedFrame = this.p5.createImage(256, 240);
        this.nextRenderedFrame = this.p5.createImage(256, 240);

        this.nes.onPausedListeners.push(() => {
            this.updateDebug();

            pauseResumeButton!.textContent = this.nes.isPaused() ? 'Resume' : 'Pause';
            pauseResumeButton!.style.backgroundColor = !this.nes.isPaused() ? 'green' : 'red';

            if (stepButton) {
                stepButton.disabled = !this.nes.isPaused();
            }

        });

        if (stepButton) {
            stepButton.addEventListener('click', () => {
                this.nes.clock(true);
                this.updateDebug();
            });
        }

        // Add pause/resume functionality
        if (pauseResumeButton) {
            pauseResumeButton.addEventListener('click', () => {
                this.nes.togglePause();
                pauseResumeButton!.textContent = this.nes.isPaused() ? 'Resume' : 'Pause';
                pauseResumeButton!.style.backgroundColor = !this.nes.isPaused() ? 'green' : 'red';

            });
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => {
                this.nes.onReset();
                logMessages.length = 0;
                this.updateLogWindow();
            });
        }

        if (breakNmi) {
            breakNmi.addEventListener('change', () => {
                this.nes.toggleBreakOnNmi(breakNmi.checked);
            });

            if (breakNmi.checked) {
                this.nes.toggleBreakOnNmi(true);
            }
        }

        if (breakRti) {
            breakRti.addEventListener('change', () => {
                this.nes.toggleBreakOnRti(breakRti.checked);
            });
        }

    }

    private updateDebug() {
        this.updateDebugDisplay();
        this.updateLogWindow();
        this.updatePatternTables();
        this.updatePaletteView();
    }

    private instructionResultToLogMessage(instructionResult: InstructionResult): string {
        let instructionTargetAddress = '';

        //CFEA  A1 80     LDA ($80,X) @ 83 = 0303 = 5C    A:5B X:03 Y:69 P:25 SP:FB PPU: 22,217 CYC:2573

        if (instructionResult.target_address != undefined) {
            if (instructionResult.instructionMetadata?.mode == AddressingMode.IndirectX || instructionResult.instructionMetadata?.mode == AddressingMode.IndirectY) {
                instructionTargetAddress += '($' + numberToHex(instructionResult.indirectOffsetBase!) + ',';
                if (instructionResult.instructionMetadata?.mode == AddressingMode.IndirectX)
                    instructionTargetAddress += 'X)';
                else
                    instructionTargetAddress += 'Y)';

                instructionTargetAddress += ' @ ' + numberToHex(instructionResult.indirectOffset!);
                instructionTargetAddress += ' = ' + numberToHex(instructionResult.target_address!).padStart(4, '0');
            }
            else {

                if (instructionResult.instructionMetadata?.mode == AddressingMode.Immediate)
                    instructionTargetAddress += '#' + instructionTargetAddress;

                instructionTargetAddress += '$' + numberToHex(instructionResult.target_address!);
            }
        }

        // pad the instruction bytes to 3 characters
        let instructionBytesString = instructionResult.instructionBytes.map(b => numberToHex(b)).join(" ");
        instructionBytesString = instructionBytesString.padEnd(9, ' ');

        let decodedInstruction = instructionResult.instructionMetadata?.name + ' ' + instructionTargetAddress;

        if (instructionResult.target_address_memory != undefined) {
            decodedInstruction += ' = ' + numberToHex(instructionResult.target_address_memory);
        }
        decodedInstruction = decodedInstruction.padEnd(31, ' ');

        const result = `${numberToHex(instructionResult.register_PC).toString().padEnd(5, ' ')} ${instructionBytesString} ${decodedInstruction} A:${numberToHex(instructionResult.register_A)} X:${numberToHex(instructionResult.register_X)} Y:${numberToHex(instructionResult.register_Y)} P:${numberToHex(instructionResult.status_flags)} SP:${numberToHex(instructionResult.register_SP)} PPU:${instructionResult.ppu_scanline.toString().padStart(3, ' ')},${instructionResult.ppu_dot.toString().padStart(3, ' ')} CYC:${instructionResult.cycles}`;

        return result;

    }

    private updateLogWindow() {

        logMessages.length = 0;

        instructionLogMessages.forEach(instruction => {
            logMessages.push(this.instructionResultToLogMessage(instruction));
        });

        line!.textContent = logMessages.join('\n');
        logContainer!.scrollTop = logContainer!.scrollHeight;
    }

    async setup(rom: string) {
        await this.loadROM(rom);
        this.nes.onReset();

        this.updatePatternTables();

        const ctx3 = nameTable0.getContext('2d');

        this.p5.draw = () => {
            this.p5.background(0);
            this.p5.scale(this.scale).noSmooth();

            this.p5.fill(255, 0, 0);
            this.p5.image(this.currentRenderedFrame, 0, 0);


            ctx3!.putImageData(this.nes.getPpu().getNameTableImage(0), 0, 0);

            for (let i = 0; i < 100000; i++) {
                try {
                    this.nes.clock();
                } catch (error) {
                    this.nes.togglePause();
                    throw error;
                }
            }
        }
    }

    updatePatternTables() {
        if (!patternTable0 || !patternTable1)
            return;


        const ctx0 = patternTable0.getContext('2d');
        const ctx1 = patternTable1.getContext('2d');
        const ctx3 = nameTable0.getContext('2d');

        if (!ctx0 || !ctx1 || !ctx3)
            return;

        ctx0.putImageData(this.nes.getPpu().getPatternTableImage(0), 0, 0);
        ctx1.putImageData(this.nes.getPpu().getPatternTableImage(1), 0, 0);
        ctx3.putImageData(this.nes.getPpu().getNameTableImage(0), 0, 0);
    }

    updatePaletteView() {
        if (!paletteView)
            return;

        for (let i = 0; i < 32; i++) {
            const color = this.nes.getPpu().getPalette(i);
            const bgColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            paletteCells[i].style.backgroundColor = bgColor;
        }

    }

    private updateDebugDisplay() {

        const regA = document.getElementById('reg-a');
        const regX = document.getElementById('reg-x');
        const regY = document.getElementById('reg-y');
        const regP = document.getElementById('reg-p');
        const regSP = document.getElementById('reg-sp');
        const regPC = document.getElementById('reg-pc');
        const regCycles = document.getElementById('reg-cycles');


        if (regA) regA.textContent = numberToHex(this.nes.getCpu().getA());
        if (regX) regX.textContent = numberToHex(this.nes.getCpu().getX());
        if (regY) regY.textContent = numberToHex(this.nes.getCpu().getY());
        if (regP) regP.textContent = numberToHex(this.nes.getCpu().getP());
        if (regSP) regSP.textContent = numberToHex(this.nes.getCpu().getSP());
        if (regPC) regPC.textContent = numberToHex(this.nes.getCpu().getPC());
        if (regCycles) regCycles.textContent = this.nes.getCpu().getCycles().toString();

        const regPPUCTRL = document.getElementById('reg-ppuctrl');
        const regPPUMASK = document.getElementById('reg-ppumask');
        const regPPUSTATUS = document.getElementById('reg-ppustatus');
        const regPPU_T = document.getElementById('reg-ppu_t');
        const regPPU_V = document.getElementById('reg-ppu_v');
        const regPPU_Scanline = document.getElementById('reg-ppu_scanline');
        const regPPU_Dot = document.getElementById('reg-ppu_dot');
        const regPPU_XScroll = document.getElementById('reg-ppu_xscroll');
        const regPPU_YScroll = document.getElementById('reg-ppu_yscroll');

        if (regPPUCTRL) regPPUCTRL.textContent = numberToHex(this.nes.getPpu().register_PPUCTRL);
        if (regPPUMASK) regPPUMASK.textContent = numberToHex(this.nes.getPpu().register_PPUMASK);
        if (regPPUSTATUS) regPPUSTATUS.textContent = numberToHex(this.nes.getPpu().register_PPUSTATUS);
        if (regPPU_T) regPPU_T.textContent = numberToHex(this.nes.getPpu().register_internal_T);
        if (regPPU_V) regPPU_V.textContent = numberToHex(this.nes.getPpu().register_internal_V);
        if (regPPU_Scanline) regPPU_Scanline.textContent = this.nes.getPpu().current_scanline.toString();
        if (regPPU_Dot) regPPU_Dot.textContent = this.nes.getPpu().current_dot.toString();
        if (regPPU_XScroll) regPPU_XScroll.textContent = this.nes.getPpu().xScroll().toString();
        if (regPPU_YScroll) regPPU_YScroll.textContent = this.nes.getPpu().yScroll().toString();

        if (stackContainer) {
            const stackStart = 0x01FF;
            const stackEnd = 0x0100;

            let stackOutput = "";

            for (let i = stackStart; i >= stackEnd; i--) {
                const stackValue = this.nes.read(i);
                stackOutput += numberToHex(i) + ": " + numberToHex(stackValue) + "\n";
            }

            stackContainer.textContent = stackOutput;
        }
    }

    async loadROM(url: string) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        this.nes.loadROM(uint8Array);
    }
}
