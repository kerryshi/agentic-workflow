[CmdletBinding()]
param(
    # Sandbox data root; defaults to a fresh temp dir. Never point this at the real repo.
    [string]$Sandbox = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptsDir = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts"
$newRun = Join-Path $scriptsDir "new_run.ps1"
$updateRun = Join-Path $scriptsDir "update_run.ps1"
$completeRun = Join-Path $scriptsDir "complete_run.ps1"
$captureFailure = Join-Path $scriptsDir "capture_failure.ps1"
$resolveFailure = Join-Path $scriptsDir "resolve_failure.ps1"
$summarize = Join-Path $scriptsDir "summarize_metrics.ps1"

if ([string]::IsNullOrWhiteSpace($Sandbox)) {
    $Sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("aw-tests-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
}
New-Item -ItemType Directory -Force -Path $Sandbox | Out-Null

$script:Pass = 0
$script:Fail = 0
$script:Failures = @()

function Check {
    param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][bool]$Condition, [string]$Detail = "")
    if ($Condition) {
        $script:Pass += 1
        Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green
    }
    else {
        $script:Fail += 1
        $script:Failures += $Name
        Write-Host ("  FAIL  {0}{1}" -f $Name, $(if ($Detail) { " -- $Detail" } else { "" })) -ForegroundColor Red
    }
}

function Get-FirstByte {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -eq 0) { return -1 }
    return $bytes[0]
}

function Read-Utf8Json {
    param([Parameter(Mandatory = $true)][string]$Path)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    return ([System.IO.File]::ReadAllText($Path, $utf8) | ConvertFrom-Json)
}

function Last {
    param($Value)
    $arr = @($Value)
    if ($arr.Count -eq 0) { return "" }
    return $arr[$arr.Count - 1]
}

Write-Host "Agentic Workflow v1 - script tests" -ForegroundColor Cyan
Write-Host ("Sandbox: {0}" -f $Sandbox)

# --- Lifecycle: start a run ------------------------------------------------------------
Write-Host "`n[lifecycle] new_run" -ForegroundColor Cyan
$out = & $newRun -Objective "Fix failing navbar test" -Repo $Sandbox -RiskLevel medium -ValidationPlan 'pytest -k "a,b"', 'npm run lint' -Root $Sandbox
$runDir = [string](Last $out)
$runId = Split-Path -Leaf $runDir
$runJson = Join-Path $runDir "run.json"
Check "new_run creates run.json" (Test-Path -LiteralPath $runJson)

$run = Get-Content -Raw -LiteralPath $runJson | ConvertFrom-Json
# R12: comma inside a validation item is NOT split.
Check "R12 validation item with comma kept intact" (@($run.validation_plan).Count -eq 2 -and (@($run.validation_plan) -contains 'pytest -k "a,b"')) ("got: " + (@($run.validation_plan) -join " | "))
# R2: no UTF-8 BOM in run.json.
Check "R2 run.json has no BOM" ((Get-FirstByte $runJson) -ne 0xEF)
Check "new_run records branch" (-not [string]::IsNullOrWhiteSpace([string]$run.branch))
Check "new_run records honest default agent adapter" ([string]$run.agent.agent_id -eq "manual" -and [string]$run.agent.agent_role -eq "mixed" -and [string]$run.agent.surface -eq "manual")

$agentRoot = Join-Path $Sandbox "_agent-smoke"
# Omitting -AgentSurface must inherit the selected adapter rather than retaining another
# adapter's default surface.
$agentOut = & $newRun -Objective "Adapter metadata smoke" -Repo $Sandbox -AgentId codex -AgentRole executor -AgentModel "gpt-test" -Root $agentRoot
$agentRunDir = [string](Last $agentOut)
$agentRun = Get-Content -Raw -LiteralPath (Join-Path $agentRunDir "run.json") | ConvertFrom-Json
Check "new_run records explicit agent adapter" ([string]$agentRun.agent.agent_id -eq "codex" -and [string]$agentRun.agent.agent_role -eq "executor" -and [string]$agentRun.agent.surface -eq "codex" -and [string]$agentRun.agent.model -eq "gpt-test" -and [string]$agentRun.agent.adapter_version -eq "v1")

