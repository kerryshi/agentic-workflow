[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Summary,

    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "bad_context",
        "bad_plan",
        "wrong_file_edited",
        "syntax_type_error",
        "test_failure",
        "hallucinated_api",
        "unsafe_command",
        "weak_verification",
        "user_intent_misunderstood",
        "tool_error",
        "environment_platform_issue",
        "permission_issue",
        "shortcut_gamed_check",
        "regression_introduced"
    )]
    [string]$FailureClass,

    [ValidateSet("must_fix", "should_fix", "escaped_bug", "blocker", "note")]
    [string]$Severity = "must_fix",

    [string]$LinkedRun = "",

    [string]$Repo = (Get-Location).Path,

    [string]$CommitOrBranch = "",

    [string]$ReproCommand = "",

    [string]$Expected = "",

    [string]$Actual = "",

    [string]$Evidence = "",

    [string]$PreventionLayer = "",

    [ValidateSet("windows", "wsl", "mac")]
    [string]$Machine = "windows",

    [string]$Root = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_common.ps1")

$dataRoot = Resolve-DataRoot -Root $Root -ScriptRoot $PSScriptRoot
$failuresDir = Join-Path $dataRoot "failures"
$metricsDir = Join-Path $dataRoot "metrics"
$runsDir = Join-Path $dataRoot "runs"
New-Item -ItemType Directory -Force -Path $failuresDir, $metricsDir | Out-Null

$slug = New-Slug -Text $Summary -Fallback "failure"
$repoPath = ConvertTo-RepoPath $Repo
if ([string]::IsNullOrWhiteSpace($CommitOrBranch)) {
    $CommitOrBranch = Get-GitBranch $repoPath
}
if ([string]::IsNullOrWhiteSpace($CommitOrBranch)) {
    $CommitOrBranch = "unknown"
}

# Scan + claim under the failures-dir lock: the directory claim alone only collides on
# IDENTICAL slugs, so two parallel captures with different summaries both got the same
# CASE number (CASE-0005). The collision loop stays as an in-lock backstop.
$allocation = Invoke-WithFileLock -LockKey $failuresDir -LockBody {
    $caseNumbers = @()
    Get-ChildItem -LiteralPath $failuresDir -Directory -Filter "CASE-*" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -match "^CASE-(\d+)(?:_|$)") {
            $caseNumbers += [int]$Matches[1]
        }
    }
    $nextNumber = 1
    if ($caseNumbers.Count -gt 0) {
        # Measure-Object.Maximum returns [double] in PS 5.1; cast so "{0:D4}" (integral-only) works.
        $nextNumber = [int](($caseNumbers | Measure-Object -Maximum).Maximum) + 1
    }
    $caseId = "CASE-{0:D4}" -f $nextNumber
    $caseDir = Join-Path $failuresDir ("{0}_{1}" -f $caseId, $slug)
    while ($true) {
        try {
            New-Item -ItemType Directory -Path $caseDir -ErrorAction Stop | Out-Null
            break
        }
        catch {
            $nextNumber += 1
            $caseId = "CASE-{0:D4}" -f $nextNumber
            $caseDir = Join-Path $failuresDir ("{0}_{1}" -f $caseId, $slug)
            if ($nextNumber -gt 100000) { throw "Could not allocate a unique case ID under $failuresDir" }
        }
    }
    [pscustomobject]@{ CaseId = $caseId; CaseDir = $caseDir }
}
$caseId = $allocation.CaseId
$caseDir = $allocation.CaseDir

$createdAt = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
$repoName = Split-Path -Leaf $repoPath
$failureData = [ordered]@{
    case_id          = $caseId
    created_at       = $createdAt
    resolved_at      = $null
    machine          = $Machine
    linked_run       = $LinkedRun
    repo             = $repoPath.Replace("\", "/")
    repo_name        = $repoName
    commit_or_branch = $CommitOrBranch
    summary          = $Summary
    failure_class    = $FailureClass
    severity         = $Severity
    repro_command    = $ReproCommand
    status           = "open"
    prevention_layer = $(if ([string]::IsNullOrWhiteSpace($PreventionLayer)) { $null } else { $PreventionLayer })
    regression_test  = $null
}
Write-JsonFile -Path (Join-Path $caseDir "failure.json") -Object $failureData

Write-TextFile -Path (Join-Path $caseDir "prompt.md") -Content @"
# Prompt / Situation

$Summary

## Linked Run
$LinkedRun

## Repo
- Machine: $Machine
- Path: $repoPath
- Commit/branch: $CommitOrBranch
"@

Write-TextFile -Path (Join-Path $caseDir "expected.md") -Content @"
# Expected Behavior

$(if ([string]::IsNullOrWhiteSpace($Expected)) { "TBD" } else { $Expected })
"@

Write-TextFile -Path (Join-Path $caseDir "actual.md") -Content @"
# Actual Behavior

$(if ([string]::IsNullOrWhiteSpace($Actual)) { "TBD" } else { $Actual })
"@

# Build the code fence via a variable so the triple backticks survive the double-quoted
# here-string (inside @"..."@, a bare ``` is parsed as escape sequences).
$fence = [string][char]96 * 3
Write-TextFile -Path (Join-Path $caseDir "repro.md") -Content @"
# Reproduction

## Command

${fence}powershell
$ReproCommand
$fence

## Manual Steps
- TBD
"@

Write-TextFile -Path (Join-Path $caseDir "evidence.md") -Content @"
# Evidence

$(if ([string]::IsNullOrWhiteSpace($Evidence)) { "- TBD" } else { $Evidence })
"@

Write-TextFile -Path (Join-Path $caseDir "classification.md") -Content @"
# Classification

- Failure class: $FailureClass
- Severity: $Severity
- Prevention layer: $(if ([string]::IsNullOrWhiteSpace($PreventionLayer)) { "TBD" } else { $PreventionLayer })

## Root Cause
TBD

## Contributing Factors
- TBD
"@

Write-TextFile -Path (Join-Path $caseDir "fix.md") -Content @"
# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD
"@

Write-TextFile -Path (Join-Path $caseDir "regression.md") -Content @"
# Regression

## Regression Test
TBD

## Failing-First Evidence
TBD

## Passing Evidence
TBD
"@

# Link the case back into its run.json (StrictMode-safe: property may be absent on older
# records; locked: a parallel update_run on the same run.json must not lose this link).
if (-not [string]::IsNullOrWhiteSpace($LinkedRun)) {
    $runJson = Join-Path (Join-Path $runsDir $LinkedRun) "run.json"
    if (Test-Path -LiteralPath $runJson) {
        Invoke-WithFileLock -LockKey $runJson -LockBody {
            $run = Read-JsonFile $runJson
            $linkedFailures = @(Get-Prop $run "linked_failures" @())
            if ($linkedFailures -notcontains $caseId) {
                $linkedFailures += $caseId
            }
            Set-Prop $run "linked_failures" (@($linkedFailures))
            Write-JsonFile -Path $runJson -Object $run
        }
    }
    else {
        Write-Warning ("-LinkedRun '{0}' not found under {1}; case created without a run link." -f $LinkedRun, $runsDir)
    }
}

Add-JsonlEvent -Path (Join-Path $metricsDir "runs.jsonl") -Event ([ordered]@{
    type          = "failure_captured"
    at            = $createdAt
    case_id       = $caseId
    linked_run    = $LinkedRun
    failure_class = $FailureClass
    severity      = $Severity
    repo          = $repoPath.Replace("\", "/")
})

Write-Output ("Created failure case: {0}" -f $caseId)
Write-Output $caseDir
exit 0
