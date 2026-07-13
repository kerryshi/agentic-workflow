[CmdletBinding()]
param(
    [switch]$Json,
    [string]$Root = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_common.ps1")

function Read-RecordDir {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$FileName
    )
    $items = @()
    if (-not (Test-Path -LiteralPath $Directory)) { return $items }

    Get-ChildItem -LiteralPath $Directory -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $path = Join-Path $_.FullName $FileName
        if (Test-Path -LiteralPath $path) {
            try {
                $obj = Read-JsonFile $path
                $items += [pscustomobject]@{ Dir = $_.FullName; Data = $obj }
            }
            catch {
                Write-Warning ("Skipping invalid JSON: {0}" -f $path)
            }
        }
    }
    return $items
}

function Test-RunHasEvidence {
    # Honest evidence: a non-empty evidence link, OR an evidence.md bullet that isn't a stub.
    param([Parameter(Mandatory = $true)]$Record)

    $links = @(Get-Prop $Record.Data "evidence_links" @())
    if ($links.Count -gt 0) { return $true }

    $evidenceMd = Join-Path $Record.Dir "evidence.md"
    if (Test-Path -LiteralPath $evidenceMd) {
        # Stubs match by PREFIX: "- TBD (fill in later)" is still a stub, not evidence.
        $stubPrefixes = @("- TBD", "- (none passed)")
        foreach ($line in (Get-Content -LiteralPath $evidenceMd)) {
            $t = $line.Trim()
            if (-not $t.StartsWith("- ")) { continue }
            $isStub = $false
            foreach ($p in $stubPrefixes) {
                if ($t.StartsWith($p)) { $isStub = $true; break }
            }
            if (-not $isStub) { return $true }
        }
    }
    return $false
}

$dataRoot = Resolve-DataRoot -Root $Root -ScriptRoot $PSScriptRoot
$runsDir = Join-Path $dataRoot "runs"
$failuresDir = Join-Path $dataRoot "failures"
$metricsDir = Join-Path $dataRoot "metrics"
New-Item -ItemType Directory -Force -Path $metricsDir | Out-Null

$runRecords = @(Read-RecordDir -Directory $runsDir -FileName "run.json")
$failureRecords = @(Read-RecordDir -Directory $failuresDir -FileName "failure.json")

$terminal = @("shipped", "complete")

$runCount = $runRecords.Count
$shippedRuns = @($runRecords | Where-Object { (Get-Prop $_.Data "status") -in $terminal }).Count
$failedRuns = @($runRecords | Where-Object { @(Get-Prop $_.Data "linked_failures" @()).Count -gt 0 }).Count
$runsWithEvidence = @($runRecords | Where-Object { Test-RunHasEvidence $_ }).Count
$evidenceRate = if ($runCount -gt 0) { [math]::Round(($runsWithEvidence / $runCount) * 100, 1) } else { 0 }

$openFailures = @($failureRecords | Where-Object { (Get-Prop $_.Data "status") -eq "open" }).Count
# wont_fix is closed but NOT resolved - counting it as resolved inflated the metric.
$resolvedFailures = @($failureRecords | Where-Object { (Get-Prop $_.Data "status") -in @("fixed", "resolved") }).Count
$wontFixFailures = @($failureRecords | Where-Object { (Get-Prop $_.Data "status") -eq "wont_fix" }).Count
$regressionsAdded = @($failureRecords | Where-Object { -not [string]::IsNullOrWhiteSpace([string](Get-Prop $_.Data "regression_test")) }).Count
$mustFixFailures = @($failureRecords | Where-Object { (Get-Prop $_.Data "severity") -eq "must_fix" }).Count
$escapedBugs = @($failureRecords | Where-Object { (Get-Prop $_.Data "severity") -eq "escaped_bug" }).Count

# Duration only over runs that actually shipped/completed (not blocked/abandoned).
$durations = @()
foreach ($rec in $runRecords) {
    if ((Get-Prop $rec.Data "status") -notin $terminal) { continue }
    $start = [string](Get-Prop $rec.Data "created_at")
    $end = [string](Get-Prop $rec.Data "completed_at")
    if (-not [string]::IsNullOrWhiteSpace($start) -and -not [string]::IsNullOrWhiteSpace($end)) {
        try {
            $durations += ([datetimeoffset]::Parse($end) - [datetimeoffset]::Parse($start)).TotalMinutes
        }
        catch { }
    }
}
$averageMinutes = if ($durations.Count -gt 0) { [math]::Round((($durations | Measure-Object -Average).Average), 1) } else { $null }

$classCounts = @{}
foreach ($rec in $failureRecords) {
    $class = [string](Get-Prop $rec.Data "failure_class")
    if ([string]::IsNullOrWhiteSpace($class)) { $class = "unclassified" }
    if (-not $classCounts.ContainsKey($class)) { $classCounts[$class] = 0 }
    $classCounts[$class] += 1
}

$updatedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
$summary = [ordered]@{
    updated_at                       = $updatedAt
    runs_started                     = $runCount
    runs_shipped                     = $shippedRuns
    failed_runs                      = $failedRuns
    failures_total                   = $failureRecords.Count
    failures_open                    = $openFailures
    failures_resolved                = $resolvedFailures
    failures_wont_fix                = $wontFixFailures
    must_fix_failures                = $mustFixFailures
    escaped_bugs                     = $escapedBugs
    regressions_added                = $regressionsAdded
    validation_evidence_rate_percent = $evidenceRate
    average_minutes_start_to_ship    = $averageMinutes
    failure_classes                  = $classCounts
}

$classMarkdown = if ($classCounts.Count -gt 0) {
    ($classCounts.GetEnumerator() | Sort-Object Name | ForEach-Object { "| {0} | {1} |" -f $_.Name, $_.Value }) -join "`r`n"
}
else {
    "| none | 0 |"
}
$avgText = if ($null -eq $averageMinutes) { "n/a" } else { "$averageMinutes" }

$markdown = @"
# Agentic Workflow Metrics

Last updated: $updatedAt

| Metric | Value |
|---|---:|
| Runs started | $runCount |
| Runs shipped/complete | $shippedRuns |
| Runs with linked failures | $failedRuns |
| Validation evidence rate | $evidenceRate% |
| Avg minutes start to ship | $avgText |
| Failure cases | $($failureRecords.Count) |
| Open failures | $openFailures |
| Resolved failures | $resolvedFailures |
| Won't-fix failures | $wontFixFailures |
| Must-fix failures | $mustFixFailures |
| Escaped bugs | $escapedBugs |
| Regressions added | $regressionsAdded |

## Failure Classes

| Class | Count |
|---|---:|
$classMarkdown
"@

Write-TextFile -Path (Join-Path $metricsDir "summary.md") -Content $markdown
Write-JsonFile -Path (Join-Path $metricsDir "summary.json") -Object $summary

if ($Json) {
    $summary | ConvertTo-Json -Depth 8
}
else {
    Write-Output $markdown
}
exit 0
