import re
from typing import NamedTuple, Optional

class LogLine(NamedTuple):
    address: str
    instruction: str
    command: str
    reg_a: str
    reg_x: str
    reg_y: str
    reg_p: str
    reg_sp: str
    ppu: str
    cyc: int

def parse_log_line(line: str) -> Optional[LogLine]:
    # Skip empty lines
    if not line.strip():
        return None
        
    # Example line:
#C9A6  18        CLC                             A:9F X:00 Y:00 P:A5 SP:FB PPU:  5,293 CYC:666
    
    # Split line into parts based on fixed positions
    address = line[0:4].strip()
    instruction = line[6:8].strip()
    command = line[10:20].strip()
    reg_a = line[50:52]
    reg_x = line[55:57]
    reg_y = line[60:62]
    reg_p = line[65:67]
    reg_sp = line[70:72]
    ppu = line[80:86].strip()
    cyc = line[90:95]
    
    return LogLine(
        address=address,
        instruction=instruction,
        command=command,
        reg_a=reg_a,
        reg_x=reg_x,
        reg_y=reg_y,
        reg_p=reg_p,
        reg_sp=reg_sp,
        ppu=ppu,
        cyc=cyc
    )


def compare_logs(reference_log: str, test_log: str) -> None:
    """Compare two NES test logs and find where they diverge."""
    
    with open(reference_log, 'r') as f:
        reference_lines = [line.strip() for line in f if line.strip()]
    
    with open(test_log, 'r') as f:
        test_lines = [line.strip() for line in f if line.strip()]
    

    # Skip first line of both logs
    reference_lines = reference_lines[1:]
    test_lines = test_lines[1:]

    for i, (ref_line, test_line) in enumerate(zip(reference_lines, test_lines), 2):  # Start from 2 since we skipped line 1
        ref_parsed = parse_log_line(ref_line)
        test_parsed = parse_log_line(test_line)
        
        if not ref_parsed or not test_parsed:
            print(f"Error parsing line {i}")
            continue
            
        if (ref_parsed.address != test_parsed.address or
            ref_parsed.instruction != test_parsed.instruction or
            ref_parsed.reg_a != test_parsed.reg_a or
            ref_parsed.reg_x != test_parsed.reg_x or
            ref_parsed.reg_y != test_parsed.reg_y or
            ref_parsed.reg_p != test_parsed.reg_p or
            ref_parsed.reg_sp != test_parsed.reg_sp or
            ref_parsed.cyc != test_parsed.cyc):
            
            print(f"\nDivergence found at line {i}:")
            print("Reference:", ref_line)
            print("Test:     ", test_line)
            print("\nDifferences:")
            
            if ref_parsed.address != test_parsed.address:
                print(f"Address: {ref_parsed.address} vs {test_parsed.address}")
            if ref_parsed.instruction != test_parsed.instruction:
                print(f"Instruction: {ref_parsed.instruction} vs {test_parsed.instruction}")
            if ref_parsed.reg_a != test_parsed.reg_a:
                print(f"A: {ref_parsed.reg_a} vs {test_parsed.reg_a}")
            if ref_parsed.reg_x != test_parsed.reg_x:
                print(f"X: {ref_parsed.reg_x} vs {test_parsed.reg_x}")
            if ref_parsed.reg_y != test_parsed.reg_y:
                print(f"Y: {ref_parsed.reg_y} vs {test_parsed.reg_y}")
            if ref_parsed.reg_p != test_parsed.reg_p:
                print(f"P: {ref_parsed.reg_p} vs {test_parsed.reg_p}")
            if ref_parsed.reg_sp != test_parsed.reg_sp:
                print(f"SP: {ref_parsed.reg_sp} vs {test_parsed.reg_sp}")
            if ref_parsed.cyc != test_parsed.cyc:
                print(f"CYC: {ref_parsed.cyc} vs {test_parsed.cyc}")
            break

    # Check if one log is longer than the other (excluding first line)
    if len(reference_lines) != len(test_lines):
        print(f"\nLog lengths differ:")
        print(f"Reference log: {len(reference_lines)} lines")
        print(f"Test log: {len(test_lines)} lines")

if __name__ == "__main__":
    compare_logs("public/logs/test_w.log", "public/logs/test.log") 