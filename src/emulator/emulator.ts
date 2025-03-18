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

const testLog = await downloadTestLog();
const logLines = testLog.split('\n');
let logLineCount = 0;

function log(message: string) {
    const logContainer = document.getElementById('log-container');
    if (!logContainer)
        return;


    const line = document.createElement('p');

    line.textContent = message;
    logContainer.appendChild(line);

    // Get the matching line from test log for comparison
    let expectedLogLine = logLines[logLineCount]?.trim() || '';

    // If we have an expected line, show both actual and expected
    if (expectedLogLine && logLineCount > 0) {

        // Parse values from expected and actual lines
        const parseLogLine = (line: string) => {
            const matches = line.match(/^([A-F0-9]{4})\s+.*\s+A:([A-F0-9]{2})\s+X:([A-F0-9]{2})\s+Y:([A-F0-9]{2})\s+P:([A-F0-9]{2})\s+SP:([A-F0-9]{2}).*CYC:(\d+)/);
            if (!matches) return null;
            return {
                address: matches[1],
                regA: matches[2],
                regX: matches[3],
                regY: matches[4],
                flags: matches[5],
                sp: matches[6],
                cycles: parseInt(matches[7])
            };
        };

        const expectedValues = parseLogLine(expectedLogLine);
        const actualValues = parseLogLine(message);

        let mismatch = false;
        if (expectedValues && actualValues) {
            mismatch = expectedValues.address !== actualValues.address ||
                expectedValues.regA !== actualValues.regA ||
                expectedValues.regX !== actualValues.regX ||
                expectedValues.regY !== actualValues.regY ||
                expectedValues.flags !== actualValues.flags ||
                expectedValues.sp !== actualValues.sp ||
                expectedValues.cycles !== actualValues.cycles;
        }

        if (mismatch) {
            const expectedLine = document.createElement('p');
            expectedLine.style.color = 'red';
            expectedLogLine = expectedLogLine.substring(0, 20) + expectedLogLine.substring(37);
            expectedLine.textContent = `${expectedLogLine}`;
            logContainer.appendChild(expectedLine);
            throw new Error('Mismatch');
        }
    }

    logContainer.scrollTop = logContainer.scrollHeight;
    logLineCount++;
}



export class NesVibes {
    private p5: P5;
    private scale: number;
    private nes: Nes;

    constructor(scale: number = 1) {
        this.scale = scale;

        const sketch = (p5: P5) => {
            p5.setup = () => {
                p5.createCanvas(256 * scale, 240 * scale);
                p5.background(0);
            };
        };

        this.p5 = new P5(sketch);
        this.nes = new Nes(log);
    }

    async setup() {
        await this.loadROM("roms/nestest.nes");
        this.nes.onReset();

        const stackContainer = document.getElementById('stack-container');

        this.p5.draw = () => {
            this.p5.background(0);
            this.p5.scale(this.scale);

            for (let i = 0; i < 500; i++) {
                this.nes.clock();
                this.updateStackDisplay(stackContainer);
            }
            this.p5.fill(255, 0, 0);
            this.p5.circle(256 / 2, 240 / 2, 100);

        }

    }


    private updateStackDisplay(stackContainer: HTMLElement | null) {
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