# --- update_run: log a command + evidence link ----------------------------------------
Write-Host "`n[lifecycle] update_run" -ForegroundColor Cyan
& $updateRun -Command "pytest -k navbar" -Result "1 passed" -Note "green" -EvidenceLink "runs/$runId/evidence.md" -Root $Sandbox | Out-Null
$cmdJsonl = Join-Path $runDir "commands.jsonl"
$cmdLines = @(Get-Content -LiteralPath $cmdJsonl | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
# R10: commands.jsonl actually gets written and each line parses as JSON.
$cmdParses = $true
foreach ($l in $cmdLines) { try { $null = $l | ConvertFrom-Json } catch { $cmdParses = $false } }
Check "R10 update_run appends parseable commands.jsonl" ($cmdLines.Count -eq 1 -and $cmdParses)
$run = Get-Content -Raw -LiteralPath $runJson | ConvertFrom-Json
Check "update_run adds evidence link" (@($run.evidence_links).Count -eq 1)

# Hand-write evidence.md content that completion must NOT destroy.
$marker = "HANDWRITTEN-EVIDENCE-42"
Add-Content -LiteralPath (Join-Path $runDir "evidence.md") -Value "- $marker"

# --- complete_run ----------------------------------------------------------------------
Write-Host "`n[lifecycle] complete_run" -ForegroundColor Cyan
& $completeRun -RunId $runId -Status shipped -FinalOutcome "Navbar fixed" -ReviewerResult "No must-fix" -Evidence "pytest + lint green" -Root $Sandbox | Out-Null
$run = Get-Content -Raw -LiteralPath $runJson | ConvertFrom-Json
Check "complete_run sets status shipped" ($run.status -eq "shipped")
Check "complete_run sets completed_at" (-not [string]::IsNullOrWhiteSpace([string]$run.completed_at))
# R3: hand-written evidence survives completion (append, not overwrite).
$evidenceText = Get-Content -Raw -LiteralPath (Join-Path $runDir "evidence.md")
Check "R3 completion preserves hand-written evidence" ($evidenceText -match [regex]::Escape($marker))
Check "R3 completion appends its own section" ($evidenceText -match "## Completion")

# R4: second complete without -Force is refused; with -Force logs run_amended (not run_completed).
$refused = $false
try { & $completeRun -RunId $runId -Status shipped -Root $Sandbox 2>$null | Out-Null } catch { $refused = $true }
Check "R4 re-complete without -Force is refused" $refused
& $completeRun -RunId $runId -Status shipped -Force -Root $Sandbox | Out-Null
$events = @(Get-Content -LiteralPath (Join-Path $Sandbox "metrics\runs.jsonl") | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
$completedEvents = @($events | Where-Object { $_.type -eq "run_completed" -and $_.run_id -eq $runId })
$amendedEvents = @($events | Where-Object { $_.type -eq "run_amended" -and $_.run_id -eq $runId })
Check "R4 exactly one run_completed event" ($completedEvents.Count -eq 1) ("got " + $completedEvents.Count)
Check "R4 amend logs run_amended" ($amendedEvents.Count -eq 1)

# R7: files_changed with exactly one element must serialize as a JSON array, not a scalar
# string (finding #39 - a pipeline return unwrapped a 1-element result before assignment).
$r7 = & $newRun -Objective "single file change" -Repo $Sandbox -Root $Sandbox
$r7Id = Split-Path -Leaf ([string](Last $r7))
& $completeRun -RunId $r7Id -Status shipped -FilesChanged 'only.txt' -Root $Sandbox | Out-Null
$r7Raw = Get-Content -Raw -LiteralPath (Join-Path $Sandbox "runs\$r7Id\run.json")
Check "R7 single-element files_changed is a JSON array" ($r7Raw -match '"files_changed":\s*\[\s*"only\.txt"\s*\]') ("json: " + ($r7Raw -replace '\s+', ' '))

# --- capture_failure (twice - the Measure-Object/D4 crash) -----------------------------
Write-Host "`n[failures] capture_failure x2" -ForegroundColor Cyan
$c1 = & $captureFailure -Summary "Reviewer caught wrong order flow" -FailureClass weak_verification -Severity must_fix -LinkedRun $runId -ReproCommand 'pytest -k "order,confirm"' -Root $Sandbox
$case1Dir = [string](Last $c1)
# R1: the second capture must NOT crash (Double -> {0:D4}).
$secondOk = $true
$case2Dir = ""
try {
    $c2 = & $captureFailure -Summary "Second failure to prove no crash" -FailureClass test_failure -Severity should_fix -Root $Sandbox
    $case2Dir = [string](Last $c2)
}
catch { $secondOk = $false }
Check "R1 capture_failure works a second time (no D4 crash)" ($secondOk -and (Test-Path -LiteralPath $case2Dir))
Check "R1 case IDs increment" ((Split-Path -Leaf $case1Dir) -like "CASE-0001*" -and (Split-Path -Leaf $case2Dir) -like "CASE-0002*")

# R2b: failure.json has no BOM.
Check "R2 failure.json has no BOM" ((Get-FirstByte (Join-Path $case1Dir "failure.json")) -ne 0xEF)
# R9: repro.md has a real ```powershell fence (not a collapsed single backtick).
$repro = Get-Content -Raw -LiteralPath (Join-Path $case1Dir "repro.md")
Check "R9 repro.md fence renders as triple-backtick" ($repro -match '```powershell')
# R8: linked-run had linked_failures written back without a StrictMode crash.
$run = Get-Content -Raw -LiteralPath $runJson | ConvertFrom-Json
Check "R8 capture links case into run.json" (@($run.linked_failures) -contains "CASE-0001")

# R8b: linking into a run.json that LACKS linked_failures must not crash.
$legacyRun = Join-Path $Sandbox "runs\legacy-run"
New-Item -ItemType Directory -Force -Path $legacyRun | Out-Null
'{"run_id":"legacy-run","status":"in_progress","created_at":"2026-07-08T10:00:00-04:00"}' | Set-Content -LiteralPath (Join-Path $legacyRun "run.json") -Encoding UTF8
$legacyOk = $true
try { & $captureFailure -Summary "legacy link" -FailureClass tool_error -LinkedRun "legacy-run" -Root $Sandbox | Out-Null } catch { $legacyOk = $false }
Check "R8b linking into run.json without linked_failures does not crash" $legacyOk

# --- resolve_failure -------------------------------------------------------------------
Write-Host "`n[failures] resolve_failure" -ForegroundColor Cyan
& $resolveFailure -CaseId "CASE-0001" -Status fixed -RegressionTest "tests/run_tests.ps1::R1" -PreventionLayer "project test" -FixSummary "Cast to int" -Root $Sandbox | Out-Null
$fj = Get-Content -Raw -LiteralPath (Join-Path $case1Dir "failure.json") | ConvertFrom-Json
Check "R11 resolve_failure closes the case" ($fj.status -eq "fixed" -and -not [string]::IsNullOrWhiteSpace([string]$fj.resolved_at))
Check "R11 resolve_failure records regression + prevention" ($fj.regression_test -eq "tests/run_tests.ps1::R1" -and $fj.prevention_layer -eq "project test")

# --- summarize_metrics -----------------------------------------------------------------
Write-Host "`n[metrics] summarize_metrics" -ForegroundColor Cyan
# R6: a run.json missing expected fields must not crash the summary (legacy-run above lacks most).
$summaryOk = $true
try { & $summarize -Root $Sandbox | Out-Null } catch { $summaryOk = $false }
Check "R6 summarize survives a field-sparse run.json (StrictMode-safe)" $summaryOk
$summaryJson = Join-Path $Sandbox "metrics\summary.json"
Check "R2 summary.json has no BOM" ((Get-FirstByte $summaryJson) -ne 0xEF)
$sum = Get-Content -Raw -LiteralPath $summaryJson | ConvertFrom-Json
# R5: shipped run without real evidence links + stub evidence.md must NOT count as 100%.
# Our shipped run HAS a hand-written evidence bullet, so it counts; the legacy run does not.
Check "R5 evidence rate is honest (not forced to 100%)" ($sum.validation_evidence_rate_percent -lt 100) ("rate=" + $sum.validation_evidence_rate_percent)
Check "R11 summary counts a resolved failure" ($sum.failures_resolved -ge 1)
Check "summary counts must-fix failures" ($sum.must_fix_failures -ge 1)

# --- diff capture against a real git repo (finding #41) --------------------------------
# git writes benign warnings (e.g. "LF will be replaced by CRLF") to stderr, which PS 5.1
# turns into terminating errors under EAP=Stop; drop to Continue for this section's own
# git setup (the scripts under test guard themselves internally).
$ErrorActionPreference = "Continue"
Write-Host "`n[diff] -CaptureDiff produces an appliable patch" -ForegroundColor Cyan
$gitOk = $true
try { $null = & git --version 2>$null } catch { $gitOk = $false }
if ($gitOk) {
    $gitRepo = Join-Path $Sandbox "target-repo"
    New-Item -ItemType Directory -Force -Path $gitRepo | Out-Null
    Push-Location $gitRepo
    try {
        & git init -q 2>$null
        & git config user.email "t@t" 2>$null
        & git config user.name "t" 2>$null
        & git config core.autocrlf false 2>$null
        Set-Content -LiteralPath (Join-Path $gitRepo "tracked.txt") -Value "line1`nline2" -Encoding UTF8
        & git add -A 2>$null; & git commit -qm "base" 2>$null
        # Modify a tracked file and add an untracked (and an EMPTY untracked - the old bug).
        Add-Content -LiteralPath (Join-Path $gitRepo "tracked.txt") -Value "line3"
        Set-Content -LiteralPath (Join-Path $gitRepo "newfile.txt") -Value "brand new" -Encoding UTF8
        New-Item -ItemType File -Force -Path (Join-Path $gitRepo "empty.txt") | Out-Null
        # A non-ASCII untracked filename (built via char code so this source stays ASCII).
        # Regression for the reviewer's MUST-FIX: when a filename is round-tripped back through
        # PowerShell (PS 5.1 decodes git's UTF-8 stdout via the console OEM codepage, e.g.
        # IBM437), the mojibake name fails `add -N` and the file drops from the patch. It (and
        # the plain untracked siblings) must STILL be captured.
        $nonAscii = "caf" + [char]0xE9 + ".txt"
        Set-Content -LiteralPath (Join-Path $gitRepo $nonAscii) -Value "accented name" -Encoding UTF8
    }
    finally { Pop-Location }

    $dr = & $newRun -Objective "diff capture test" -Repo $gitRepo -Root $Sandbox
    $diffRunId = Split-Path -Leaf ([string](Last $dr))
    & $completeRun -RunId $diffRunId -Status shipped -Repo $gitRepo -CaptureDiff -Root $Sandbox | Out-Null
    $patch = Join-Path $Sandbox "runs\$diffRunId\diff.patch"
    $patchText = Get-Content -Raw -LiteralPath $patch
    Check "diff.patch is non-empty" (-not [string]::IsNullOrWhiteSpace($patchText))
    Check "diff.patch has no invalid empty hunk" ($patchText -notmatch '@@ -0,0 \+1,0 @@')
    Check "diff.patch includes the untracked new file" ($patchText -match 'newfile\.txt')
    # R14: with a non-ASCII untracked sibling present, BOTH it and the plain untracked files
    # must be captured (before the fix, the mojibake name failed add -N and dropped from the
    # patch; the fix lets git enumerate '.' itself so no name round-trips through PowerShell).
    Check "R14 non-ASCII untracked filename does not drop other untracked files" ($patchText -match 'accented name' -and $patchText -match 'brand new')

    # The real test: git apply --check must accept it against a clean clone of the base commit.
    $clone = Join-Path $Sandbox "clone"
    & git clone -q $gitRepo $clone 2>$null
    $applyOk = $true
    Push-Location $clone
    try { & git apply --check --whitespace=nowarn $patch 2>$null; if ($LASTEXITCODE -ne 0) { $applyOk = $false } }
    catch { $applyOk = $false }
    finally { Pop-Location }
    Check "R13 captured diff applies cleanly (git apply --check)" $applyOk
}
else {
    Write-Host "  SKIP  git not available - diff capture test skipped" -ForegroundColor Yellow
}

# --- v1.1 hardening regressions ----------------------------------------------------------
# All non-ASCII test data is built via [char] codes so this source file stays ASCII.
$eAcute = [char]0xE9

# R15: secret-exclusion globs actually keep secrets out of diff.patch (was never tested;
# a silent regression here ships credentials into a tracked artifact).
Write-Host "`n[v1.1] R15 secret exclusion in -CaptureDiff" -ForegroundColor Cyan
if ($gitOk) {
    $secRepo = Join-Path $Sandbox "secrets-repo"
    New-Item -ItemType Directory -Force -Path $secRepo | Out-Null
    Push-Location $secRepo
    try {
        & git init -q 2>$null
        & git config user.email "t@t" 2>$null
        & git config user.name "t" 2>$null
        Set-Content -LiteralPath (Join-Path $secRepo "base.txt") -Value "base" -Encoding UTF8
        & git add -A 2>$null; & git commit -qm "base" 2>$null
        Set-Content -LiteralPath (Join-Path $secRepo ".env") -Value "AWS_KEY=SECRETVALUE123" -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $secRepo "key.pem") -Value "PEMSECRET456" -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $secRepo "plain.txt") -Value "plain new content" -Encoding UTF8
    }
    finally { Pop-Location }
    $sr = & $newRun -Objective "secret exclusion test" -Repo $secRepo -Root $Sandbox
    $srId = Split-Path -Leaf ([string](Last $sr))
    & $completeRun -RunId $srId -Status shipped -Repo $secRepo -CaptureDiff -Root $Sandbox | Out-Null
    $secPatch = Get-Content -Raw -LiteralPath (Join-Path $Sandbox "runs\$srId\diff.patch")
    Check "R15 .env content stays out of diff.patch" ($secPatch -notmatch 'SECRETVALUE123')
    Check "R15 .pem content stays out of diff.patch" ($secPatch -notmatch 'PEMSECRET456')
    Check "R15 non-secret untracked file is still captured" ($secPatch -match 'plain new content')
}
else { Write-Host "  SKIP  git not available" -ForegroundColor Yellow }

