# NESVibes - A Cycle-Accurate NES Emulator in TypeScript

NESVibes is a Nintendo Entertainment System (NES) emulator written in TypeScript that aims to provide cycle-accurate emulation of the original hardware. The emulator strives to replicate the behavior of the NES at the hardware level, ensuring accurate timing.

# What's working

- CPU
- PPU 
- Cartridge loading
- Mapper 0, 1, 4

# What's not working

- Other mappers
- APU
- Some MMC3 games have improper IRQ timing

## Development

This project is built using:

- TypeScript for type-safe code
- Modern web technologies
- TailwindCSS for styling

## Building and Running

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Contributing

Contributions are welcome! Please feel free to submit pull requests, report bugs, or suggest features.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Thanks to the NES dev community for their extensive documentation
- Special thanks to the authors of various technical documents about NES hardware
- Inspired by other cycle-accurate emulators in the community

## Status

This is an active project under development. While many features are implemented and working, there's always room for improvement in accuracy and compatibility. 