# Actual Behavior

Get-RepoDiff round-trips patch bytes through a UTF-8 string; invalid sequences become U+FFFD and git apply fails