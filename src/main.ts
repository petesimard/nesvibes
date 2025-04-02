import { NesVibes } from './emulator/emulator';

const nesVibes = new NesVibes();
//const rom = "r/Zelda - The Legend of Zelda.zip";
const rom = "r/smb1.zip";
//const rom = "roms/Super Mario Bros. 2 (USA).nes";

declare global {
    interface Window {
        startEmulator: () => void;
        loadRom: (url: string) => void;
        handleCustomRomUpload: (event: Event) => void;
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

window.handleCustomRomUpload = async function (event: Event) {
    const fileInput = event.target as HTMLInputElement;
    if (!fileInput)
        return;

    if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();

        reader.onload = function (e) {
            const romData = e.target?.result; // This will be an ArrayBuffer
            if (!romData)
                return;
            nesVibes.setup(romData);
        };

        reader.onerror = function (e) {
            console.error("Error reading file:", e);
            alert("Failed to read the ROM file.");
        };

        reader.readAsArrayBuffer(file); // Read the file as binary data
        fileInput.value = '';
    }
}
