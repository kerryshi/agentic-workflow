# Actual Behavior

existsSync -> pick suffix -> ensureDir (mkdir -p succeeds on an existing dir), so two racers took the same id and the second clobbered the first's record
