[CmdletBinding()]
param(
    # Omit to auto-detect the newest in-progress run.
    [string]$RunId = "",

    [ValidateSet("shipped", "complete", "blocked", "abandoned")]
    [string]$Status = "shipped",

    [string]$FinalOutcome = "",

    [string]$ReviewerResult = "",

    [string]$Evidence = "",

    [string]$Risks = "",

    [string]$FollowUps = "",

    [string[]]$FilesChanged = @(),

    [string[]]$EvidenceLinks = @(),

    [string]$Repo = "",

    [switch]$CaptureDiff,

    # Re-complete an already-terminal run without erroring (logs a run_amended event).
    [switch]$Force,

    [string]$Root = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_common.ps1")

# Common secret-ish paths never embedded into a captured diff (defense in depth; git already
# skips .gitignored files). Documented in docs/workflows.md.
$script:SecretExcludes = @(
    ":(exclude,glob)**/.env", ":(exclude,glob)**/.env.*",
    ":(exclude,glob)**/*.pem", ":(exclude,glob)**/*.key",
    ":(exclude,glob)**/credentials.json", ":(exclude,glob)**/token.json",
    ":(exclude,glob)**/*.secret", ":(exclude,glob)**/id_rsa"
)

function Get-ChangedFiles {
    param([Parameter(Mandatory = $true)][string]$RepoPath)

    $files = @()
    # Invoke-GitLines decodes stdout as UTF-8; a plain & git call under PS 5.1 decodes via the
    # console OEM codepage and stores mojibake filenames in run.json (same class as R14).
    $lines = @(Invoke-GitLines -RepoPath $RepoPath -GitArgs @("-c", "core.quotePath=false", "status", "--porcelain=v1"))
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) { continue }
        $path = $line.Substring(3).Trim()
        if ($path -match " -> ") { $path = @($path -split " -> ")[-1] }
        $path = $path.Trim('"')
        if (-not [string]::IsNullOrWhiteSpace($path)) { $files += $path }
    }
    return @($files | Sort-Object -Unique)
}

function Get-RepoDiff {
    # Build a real, git-appliable patch: tracked changes plus untracked files. git writes the
    # patch file itself (--output) so bytes are exact - CRLF preserved and a correct trailing
    # newline - avoiding the line-array rejoin that dropped CRs and the final newline.
    #
    # Untracked files are surfaced with an intent-to-add over the '.' pathspec so GIT enumerates
    # them itself. We must never round-trip a filename back through PowerShell: PS 5.1 decodes
    # git's UTF-8 stdout via the console OEM codepage (e.g. IBM437), so a non-ASCII name like
    # "cafe.txt" returns as mojibake, `add -N <name>` fails to match (exit 128), and that file
    # silently drops from the patch (regression R14). Resolving "." inside git sidesteps the
    # decode entirely. The intent-to-add runs against a THROWAWAY COPY of the index (via
    # GIT_INDEX_FILE) so the user's real index / staged changes are never touched - and no
    # reset is needed.
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [string[]]$ExtraExcludes = @()
    )

    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $tmp = [System.IO.Path]::GetTempFileName()
    $tmpIndex = $null
    $indexEnvWasSet = Test-Path Env:\GIT_INDEX_FILE
    $prevIndexEnv = $env:GIT_INDEX_FILE
    try {
        $head = Invoke-GitLine -RepoPath $RepoPath -GitArgs @("rev-parse", "--verify", "HEAD")
        $base = if ([string]::IsNullOrWhiteSpace($head)) { "4b825dc642cb6eb9a060e54bf8d69288fbee4904" } else { "HEAD" }
        $excludes = @($script:SecretExcludes + $ExtraExcludes)

        # Copy the real index to a throwaway file and point git at it, so the intent-to-add
        # below never mutates the user's index. git resolves the index path itself (this is
        # worktree-aware; a linked worktree keeps its index under .git/worktrees/<name>/).
        $indexPathRaw = Invoke-GitLine -RepoPath $RepoPath -GitArgs @("rev-parse", "--git-path", "index")
        if (-not [string]::IsNullOrWhiteSpace($indexPathRaw)) {
            $indexPath = if ([System.IO.Path]::IsPathRooted($indexPathRaw)) { $indexPathRaw } else { Join-Path $RepoPath $indexPathRaw }
            $tmpIndex = [System.IO.Path]::GetTempFileName()
            if (Test-Path -LiteralPath $indexPath) {
                Copy-Item -LiteralPath $indexPath -Destination $tmpIndex -Force
            }
            else {
                # No index yet (unborn/empty): let git create one fresh in the temp location.
                Remove-Item -LiteralPath $tmpIndex -Force -ErrorAction SilentlyContinue
            }
            # GIT_INDEX_FILE is absolute (GetTempFileName), so -C cannot reinterpret it.
            $env:GIT_INDEX_FILE = $tmpIndex
        }

        # Only surface untracked files when the throwaway index is in place, so intent-to-add can
        # never touch the user's real index (the old per-file reset is gone). If the index path
        # couldn't be resolved, tracked changes are still captured; untracked are simply skipped.
        if ($null -ne $tmpIndex) {
            & git -c core.quotePath=false -C $RepoPath add -N -- "." @excludes 2>$null | Out-Null
        }

        & git -C $RepoPath diff --binary $base --output=$tmp -- "." @excludes 2>$null | Out-Null

        # Copy the patch BYTES to the destination - never decode to a string. A changed file
        # with non-UTF-8 content (e.g. Latin-1) would round-trip through U+FFFD replacement
        # chars and git apply would reject the patch (CASE-0006).
        if (Test-Path -LiteralPath $tmp) {
            Copy-Item -LiteralPath $tmp -Destination $OutFile -Force
        }
        else {
            Write-TextFile -Path $OutFile -Content ""
        }
    }
    finally {
        if ($indexEnvWasSet) { $env:GIT_INDEX_FILE = $prevIndexEnv }
        else { Remove-Item Env:\GIT_INDEX_FILE -ErrorAction SilentlyContinue }
        if ($tmpIndex) { Remove-Item -LiteralPath $tmpIndex -Force -ErrorAction SilentlyContinue }
        $ErrorActionPreference = $prev
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

$dataRoot = Resolve-DataRoot -Root $Root -ScriptRoot $PSScriptRoot
$runsDir = Join-Path $dataRoot "runs"
$metricsDir = Join-Path $dataRoot "metrics"
New-Item -ItemType Directory -Force -Path $metricsDir | Out-Null

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = Get-ActiveRunId -RunsDir $runsDir
    if ([string]::IsNullOrWhiteSpace($RunId)) {
        throw "No -RunId given and no in-progress run found under $runsDir"
    }
    Write-Output ("Auto-detected active run: {0}" -f $RunId)
}

