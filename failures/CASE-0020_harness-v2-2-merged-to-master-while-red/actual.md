# Actual Behavior

v2.2 was written on the Mac, merged, and was red on Windows for a day. Nobody skipped a check - there was no check to skip. Root cause was structural (vitest spawns 1 worker/core; Windows process creation costs ~10x POSIX), not the CPU-load/Defender hypothesis recorded at the time
