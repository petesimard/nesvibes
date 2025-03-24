
import { NesVibes } from './emulator/emulator';



const nesVibes = new NesVibes(3);
//const rom = "roms/nestest.nes";
//const rom = "roms/Donkey Kong Jr..nes";
const rom = "roms/nes-test-roms/sprite_hit_tests_2005.10.05/11.edge_timing.nes";

(async () => {
    await nesVibes.setup(rom);
})();

// Set window title to rom name
document.title = rom;