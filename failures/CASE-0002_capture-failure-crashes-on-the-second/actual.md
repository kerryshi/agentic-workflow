# Actual Behavior

The FIRST `capture_failure.ps1` call succeeded, but every subsequent call crashed. Once at least one
`CASE-####` directory existed, computing the next id threw a format error and no second case could be
created — the failure-capture half of the layer was unusable beyond the first case.
