
import { NesVibes } from './emulator/emulator';



const nesVibes = new NesVibes(3);
//const rom = "roms/volumes.nes";
const rom = "roms/Zelda - The Legend of Zelda.zip";
//const rom = "roms/smb1.zip";

(async () => {
    await nesVibes.setup(rom);
})();

// Set window title to rom name
document.title = rom;