# R16: a changed file with non-UTF-8 bytes (Latin-1 0xE9) must not corrupt diff.patch
# (the old string round-trip turned invalid sequences into U+FFFD; git apply rejected it).
Write-Host "`n[v1.1] R16 non-UTF-8 file content survives -CaptureDiff" -ForegroundColor Cyan
if ($gitOk) {
    $latRepo = Join-Path $Sandbox "latin1-repo"
    New-Item -ItemType Directory -Force -Path $latRepo | Out-Null
    Push-Location $latRepo
    try {
        & git init -q 2>$null
        & git config user.email "t@t" 2>$null
        & git config user.name "t" 2>$null
        & git config core.autocrlf false 2>$null
        [System.IO.File]::WriteAllBytes((Join-Path $latRepo "latin1.txt"), [byte[]](0x63, 0x61, 0x66, 0xE9, 0x0A))
        & git add -A 2>$null; & git commit -qm "base" 2>$null
        [System.IO.File]::WriteAllBytes((Join-Path $latRepo "latin1.txt"), [byte[]](0x63, 0x61, 0x66, 0xE9, 0x0A, 0xE9, 0xE9, 0x0A))
    }
    finally { Pop-Location }
    $lr = & $newRun -Objective "latin1 diff test" -Repo $latRepo -Root $Sandbox
    $lrId = Split-Path -Leaf ([string](Last $lr))
    & $completeRun -RunId $lrId -Status shipped -Repo $latRepo -CaptureDiff -Root $Sandbox | Out-Null
    $latPatch = Join-Path $Sandbox "runs\$lrId\diff.patch"
    $latClone = Join-Path $Sandbox "latin1-clone"
    & git clone -q $latRepo $latClone 2>$null
    $latOk = $true
    Push-Location $latClone
    try { & git apply --check --whitespace=nowarn $latPatch 2>$null; if ($LASTEXITCODE -ne 0) { $latOk = $false } }
    catch { $latOk = $false }
    finally { Pop-Location }
    Check "R16 patch with non-UTF-8 bytes applies cleanly" $latOk
    $latBytes = [System.IO.File]::ReadAllBytes($latPatch)
    # A raw 0xE9 byte can only survive if the patch was never decoded to a string
    # (UTF-8 decoding would have replaced it with the 3-byte U+FFFD sequence).
    Check "R16 raw 0xE9 byte preserved (no U+FFFD substitution)" ($latBytes -contains 0xE9)
}
else { Write-Host "  SKIP  git not available" -ForegroundColor Yellow }

