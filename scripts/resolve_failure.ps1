[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CaseId,

    [ValidateSet("fixed", "wont_fix", "resolved")]
    [string]$Status = "fixed",

    [string]$RegressionTest = "",

    [string]$PreventionLayer = "",

    [string]$FixSummary = "",

    [string]$Root = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_common.ps1")

$dataRoot = Resolve-DataRoot -Root $Root -ScriptRoot $PSScriptRoot
$failuresDir = Join-Path $dataRoot "failures"
$metricsDir = Join-Path $dataRoot "metrics"

# Accept either the bare case ID (CASE-0001) or the full dir name (CASE-0001_slug).
$caseKey = $CaseId
if ($caseKey -match "^(CASE-\d+)") { $caseKey = $Matches[1] }

$caseDir = $null
# Anchor to the exact case ID (dir is "CASE-0001" or "CASE-0001_slug") so -CaseId CASE-1
# cannot accidentally match CASE-10 / CASE-100.
Get-ChildItem -LiteralPath $failuresDir -Directory -Filter "$caseKey*" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($null -eq $caseDir -and ($_.Name -eq $caseKey -or $_.Name -like "$caseKey`_*")) {
        $caseDir = $_.FullName
    }
}
if ($null -eq $caseDir) {
    throw "Failure case not found: $CaseId"
}

$failureJson = Join-Path $caseDir "failure.json"
if (-not (Test-Path -LiteralPath $failureJson)) {
    throw "failure.json missing in $caseDir"
}

$resolvedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
$failure = Invoke-WithFileLock -LockKey $failureJson -LockBody {
    $failure = Read-JsonFile $failureJson
    Set-Prop $failure "status" $Status
    Set-Prop $failure "resolved_at" $resolvedAt
    if (-not [string]::IsNullOrWhiteSpace($RegressionTest)) { Set-Prop $failure "regression_test" $RegressionTest }
    if (-not [string]::IsNullOrWhiteSpace($PreventionLayer)) { Set-Prop $failure "prevention_layer" $PreventionLayer }
    Write-JsonFile -Path $failureJson -Object $failure
    $failure
}

# Record the resolution narrative without clobbering the fix.md skeleton's headings.
$fixAppend = @"


## Resolution ($resolvedAt)
- Status: $Status
- Regression test: $(if ([string]::IsNullOrWhiteSpace($RegressionTest)) { "TBD" } else { $RegressionTest })
- Prevention layer: $(if ([string]::IsNullOrWhiteSpace($PreventionLayer)) { "TBD" } else { $PreventionLayer })

$(if ([string]::IsNullOrWhiteSpace($FixSummary)) { "" } else { $FixSummary })
"@
$fixPath = Join-Path $caseDir "fix.md"
if (Test-Path -LiteralPath $fixPath) {
    [System.IO.File]::AppendAllText($fixPath, $fixAppend, (New-Object System.Text.UTF8Encoding($false)))
}
else {
    Write-TextFile -Path $fixPath -Content ("# Fix" + $fixAppend)
}

New-Item -ItemType Directory -Force -Path $metricsDir | Out-Null
Add-JsonlEvent -Path (Join-Path $metricsDir "runs.jsonl") -Event ([ordered]@{
    type             = "failure_resolved"
    at               = $resolvedAt
    case_id          = [string](Get-Prop $failure "case_id")
    status           = $Status
    prevention_layer = [string](Get-Prop $failure "prevention_layer")
    regression_test  = [string](Get-Prop $failure "regression_test")
})

Write-Output ("Resolved {0}: {1}" -f (Get-Prop $failure "case_id"), $Status)
Write-Output $caseDir
exit 0
