def parse_rgb_line(line):
    # Split the line into RGB values (3 characters each)
    values = [line[i:i+3] for i in range(0, len(line.strip()), 3)]
    rgb_values = []
    
    for value in values:
        if len(value.strip()) == 3:  # Only process complete RGB groups
            # Convert each character to its decimal value
            r = ord(value[0])
            g = ord(value[1])
            b = ord(value[2])
            rgb_values.append([r, g, b])
    
    return rgb_values

def convert_palette_to_ts():
    palette_data = []
    
    with open('paletts/2C02G_wiki.pal', 'rb') as f:
        # Read the entire file as bytes
        data = f.read()
        
        # Process 3 bytes at a time for RGB values
        for i in range(0, len(data), 3):
            r = data[i]
            g = data[i + 1]
            b = data[i + 2]
            palette_data.append([r, g, b])

    # Generate TypeScript output
    ts_output = "// Auto-generated from 2C02G_wiki.pal\n\n"
    ts_output += "export const NES_PALETTE = [\n"
    
    for rgb in palette_data:
        ts_output += f"  [{rgb[0]}, {rgb[1]}, {rgb[2]}],\n"
    
    ts_output += "] as const;\n"
    
    # Write the TypeScript file
    with open('src/nes/palette.ts', 'w') as f:
        f.write(ts_output)
    
    print("Palette converted to TypeScript successfully.")

if __name__ == "__main__":
    convert_palette_to_ts() 