# R17/R18: cross-process races. Parallel update_run calls must not lose evidence links
# (last-writer-wins on run.json); parallel capture_failure calls must not allocate the
# same CASE number for different slugs.
Write-Host "`n[v1.1] R17/R18 cross-process races" -ForegroundColor Cyan
$raceRoot = Join-Path $Sandbox "race-root"
New-Item -ItemType Directory -Force -Path $raceRoot | Out-Null
$rr = & $newRun -Objective "race target run" -Repo $raceRoot -Root $raceRoot
$raceRunId = Split-Path -Leaf ([string](Last $rr))
$procs = @()
1..8 | ForEach-Object {
    $procs += Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $updateRun,
        "-RunId", $raceRunId, "-EvidenceLink", "race-link-$_", "-Root", $raceRoot)
}
$procs | ForEach-Object { [void]$_.WaitForExit(90000) }
$raceRun = Get-Content -Raw -LiteralPath (Join-Path $raceRoot "runs\$raceRunId\run.json") | ConvertFrom-Json
Check "R17 8 parallel evidence links all survive (no lost update)" (@($raceRun.evidence_links).Count -eq 8) ("got " + @($raceRun.evidence_links).Count)

$procs = @()
1..5 | ForEach-Object {
    $procs += Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $captureFailure,
        "-Summary", "parallel-case-$_", "-FailureClass", "tool_error", "-Severity", "note", "-Root", $raceRoot)
}
$procs | ForEach-Object { [void]$_.WaitForExit(90000) }
$caseNums = @(Get-ChildItem -LiteralPath (Join-Path $raceRoot "failures") -Directory | ForEach-Object {
    if ($_.Name -match "^CASE-(\d+)_") { $Matches[1] }
})
Check "R18 5 parallel captures allocate 5 distinct case IDs" ((@($caseNums | Sort-Object -Unique).Count -eq 5) -and ($caseNums.Count -eq 5)) ("ids: " + ($caseNums -join ","))

