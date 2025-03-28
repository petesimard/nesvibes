import P5 from "p5";
import { Nes } from "../nes/nes";
import { numberToHex } from "./utils";
import p5 from "p5";
import { InstructionResult } from "../nes/cpu_2A03";
import { AddressingMode } from "../nes/2A03_instruction_map";


class RingBuffer<T> {
    private buffer: Array<T | null>;
    private index = 0;
    private full = false;

    constructor(private size: number) {
        this.buffer = new Array<T | null>(size).fill(null);
    }

    add(item: T) {
        this.buffer[this.index] = item;
        this.index = (this.index + 1) % this.size;
        if (this.index === 0) this.full = true;
    }

    getAll(): T[] {
        if (!this.full) return this.buffer.slice(0, this.index) as T[];
        return [
            ...this.buffer.slice(this.index),
            ...this.buffer.slice(0, this.index),
        ] as T[];
    }
}



const logContainer = document.getElementById('log-container');
const line = document.getElementById('log-line');
const stackContainer = document.getElementById('stack-container');
const patternTable0 = document.getElementById('pattern-table-0') as HTMLCanvasElement;
const patternTable1 = document.getElementById('pattern-table-1') as HTMLCanvasElement;
const nameTable0 = document.getElementById('name-table-0') as HTMLCanvasElement;
const nameTable1 = document.getElementById('name-table-1') as HTMLCanvasElement;
const nameTable2 = document.getElementById('name-table-2') as HTMLCanvasElement;
const nameTable3 = document.getElementById('name-table-3') as HTMLCanvasElement;
const breakNmi = document.getElementById('break-nmi') as HTMLInputElement;
const breakRti = document.getElementById('break-sti') as HTMLInputElement;
const breakInstruction = document.getElementById('break-instruction') as HTMLInputElement;
const breakCycle = document.getElementById('break-cycle') as HTMLInputElement;
const pauseResumeButton = document.getElementById('pause-resume');
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const stepButton = document.getElementById('step') as HTMLButtonElement;
const paletteView = document.getElementById('palette-view');
const spriteView = document.getElementById('sprite-view');
const patternTable0Context = patternTable0.getContext('2d');
const patternTable1Context = patternTable1.getContext('2d');
const nameTable0Context = nameTable0.getContext('2d');
const nameTable1Context = nameTable1.getContext('2d');
const nameTable2Context = nameTable2.getContext('2d');
const nameTable3Context = nameTable3.getContext('2d');

const paletteCells: HTMLDivElement[] = [];
const spriteCells: HTMLDivElement[] = [];
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

if (spriteView) {
    spriteView.style.display = 'grid';
    spriteView.style.gridTemplateColumns = 'repeat(8, 33px)';
    spriteView.style.gap = '1px';

    for (let i = 0; i < 64; i++) {
        const spriteCell = document.createElement('div');
        spriteCell.style.width = '26px';
        spriteCell.style.height = '26px';
        spriteCell.style.backgroundColor = '#000000';
        spriteView.appendChild(spriteCell);
        spriteCells.push(spriteCell);
    }
}


const logMessages: string[] = [];
const instructionLogMessages: RingBuffer<InstructionResult> = new RingBuffer<InstructionResult>(100000);

export class NesVibes {
    private p5: P5;
    private scale: number;
    private nes: Nes;

    private frameBufferImage: p5.Image;

    private lastFpsUpdate: number = 0;
    private cachedFps: number = 0;
    private fpsAccumulator: number = 0;
    private frameCount: number = 0;

    controller1State: number = 0;
    controller1LatchedState: number = 0;
    controllerReadIndex: number = 0;
    lastFrameTime: number = 0;
    overscan: boolean = true;

    constructor(scale: number = 1) {
        this.scale = scale;

        const sketch = (p5: P5) => {
            p5.setup = () => {
                const canvas = document.getElementById('canvas')!;
                p5.createCanvas(256 * scale, (240 - (this.overscan ? 16 : 0)) * scale).parent(canvas);
                p5.background(0);
                p5.frameRate(60);
            };
        };

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);


        const getControllerState = (controllerNumber: number): number => {
            const result = (this.controller1LatchedState & (1 << this.controllerReadIndex)) != 0 ? 1 : 0;
            this.controllerReadIndex++;
            return result;
        }

        const latchControllerStates = (): void => {
            this.controller1LatchedState = this.controller1State;
            this.controllerReadIndex = 0;
        }

        this.p5 = new P5(sketch);
        this.nes = new Nes(this.overscan,
            (message: string) => {
                if (!logContainer)
                    return;

                logMessages.push(message);
                if (logMessages.length > 50000) {
                    logMessages.shift();
                }

                if (!this.nes.isPaused())
                    return;

                this.updateLogWindow();
            },
            (instruction: InstructionResult) => {
                instructionLogMessages.add(instruction);
            },

            latchControllerStates,
            getControllerState,
        );

