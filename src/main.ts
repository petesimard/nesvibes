import { NesVibes } from './emulator/emulator';
import { AudioManager } from './audio/audio-manager';

const nesVibes = new NesVibes();
const rom = "roms/Super Mario Bros. 3 (USA).zip";
//const rom = "roms/Super Mario Bros. 2 (Europe).zip";
//const rom = "roms/square.nes";

declare global {
    interface Window {
        startEmulator: () => void;
    }
}

window.startEmulator = function () {
    (async () => {
        await nesVibes.setup(rom);
    })();
}

// Set window title to rom name
document.title = rom;