# R20: scripts exit 0 on success even when git probes failed along the way (a non-git repo
# leaves git's exit 128 in $LASTEXITCODE, which read as failure to in-process callers).
Write-Host "`n[v1.1] R19/R20 auto-detect strictness + exit codes" -ForegroundColor Cyan
& $newRun -Objective "second in-progress run" -Repo $raceRoot -Root $raceRoot | Out-Null
Check "R20 new_run exits 0 in-process on a non-git repo" ($LASTEXITCODE -eq 0) ("LASTEXITCODE=" + $LASTEXITCODE)

# R19: with TWO in-progress runs, auto-detect (no -RunId) must refuse, not guess.
$ambUpdate = $false
try { & $updateRun -Command "x" -Root $raceRoot 2>$null | Out-Null } catch { $ambUpdate = $true }
$ambComplete = $false
try { & $completeRun -Status shipped -Root $raceRoot 2>$null | Out-Null } catch { $ambComplete = $true }
Check "R19 update_run refuses ambiguous auto-detect (2 in-progress runs)" $ambUpdate
Check "R19 complete_run refuses ambiguous auto-detect (2 in-progress runs)" $ambComplete

# R21/R22: non-ASCII branch and file names must land in run.json intact (PS 5.1 decodes git
# stdout via the OEM codepage unless pinned to UTF-8 - same class as the R14 patch bug).
Write-Host "`n[v1.1] R21/R22 non-ASCII branch + files_changed" -ForegroundColor Cyan
if ($gitOk) {
    # Space in the repo path also exercises ProcessStartInfo argument quoting.
    $accRepo = Join-Path $Sandbox "accent repo"
    New-Item -ItemType Directory -Force -Path $accRepo | Out-Null
    $accBranch = "caf" + $eAcute + "-branch"
    Push-Location $accRepo
    try {
        & git init -q 2>$null
        & git config user.email "t@t" 2>$null
        & git config user.name "t" 2>$null
        Set-Content -LiteralPath (Join-Path $accRepo "base.txt") -Value "base" -Encoding UTF8
        & git add -A 2>$null; & git commit -qm "base" 2>$null
        & git checkout -q -b $accBranch 2>$null
        Set-Content -LiteralPath (Join-Path $accRepo ("r22-caf" + $eAcute + ".txt")) -Value "acc" -Encoding UTF8
    }
    finally { Pop-Location }
    $ar = & $newRun -Objective "accent branch test" -Repo $accRepo -Root $Sandbox
    $arId = Split-Path -Leaf ([string](Last $ar))
    $arRun = Read-Utf8Json (Join-Path $Sandbox "runs\$arId\run.json")
    Check "R21 non-ASCII branch name recorded intact" ($arRun.branch -ceq $accBranch) ("got: " + $arRun.branch)
    & $completeRun -RunId $arId -Status shipped -Repo $accRepo -Root $Sandbox | Out-Null
    $arRun = Read-Utf8Json (Join-Path $Sandbox "runs\$arId\run.json")
    Check "R22 non-ASCII filename in files_changed recorded intact" (@($arRun.files_changed) -ccontains ("r22-caf" + $eAcute + ".txt")) ("got: " + (@($arRun.files_changed) -join " | "))
}
else { Write-Host "  SKIP  git not available" -ForegroundColor Yellow }

