# Actual Behavior

finish() was wired only to 'close'; killTree's POSIX branch killed only the direct child; no fallback resolve existed - a stuck agent stranded the engine with the stage 'running' (crash-not-park class)