        this.frameBufferImage = this.p5.createImage(256, 240 - (this.overscan ? 16 : 0));

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
        this.updateSpriteView();
    }

    private instructionResultToLogMessage(instructionResult: InstructionResult): string {
        let instructionTargetAddress = '';

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

        const instructions = instructionLogMessages.getAll();

        instructions.forEach(instruction => {
            logMessages.push(this.instructionResultToLogMessage(instruction));
        });

        line!.textContent = logMessages.join('\n');
        logContainer!.scrollTop = logContainer!.scrollHeight;
    }

    async setup(rom: string) {
        await this.loadROMFromURL(rom);
        this.nes.onReset();
        await this.nes.initialize();

        this.lastFrameTime = performance.now();

        this.frameBufferImage.loadPixels();
        for (let i = 0; i < this.frameBufferImage.pixels.length; i++) {
            if (i % 4 == 3)
                this.frameBufferImage.pixels[i] = 255;
        }
        this.frameBufferImage.updatePixels();


        this.p5.draw = () => {
            this.p5.background(0);
            this.p5.scale(this.scale).noSmooth();

            //this.frameBufferImage.loadPixels();
            this.nes.outputBuffer = this.frameBufferImage.pixels;

            while (!this.nes.frameReady && !this.nes.isPaused()) {
                try {
                    this.nes.clock();
                } catch (error) {
                    this.nes.togglePause();
                    throw error;
                }
            }

            this.frameBufferImage.updatePixels();
            this.p5.image(this.frameBufferImage, 0, 0);

            // Calculate running average FPS
            const currentTime = performance.now();
            const currentFps = this.p5.frameRate();
            this.fpsAccumulator += currentFps;
            this.frameCount++;

            if (currentTime - this.lastFpsUpdate > 500) {
                this.cachedFps = Math.round(this.fpsAccumulator / this.frameCount);
                this.lastFpsUpdate = currentTime;
                this.fpsAccumulator = 0;
                this.frameCount = 0;
            }

            // Draw FPS counter in top right
            this.p5.fill(255);
            this.p5.noStroke();
            this.p5.textAlign(this.p5.RIGHT, this.p5.TOP);
            this.p5.textSize(5);
            this.p5.text(`FPS: ${this.cachedFps}`, (this.p5.width / this.scale) - 2, 2);

            this.nes.frameReady = false;
            this.lastFrameTime = currentTime;
        }
    }

    updatePatternTables() {
        if (!patternTable0 || !patternTable1)
            return;


        if (!patternTable0Context || !patternTable1Context || !nameTable0Context || !nameTable1Context || !nameTable2Context || !nameTable3Context)
            return;

        patternTable0Context.putImageData(this.nes.getPpu().getPatternTableImage(0), 0, 0);
        patternTable1Context.putImageData(this.nes.getPpu().getPatternTableImage(1), 0, 0);
        nameTable0Context.putImageData(this.nes.getPpu().getNameTableImage(0), 0, 0);
        nameTable1Context.putImageData(this.nes.getPpu().getNameTableImage(1), 0, 0);
        nameTable2Context.putImageData(this.nes.getPpu().getNameTableImage(2), 0, 0);
        nameTable3Context.putImageData(this.nes.getPpu().getNameTableImage(3), 0, 0);
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

    updateSpriteView() {
        if (!spriteView)
            return;

        for (let i = 0; i < 64; i++) {
            const [sprite, tileNumber] = this.nes.getPpu().getSprite(i);
            // Clear existing content
            spriteCells[i].innerHTML = '';

            // Create canvas element
            const canvas = document.createElement('canvas');
            canvas.width = sprite.width;
            canvas.height = sprite.height;
            canvas.style.width = '32px';
            canvas.style.height = '48px';
            canvas.style.imageRendering = 'pixelated';


            // Get context and draw sprite image data
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.putImageData(sprite, 0, 0);
            }

            spriteCells[i].appendChild(canvas);

            // Add tile number text below sprite
            const tileText = document.createElement('div');
            tileText.textContent = `${tileNumber}`;
            tileText.style.fontSize = '10px';
            tileText.style.textAlign = 'center';
            tileText.style.color = '#888';
            spriteCells[i].appendChild(tileText);
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

    async loadROMFromURL(url: string) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        await this.nes.loadROM(uint8Array);
    }


    private handleKeyDown = (event: KeyboardEvent) => {
        switch (event.key.toLowerCase()) {
            case 'p': // A
                this.controller1State |= 0x1;
                break;
            case 'o': // B
                this.controller1State |= 0x2;
                break;
            case '\\': // Select
                this.controller1State |= 0x4;
                break;
            case 'enter': // Start
                this.controller1State |= 0x8;
                break;
            case 'w': // Up
                this.controller1State |= 0x10;
                break;
            case 's': // Down
                this.controller1State |= 0x20;
                break;
            case 'a': // Left
                this.controller1State |= 0x40;
                break;
            case 'd': // Right
                this.controller1State |= 0x80;
                break;
        }
    }

    private handleKeyUp = (event: KeyboardEvent) => {
        switch (event.key.toLowerCase()) {
            case 'p': // A
                this.controller1State &= ~0x1;
                break;
            case 'o': // B
                this.controller1State &= ~0x2;
                break;
            case '\\': // Select
                this.controller1State &= ~0x4;
                break;
            case 'enter': // Start
                this.controller1State &= ~0x8;
                break;
            case 'w': // Up
                this.controller1State &= ~0x10;
                break;
            case 's': // Down
                this.controller1State &= ~0x20;
                break;
            case 'a': // Left
                this.controller1State &= ~0x40;
                break;
            case 'd': // Right
                this.controller1State &= ~0x80;
                break;
        }
    }

}

