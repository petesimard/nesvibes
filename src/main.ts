
import { NesVibes } from './emulator/emulator';



const nesVibes = new NesVibes(3);
//const rom = "roms/nestest.nes";
const rom = "roms/Donkey Kong Jr..nes";
nesVibes.setup(rom);

// Set window title to rom name
document.title = rom;