# R23: bad -Repo fails BEFORE claiming a run directory (no orphaned ID-claiming folder).
Write-Host "`n[v1.1] R23/R24/R25 guard rails" -ForegroundColor Cyan
$runCountBefore = @(Get-ChildItem -LiteralPath (Join-Path $Sandbox "runs") -Directory).Count
$wsThrew = $false
try { & $newRun -Objective "ws repo" -Repo "   " -Root $Sandbox 2>$null | Out-Null } catch { $wsThrew = $true }
$runCountAfter = @(Get-ChildItem -LiteralPath (Join-Path $Sandbox "runs") -Directory).Count
Check "R23 whitespace -Repo throws and leaves no orphan run dir" ($wsThrew -and ($runCountAfter -eq $runCountBefore))

# R24: completing a legacy run.json that has NO repo field must not crash (Test-Path "" bound).
$noRepoRun = Join-Path $Sandbox "runs\no-repo-run"
New-Item -ItemType Directory -Force -Path $noRepoRun | Out-Null
'{"run_id":"no-repo-run","status":"in_progress","created_at":"2026-07-08T09:00:00-04:00"}' | Set-Content -LiteralPath (Join-Path $noRepoRun "run.json") -Encoding UTF8
$noRepoOk = $true
try { & $completeRun -RunId "no-repo-run" -Status complete -Root $Sandbox | Out-Null } catch { $noRepoOk = $false }
Check "R24 complete_run survives run.json without a repo field" $noRepoOk

