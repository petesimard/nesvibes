
import { NesVibes } from './emulator/emulator';



const nesVibes = new NesVibes();
//const rom = "roms/Super Mario Bros. 3 (USA).zip";
//const rom = "roms/nes-test-roms/mmc3_test/1-clocking.nes";
const rom = "roms/volumes.nes";

(async () => {
    await nesVibes.setup(rom);
})();

// Set window title to rom name
document.title = rom;