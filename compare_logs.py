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
        
    # Regular expression to match the log format
    pattern = r'''
        \s*(\w+)\s+                    # Address
        ((?:[0-9A-F]{2}\s*)+)\s+      # Instruction bytes
        ([^A:]+)                       # Command
        A:([0-9A-F]{2})\s+            # A register
        X:([0-9A-F]{2})\s+            # X register
        Y:([0-9A-F]{2})\s+            # Y register
        P:([0-9A-F]{2})\s+            # P register
        SP:([0-9A-F]{2})\s+           # SP register
        PPU:\s*([^C]+)                # PPU state
        CYC:(\d+)                      # Cycle count
    '''
    
    match = re.match(pattern, line, re.VERBOSE)
    if not match:
        return None
        
    return LogLine(
        address=match.group(1),
        instruction=match.group(2).strip(),
        command=match.group(3).strip(),
        reg_a=match.group(4),
        reg_x=match.group(5),
        reg_y=match.group(6),
        reg_p=match.group(7),
        reg_sp=match.group(8),
        ppu=match.group(9).strip(),
        cyc=int(match.group(10))
    )

def compare_logs(reference_log: str, test_log: str) -> None:
    """Compare two NES test logs and find where they diverge."""
    
    with open(reference_log, 'r') as f:
        reference_lines = [line.strip() for line in f if line.strip()]
    
    print("Paste the test log lines (press Ctrl+D or Ctrl+Z when done):")
    test_lines = []
    try:
        while True:
            line = input()
            if line.strip():
                test_lines.append(line.strip())
    except EOFError:
        pass

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
    compare_logs("logs/nestest.log", "test_input") 