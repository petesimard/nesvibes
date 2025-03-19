import P5 from "p5";
import { Nes } from "../nes/nes";
import { numberToHex } from "./utils";


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
const line = document.createElement('p');
logContainer!.appendChild(line);
const stackContainer = document.getElementById('stack-container');
const patternTable0 = document.getElementById('pattern-table-0');
const patternTable1 = document.getElementById('pattern-table-1');

const breakNmi = document.getElementById('break-nmi') as HTMLInputElement;
const breakRti = document.getElementById('break-sti') as HTMLInputElement;
const breakInstruction = document.getElementById('break-instruction') as HTMLInputElement;
const breakCycle = document.getElementById('break-cycle') as HTMLInputElement;
const pauseResumeButton = document.getElementById('pause-resume');
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const stepButton = document.getElementById('step') as HTMLButtonElement;
const logMessages: string[] = [];


export class NesVibes {
    private p5: P5;
    private scale: number;
    private nes: Nes;

    constructor(scale: number = 1) {
        this.scale = scale;

        const sketch = (p5: P5) => {
            p5.setup = () => {
                const canvas = document.getElementById('canvas')!;
                p5.createCanvas(256 * scale, 240 * scale).parent(canvas);
                p5.background(0);
            };
        };

        this.p5 = new P5(sketch);
        this.nes = new Nes((message: string) => {
            if (!logContainer)
                return;

            logMessages.push(message);
            if (logMessages.length > 20000) {
                logMessages.shift();
            }

            if (!this.nes.isPaused())
                return;

            this.updateLogWindow();
        });

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
            });
        }

        if (breakNmi) {
            breakNmi.addEventListener('change', () => {
                this.nes.toggleBreakOnNmi(breakNmi.checked);
            });
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
    }

    private updateLogWindow() {
        line.textContent = logMessages.join('\n');
        logContainer!.scrollTop = logContainer!.scrollHeight;
    }

    async setup(rom: string) {
        await this.loadROM(rom);
        this.nes.onReset();

        this.updatePatternTables();


        this.p5.draw = () => {
            this.p5.background(0);
            this.p5.scale(this.scale);

            for (let i = 0; i < 10000; i++) {
                this.nes.clock();
            }
            this.p5.fill(255, 0, 0);
        }

    }
    updatePatternTables() {
        if (!patternTable0 || !patternTable1)
            return;

        const patternTable0Canvas = patternTable0 as HTMLCanvasElement;
        const patternTable1Canvas = patternTable1 as HTMLCanvasElement;

        const ctx0 = patternTable0Canvas.getContext('2d');
        const ctx1 = patternTable1Canvas.getContext('2d');

        if (!ctx0 || !ctx1)
            return;

        ctx0.putImageData(this.nes.getPpu().getPatternTableImage(0), 0, 0);
        ctx1.putImageData(this.nes.getPpu().getPatternTableImage(1), 0, 0);
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
