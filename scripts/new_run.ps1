[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Objective,

    [string]$Repo = (Get-Location).Path,

    [string]$Branch = "",

    # Worktree path/name when the run happens in a linked worktree (PRD FR1 field).
    [string]$Worktree = "",

    [ValidateSet("low", "medium", "high")]
    [string]$RiskLevel = "medium",

    [string[]]$ValidationPlan = @(),

    [ValidateSet("windows", "wsl", "mac")]
    [string]$Machine = "windows",

    [string]$AgentId = "manual",

    [ValidateSet("planner", "executor", "reviewer", "verifier", "classifier", "helper", "mixed")]
    [string]$AgentRole = "mixed",

    [string]$AgentSurface = "",

    [string]$AgentModel = "",

    [string]$PromptSummary = "",

    [string]$StatusPath = "",

    # Data root (holds runs/ failures/ metrics/). Defaults to the repo; override for tests.
    [string]$Root = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_common.ps1")

# Validate inputs BEFORE claiming a run directory, so a bad call can't leave an orphaned
# ID-claiming run folder behind (the crash used to happen at Split-Path, after the claim).
if ([string]::IsNullOrWhiteSpace($Repo)) {
    throw "-Repo must not be empty or whitespace."
}

$dataRoot = Resolve-DataRoot -Root $Root -ScriptRoot $PSScriptRoot
$runsDir = Join-Path $dataRoot "runs"
$metricsDir = Join-Path $dataRoot "metrics"
New-Item -ItemType Directory -Force -Path $runsDir, $metricsDir | Out-Null

$repoPath = ConvertTo-RepoPath $Repo
if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = Get-GitBranch $repoPath
}
if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = "unknown"
}

# -ValidationPlan binds as a PowerShell array (-ValidationPlan 'a','b'); trim blanks only.
# No comma-splitting: commands legitimately contain commas (e.g. pytest -k "a,b").
$validationItems = @($ValidationPlan | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
if ([string]::IsNullOrWhiteSpace($AgentId)) { throw "-AgentId must not be empty or whitespace." }
if ([string]::IsNullOrWhiteSpace($AgentSurface)) { $AgentSurface = $AgentId }
$agentModelValue = $(if ([string]::IsNullOrWhiteSpace($AgentModel)) { $null } else { $AgentModel })

$createdAt = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$baseRunId = "{0}_{1}" -f $stamp, (New-Slug -Text $Objective -Fallback "run")

# Claim the run ID atomically: creating the directory (without -Force) is the lock.
$runId = $baseRunId
$runDir = Join-Path $runsDir $runId
$suffix = 2
while ($true) {
    try {
        New-Item -ItemType Directory -Path $runDir -ErrorAction Stop | Out-Null
        break
    }
    catch {
        $runId = "{0}-{1}" -f $baseRunId, $suffix
        $runDir = Join-Path $runsDir $runId
        $suffix += 1
        if ($suffix -gt 500) { throw "Could not allocate a unique run ID under $runsDir" }
    }
}

$validationMarkdown = if ($validationItems.Count -gt 0) {
    ($validationItems | ForEach-Object { "- {0}" -f $_ }) -join "`r`n"
}
else {
    "- TBD"
}

$repoName = Split-Path -Leaf $repoPath
$runData = [ordered]@{
    run_id              = $runId
    created_at          = $createdAt
    completed_at        = $null
    machine             = $Machine
    repo                = $repoPath.Replace("\", "/")
    repo_name           = $repoName
    branch              = $Branch
    worktree            = $(if ([string]::IsNullOrWhiteSpace($Worktree)) { $null } else { $Worktree })
    objective           = $Objective
    user_prompt_summary = $PromptSummary
    status_path         = $StatusPath
    risk_level          = $RiskLevel
    agent               = [ordered]@{
        agent_id        = $AgentId
        agent_role      = $AgentRole
        surface         = $AgentSurface
        model           = $agentModelValue
        adapter_version = "v1"
    }
    status              = "in_progress"
    validation_plan     = @($validationItems)
    files_changed       = @()
    linked_failures     = @()
    evidence_links      = @()
    reviewer_result     = $null
    final_outcome       = $null
}
Write-JsonFile -Path (Join-Path $runDir "run.json") -Object $runData

Write-TextFile -Path (Join-Path $runDir "task.md") -Content @"
# $runId

## Objective
$Objective

## User Prompt Summary
$PromptSummary

## Repo
- Machine: $Machine
- Path: $repoPath
- Branch/worktree: $Branch
- Status path: $StatusPath
- Risk level: $RiskLevel

## Agent Adapter
- Agent ID: $AgentId
- Role: $AgentRole
- Surface: $AgentSurface
- Model: $agentModelValue
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
$validationMarkdown
"@

Write-TextFile -Path (Join-Path $runDir "plan.md") -Content @"
# Plan

## Approach
- TBD

## Constraints
- Preserve surrounding code style.
- Keep the diff scoped to the stated objective.
- Escalate product, API, data model, security, and irreversible decisions.

## Validation
$validationMarkdown
"@

# evidence.md / review.md are filled DURING the run (by hand or by /ship). complete_run.ps1
# appends a Completion section rather than overwriting, so nothing here is thrown away.
Write-TextFile -Path (Join-Path $runDir "evidence.md") -Content @"
# Evidence

## Commands
| Command | Result | Notes |
|---|---|---|

## Proof
- TBD

## Artifacts
- TBD
"@

Write-TextFile -Path (Join-Path $runDir "review.md") -Content @"
# Review

## Independent Reviewer

## Must-fix
- TBD

## Should-fix / Nits
- TBD

## Resolution
- TBD
"@

Write-TextFile -Path (Join-Path $runDir "final.md") -Content @"
# Final

## Outcome
TBD

## What Changed
- TBD

## Validation
- TBD

## Risks
- TBD

## Follow-ups
- TBD
"@

# commands.jsonl accumulates {at, command, result, note} lines via update_run.ps1.
Write-TextFile -Path (Join-Path $runDir "commands.jsonl") -Content ""
Write-TextFile -Path (Join-Path $runDir "diff.patch") -Content ""

Add-JsonlEvent -Path (Join-Path $metricsDir "runs.jsonl") -Event ([ordered]@{
    type       = "run_started"
    at         = $createdAt
    run_id     = $runId
    repo       = $repoPath.Replace("\", "/")
    objective  = $Objective
    risk_level = $RiskLevel
    agent_id   = $AgentId
    agent_role = $AgentRole
})

Write-Output ("Created run: {0}" -f $runId)
Write-Output $runDir

# Explicit success code: earlier git probes (e.g. rev-parse in a non-git repo, exit 128) would
# otherwise leak into $LASTEXITCODE and read as failure to in-process callers.
exit 0