$runDir = Join-Path $runsDir $RunId
$runJson = Join-Path $runDir "run.json"
if (-not (Test-Path -LiteralPath $runJson)) {
    throw "Run not found: $RunId"
}

# The whole read-modify-write runs under the run.json lock so a parallel update_run (or a
# second complete) can't interleave and lose fields. Assignments in the block stay local -
# it returns what the rest of the script needs.
$state = Invoke-WithFileLock -LockKey $runJson -LockBody {
    $run = Read-JsonFile $runJson

    $repoValue = $Repo
    if ([string]::IsNullOrWhiteSpace($repoValue)) {
        $repoValue = [string](Get-Prop $run "repo")
    }
    # Guard: a legacy run.json may have no repo at all; "" would crash Test-Path binding.
    $repoPath = ""
    if (-not [string]::IsNullOrWhiteSpace($repoValue)) {
        $repoPath = $repoValue.Replace("/", "\")
    }
    $repoUsable = (-not [string]::IsNullOrWhiteSpace($repoPath)) -and (Test-Path -LiteralPath $repoPath)

    $alreadyComplete = -not [string]::IsNullOrWhiteSpace([string](Get-Prop $run "completed_at"))
    if ($alreadyComplete -and -not $Force) {
        throw "Run $RunId is already completed (status=$(Get-Prop $run 'status'), completed_at=$(Get-Prop $run 'completed_at')). Re-run with -Force to amend."
    }

    $completedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
    Set-Prop $run "status" $Status
    if ($alreadyComplete) {
        Set-Prop $run "last_amended_at" $completedAt
    }
    else {
        Set-Prop $run "completed_at" $completedAt
    }

    # Backfill branch only if the record never captured one.
    $existingBranch = [string](Get-Prop $run "branch")
    if (($existingBranch -eq "" -or $existingBranch -eq "unknown") -and $repoUsable) {
        $detectedBranch = Get-GitBranch $repoPath
        if (-not [string]::IsNullOrWhiteSpace($detectedBranch)) { Set-Prop $run "branch" $detectedBranch }
    }

    if (-not [string]::IsNullOrWhiteSpace($FinalOutcome)) { Set-Prop $run "final_outcome" $FinalOutcome }
    if (-not [string]::IsNullOrWhiteSpace($ReviewerResult)) { Set-Prop $run "reviewer_result" $ReviewerResult }

    # files_changed: prefer explicit, else auto-detect; union with whatever the record already had.
    $changedFiles = @($FilesChanged | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($changedFiles.Count -eq 0 -and $repoUsable) {
        $changedFiles = @(Get-ChangedFiles $repoPath)
    }
    $existingFiles = @(Get-Prop $run "files_changed" @())
    Set-Prop $run "files_changed" (@(@($existingFiles + $changedFiles) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique))

    # evidence_links: merge, never drop existing.
    $existingLinks = @(Get-Prop $run "evidence_links" @())
    $newLinks = @($EvidenceLinks | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    Set-Prop $run "evidence_links" (@(@($existingLinks + $newLinks) | Select-Object -Unique))

    Write-JsonFile -Path $runJson -Object $run

    [pscustomobject]@{
        Run             = $run
        RepoPath        = $repoPath
        RepoUsable      = $repoUsable
        CompletedAt     = $completedAt
        AlreadyComplete = $alreadyComplete
    }
}
$run = $state.Run
$repoPath = $state.RepoPath
$completedAt = $state.CompletedAt
$alreadyComplete = $state.AlreadyComplete

# run.json is the source of truth; log the completion event right after it persists so a later
# failure writing the Markdown/diff artifacts can't lose the metric.
$eventType = if ($alreadyComplete) { "run_amended" } else { "run_completed" }
Add-JsonlEvent -Path (Join-Path $metricsDir "runs.jsonl") -Event ([ordered]@{
    type   = $eventType
    at     = $completedAt
    run_id = $RunId
    status = $Status
    repo   = [string](Get-Prop $run "repo")
})

# evidence.md / review.md are run-time working docs: APPEND a completion section, never clobber.
$evidenceLinksMarkdown = if (@(Get-Prop $run "evidence_links" @()).Count -gt 0) {
    (@(Get-Prop $run "evidence_links" @()) | ForEach-Object { "- {0}" -f $_ }) -join "`r`n"
}
else {
    "- (none passed)"
}
$evidencePath = Join-Path $runDir "evidence.md"
$evidenceAppend = @"


## Completion ($completedAt)

$(if ([string]::IsNullOrWhiteSpace($Evidence)) { "_No summary passed to complete_run._" } else { "- " + $Evidence })

### Evidence links
$evidenceLinksMarkdown
"@
if (Test-Path -LiteralPath $evidencePath) {
    [System.IO.File]::AppendAllText($evidencePath, $evidenceAppend, (New-Object System.Text.UTF8Encoding($false)))
}
else {
    Write-TextFile -Path $evidencePath -Content ("# Evidence" + $evidenceAppend)
}

$reviewPath = Join-Path $runDir "review.md"
$reviewAppend = @"


## Completion reviewer result ($completedAt)

$(if ([string]::IsNullOrWhiteSpace($ReviewerResult)) { "_No reviewer result passed to complete_run._" } else { $ReviewerResult })
"@
if (Test-Path -LiteralPath $reviewPath) {
    [System.IO.File]::AppendAllText($reviewPath, $reviewAppend, (New-Object System.Text.UTF8Encoding($false)))
}
else {
    Write-TextFile -Path $reviewPath -Content ("# Review" + $reviewAppend)
}

# final.md is complete_run's own report artifact - author it from the passed summary.
$filesMarkdown = if (@(Get-Prop $run "files_changed" @()).Count -gt 0) {
    (@(Get-Prop $run "files_changed" @()) | ForEach-Object { "- {0}" -f $_ }) -join "`r`n"
}
else {
    "- TBD"
}
Write-TextFile -Path (Join-Path $runDir "final.md") -Content @"
# Final

## Outcome
$FinalOutcome

## Status
$Status

## Files Changed
$filesMarkdown

## Validation / Evidence
$Evidence

## Reviewer Result
$ReviewerResult

## Risks
$Risks

## Follow-ups
$FollowUps
"@

if ($CaptureDiff -and $state.RepoUsable) {
    # When capturing the workflow repo itself, exclude ALL run/metrics bookkeeping - not just
    # this run's. Other sessions' in-progress records and regenerated metrics/summary.* are
    # churn, not this change; failures/ narratives stay in (they are authored content).
    $extraExcludes = @()
    $repoResolved = (Resolve-Path -LiteralPath $repoPath).Path.Replace("\", "/").TrimEnd("/")
    $dataResolved = (Resolve-Path -LiteralPath $dataRoot).Path.Replace("\", "/").TrimEnd("/")
    if ($repoResolved -ieq $dataResolved) {
        $extraExcludes = @(":(exclude)runs", ":(exclude)metrics")
    }
    Get-RepoDiff -RepoPath $repoPath -OutFile (Join-Path $runDir "diff.patch") -ExtraExcludes $extraExcludes
}

Write-Output ("Completed run: {0} ({1})" -f $RunId, $Status)
Write-Output $runDir
exit 0