# R25: -Force amend adds content without clobbering the original completion timestamp.
$beforeAmend = (Get-Content -Raw -LiteralPath $runJson | ConvertFrom-Json).completed_at
& $completeRun -RunId $runId -Status shipped -Force -Evidence "amend evidence R25" -Root $Sandbox | Out-Null
$afterAmend = Get-Content -Raw -LiteralPath $runJson | ConvertFrom-Json
Check "R25 amend preserves completed_at and stamps last_amended_at" (($afterAmend.completed_at -eq $beforeAmend) -and (-not [string]::IsNullOrWhiteSpace([string]$afterAmend.last_amended_at)))
Check "R25 amend appends the new evidence text" ((Get-Content -Raw -LiteralPath (Join-Path $runDir "evidence.md")) -match "amend evidence R25")

# R26: metrics pinned against a crafted fixture - exact counts, not -ge/-lt smoke checks.
Write-Host "`n[v1.1] R26-R31 pinned metrics fixture" -ForegroundColor Cyan
$fixRoot = Join-Path $Sandbox "fixture-root"
New-Item -ItemType Directory -Force -Path $fixRoot | Out-Null
$f1 = & $newRun -Objective "fixture run one" -Repo $fixRoot -Root $fixRoot
$f1Id = Split-Path -Leaf ([string](Last $f1))
$f2 = & $newRun -Objective "fixture run two" -Repo $fixRoot -Root $fixRoot
$f2Id = Split-Path -Leaf ([string](Last $f2))
& $completeRun -RunId $f1Id -Status shipped -Evidence "fixture evidence green" -Root $fixRoot | Out-Null
Add-Content -LiteralPath (Join-Path $fixRoot "runs\$f2Id\evidence.md") -Value "- TBD (fill in later)"
$fc1 = & $captureFailure -Summary "fixture must-fix" -FailureClass test_failure -Severity must_fix -LinkedRun $f1Id -Repo $fixRoot -Root $fixRoot
& $captureFailure -Summary "fixture note" -FailureClass tool_error -Severity note -Expected "expected text E2" -Actual "actual text A2" -Repo $fixRoot -Root $fixRoot | Out-Null
& $resolveFailure -CaseId "CASE-0001" -Status wont_fix -Root $fixRoot | Out-Null
& $summarize -Root $fixRoot | Out-Null
$fixSum = Get-Content -Raw -LiteralPath (Join-Path $fixRoot "metrics\summary.json") | ConvertFrom-Json
Check "R26 runs_started pinned (2)" ($fixSum.runs_started -eq 2) ("got " + $fixSum.runs_started)
Check "R26 runs_shipped pinned (1)" ($fixSum.runs_shipped -eq 1) ("got " + $fixSum.runs_shipped)
Check "R26 failed_runs pinned (1)" ($fixSum.failed_runs -eq 1) ("got " + $fixSum.failed_runs)
Check "R26 failures pinned (total 2, open 1, resolved 0, wont_fix 1)" (($fixSum.failures_total -eq 2) -and ($fixSum.failures_open -eq 1) -and ($fixSum.failures_resolved -eq 0) -and ($fixSum.failures_wont_fix -eq 1)) ("got t=" + $fixSum.failures_total + " o=" + $fixSum.failures_open + " r=" + $fixSum.failures_resolved + " w=" + $fixSum.failures_wont_fix)
Check "R26 evidence rate honest at 50% (-Evidence bullet counts; '- TBD (...)' stub does not)" ($fixSum.validation_evidence_rate_percent -eq 50) ("got " + $fixSum.validation_evidence_rate_percent)
Check "R26 must_fix pinned (1)" ($fixSum.must_fix_failures -eq 1)

