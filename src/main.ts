
import { NesVibes } from './emulator/emulator';



const nesVibes = new NesVibes(3);
const rom = "roms/Super Mario Bros. 3 (USA).zip";
//const rom = "roms/smb1.zip";

(async () => {
    await nesVibes.setup(rom);
})();

// Set window title to rom name
document.title = rom;