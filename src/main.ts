import { NesVibes } from './emulator/emulator';

const nesVibes = new NesVibes();
//const rom = "r/Zelda - The Legend of Zelda.zip";
const rom = "roms/Super Mario Bros. 2 (Europe).zip";
//const rom = "roms/nestest.nes";

declare global {
    interface Window {
        startEmulator: () => void;
        loadRom: (url: string) => void;
    }
}

window.startEmulator = function () {
    (async () => {
        await nesVibes.setup(rom);
    })();
}

window.loadRom = async function (url: string) {
    await nesVibes.setup(url);
}