# R27: -Json output is machine-parseable and agrees with summary.json.
$fixJson = (& $summarize -Root $fixRoot -Json) | Out-String | ConvertFrom-Json
Check "R27 summarize -Json parses and matches summary.json" ($fixJson.runs_started -eq $fixSum.runs_started -and $fixJson.failures_wont_fix -eq $fixSum.failures_wont_fix)

# R29: evidence-link dedup is case-sensitive (URLs/paths differing by case are distinct).
& $updateRun -RunId $f2Id -EvidenceLink "Docs/Evidence.md" -Root $fixRoot | Out-Null
& $updateRun -RunId $f2Id -EvidenceLink "docs/evidence.md" -Root $fixRoot | Out-Null
$f2Run = Get-Content -Raw -LiteralPath (Join-Path $fixRoot "runs\$f2Id\run.json") | ConvertFrom-Json
Check "R29 case-differing evidence links both kept" (@($f2Run.evidence_links).Count -eq 2) ("got " + (@($f2Run.evidence_links) -join " | "))

# R30: guard-rail error paths actually throw.
$noopThrew = $false
try { & $updateRun -RunId $f2Id -Root $fixRoot 2>$null | Out-Null } catch { $noopThrew = $true }
$missingThrew = $false
try { & $completeRun -RunId "nope-123" -Status shipped -Root $fixRoot 2>$null | Out-Null } catch { $missingThrew = $true }
Check "R30 update_run with nothing to do throws" $noopThrew
Check "R30 complete_run on a missing run throws" $missingThrew

# R31: capture_failure routes -Expected/-Actual into the case narrative files.
$fixCase2 = @(Get-ChildItem -LiteralPath (Join-Path $fixRoot "failures") -Directory | Where-Object { $_.Name -like "CASE-0002*" })[0].FullName
Check "R31 -Expected lands in expected.md" ((Get-Content -Raw -LiteralPath (Join-Path $fixCase2 "expected.md")) -match "expected text E2")
Check "R31 -Actual lands in actual.md" ((Get-Content -Raw -LiteralPath (Join-Path $fixCase2 "actual.md")) -match "actual text A2")

# R28: self-capture (repo == data root) excludes runs/ + metrics/ bookkeeping from diff.patch.
Write-Host "`n[v1.1] R28 self-capture bookkeeping exclusion" -ForegroundColor Cyan
if ($gitOk) {
    $selfRoot = Join-Path $Sandbox "self-root"
    New-Item -ItemType Directory -Force -Path $selfRoot | Out-Null
    Push-Location $selfRoot
    try {
        & git init -q 2>$null
        & git config user.email "t@t" 2>$null
        & git config user.name "t" 2>$null
        Set-Content -LiteralPath (Join-Path $selfRoot "base.txt") -Value "base" -Encoding UTF8
        & git add -A 2>$null; & git commit -qm "base" 2>$null
        Add-Content -LiteralPath (Join-Path $selfRoot "base.txt") -Value "real change"
    }
    finally { Pop-Location }
    $sf = & $newRun -Objective "self capture test" -Repo $selfRoot -Root $selfRoot
    $sfId = Split-Path -Leaf ([string](Last $sf))
    & $summarize -Root $selfRoot | Out-Null
    & $completeRun -RunId $sfId -Status shipped -Repo $selfRoot -CaptureDiff -Root $selfRoot | Out-Null
    $selfPatch = Get-Content -Raw -LiteralPath (Join-Path $selfRoot "runs\$sfId\diff.patch")
    Check "R28 real change captured on self-capture" ($selfPatch -match 'diff --git a/base\.txt')
    Check "R28 runs/ + metrics/ bookkeeping excluded from self-capture" (($selfPatch -notmatch 'diff --git a/runs/') -and ($selfPatch -notmatch 'diff --git a/metrics/'))
}
else { Write-Host "  SKIP  git not available" -ForegroundColor Yellow }

# --- summary ---------------------------------------------------------------------------
Write-Host ("`n{0} passed, {1} failed" -f $script:Pass, $script:Fail) -ForegroundColor $(if ($script:Fail -eq 0) { "Green" } else { "Red" })
if ($script:Fail -gt 0) {
    Write-Host ("Failed: {0}" -f ($script:Failures -join ", ")) -ForegroundColor Red
    Write-Host ("Sandbox kept for inspection: {0}" -f $Sandbox) -ForegroundColor Yellow
    exit 1
}
# Clean up on success.
Remove-Item -LiteralPath $Sandbox -Recurse -Force -ErrorAction SilentlyContinue
exit 0
