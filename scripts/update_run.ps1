[CmdletBinding()]
param(
    # Omit to target the newest in-progress run.
    [string]$RunId = "",

    # Log a command that was run during the task.
    [string]$Command = "",
    [string]$Result = "",
    [string]$Note = "",

    # Add an evidence link (repo-relative path or URL) to the run record.
    [string]$EvidenceLink = "",

    [string]$Root = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_common.ps1")

$dataRoot = Resolve-DataRoot -Root $Root -ScriptRoot $PSScriptRoot
$runsDir = Join-Path $dataRoot "runs"

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = Get-ActiveRunId -RunsDir $runsDir
    if ([string]::IsNullOrWhiteSpace($RunId)) {
        throw "No -RunId given and no in-progress run found under $runsDir"
    }
}

$runDir = Join-Path $runsDir $RunId
$runJson = Join-Path $runDir "run.json"
if (-not (Test-Path -LiteralPath $runJson)) {
    throw "Run not found: $RunId"
}

$did = @()

if (-not [string]::IsNullOrWhiteSpace($Command)) {
    Add-JsonlEvent -Path (Join-Path $runDir "commands.jsonl") -Event ([ordered]@{
        at      = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
        command = $Command
        result  = $Result
        note    = $Note
    })
    $did += "logged command"
}

if (-not [string]::IsNullOrWhiteSpace($EvidenceLink)) {
    # Serialized: parallel sessions writing the same run.json otherwise lose links to a
    # last-writer-wins race while every caller exits 0 (CASE-0004).
    Invoke-WithFileLock -LockKey $runJson -LockBody {
        $run = Read-JsonFile $runJson
        $links = @(Get-Prop $run "evidence_links" @())
        # Case-sensitive: URLs/paths differing only by case are distinct evidence.
        if ($links -cnotcontains $EvidenceLink) {
            $links += $EvidenceLink
            Set-Prop $run "evidence_links" (@($links))
            Write-JsonFile -Path $runJson -Object $run
        }
    }
    $did += "added evidence link"
}

if ($did.Count -eq 0) {
    throw "Nothing to do: pass -Command and/or -EvidenceLink."
}

Write-Output ("Updated run {0}: {1}" -f $RunId, ($did -join ", "))
exit 0
