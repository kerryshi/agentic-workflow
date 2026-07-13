# _common.ps1 - shared helpers for the Agentic Workflow v1 reliability-layer scripts.
# Dot-sourced by new_run / update_run / complete_run / capture_failure / resolve_failure /
# summarize_metrics. Windows PowerShell 5.1 safe: BOM-less UTF-8 writers, StrictMode-safe
# property access, and native-git calls that don't trip $ErrorActionPreference=Stop.

Set-StrictMode -Version Latest

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function New-Slug {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
        [int]$MaxLength = 40,
        [string]$Fallback = "item"
    )
    $slug = [regex]::Replace($Text.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim("-")
    if ($slug.Length -gt $MaxLength) {
        $slug = $slug.Substring(0, $MaxLength)
        # Trim back to the last word boundary so IDs don't end mid-word (keep >= 8 chars).
        $lastDash = $slug.LastIndexOf("-")
        if ($lastDash -ge 8) {
            $slug = $slug.Substring(0, $lastDash)
        }
        $slug = $slug.Trim("-")
    }
    if ([string]::IsNullOrWhiteSpace($slug)) {
        return $Fallback
    }
    return $slug
}

function ConvertTo-RepoPath {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }
    if (Test-Path -LiteralPath $Path) {
        return (Resolve-Path -LiteralPath $Path).Path
    }
    return $Path
}

function Resolve-DataRoot {
    # Data root holds runs/ failures/ metrics/. Defaults to the repo (parent of scripts/);
    # overridable via -Root for tests so they never touch real records.
    param(
        [AllowEmptyString()][string]$Root,
        [Parameter(Mandatory = $true)][string]$ScriptRoot
    )
    if (-not [string]::IsNullOrWhiteSpace($Root)) {
        New-Item -ItemType Directory -Force -Path $Root | Out-Null
        return (Resolve-Path -LiteralPath $Root).Path
    }
    return (Split-Path -Parent $ScriptRoot)
}

# --- StrictMode-safe property access on ConvertFrom-Json objects ------------------------

function Get-Prop {
    param($Object, [Parameter(Mandatory = $true)][string]$Name, $Default = $null)

    if ($null -eq $Object) { return $Default }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -ne $prop) { return $prop.Value }
    return $Default
}

function Set-Prop {
    # Assign a property whether or not it already exists (direct dot-assignment to a missing
    # property on a PSCustomObject throws in PS 5.1).
    param($Object, [Parameter(Mandatory = $true)][string]$Name, $Value)

    if ($null -eq $Object) { return }
    if ($Object.PSObject.Properties[$Name]) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    }
}

# --- BOM-less UTF-8 output --------------------------------------------------------------

function Write-TextFile {
    # Atomic: write a sibling temp file, then swap it in. A process killed mid-write can no
    # longer leave a truncated run.json/failure.json behind (CASE-0004 family). The temp file
    # sits in the destination directory so the swap stays on one volume.
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )
    $tmp = "{0}.tmp.{1}" -f $Path, $PID
    [System.IO.File]::WriteAllText($tmp, $Content, $script:Utf8NoBom)
    try {
        if (Test-Path -LiteralPath $Path) {
            [System.IO.File]::Replace($tmp, $Path, $null)
        }
        else {
            [System.IO.File]::Move($tmp, $Path)
        }
    }
    catch {
        # Fallback (e.g. destination appeared between the check and the Move): plain copy.
        [System.IO.File]::Copy($tmp, $Path, $true)
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

# --- Cross-process serialization for read-modify-write sections --------------------------

function Invoke-WithFileLock {
    # Serialize concurrent read-modify-write of a shared file (run.json, failures/ numbering)
    # across processes. Parallel sessions writing the same record otherwise lose updates
    # silently (last writer wins - CASE-0004/0005). Keyed on the path, machine-local.
    # NOTE: the block runs via the call operator, so assignments inside it stay local -
    # return what the caller needs.
    param(
        [Parameter(Mandatory = $true)][string]$LockKey,
        [Parameter(Mandatory = $true)][scriptblock]$LockBody,
        [int]$LockTimeoutMs = 15000
    )
    $lockMd5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $lockHash = -join ($lockMd5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($LockKey.ToLowerInvariant())) | ForEach-Object { $_.ToString("x2") })
    }
    finally { $lockMd5.Dispose() }
    $lockMutex = New-Object System.Threading.Mutex($false, ("Local\agentic-workflow-" + $lockHash))
    $lockAcquired = $false
    try {
        try { $lockAcquired = $lockMutex.WaitOne($LockTimeoutMs) }
        catch [System.Threading.AbandonedMutexException] { $lockAcquired = $true } # prior holder died; lock is ours
        if (-not $lockAcquired) { throw "Timed out waiting for lock on $LockKey" }
        & $LockBody
    }
    finally {
        if ($lockAcquired) { [void]$lockMutex.ReleaseMutex() }
        $lockMutex.Dispose()
    }
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Object,
        [int]$Depth = 12
    )
    $json = $Object | ConvertTo-Json -Depth $Depth
    Write-TextFile -Path $Path -Content $json
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    # Records are intentionally BOM-less UTF-8. Windows PowerShell 5.1 treats a BOM-less
    # Get-Content read as the active ANSI codepage, so decode explicitly before parsing.
    return ([System.IO.File]::ReadAllText($Path, $script:Utf8NoBom) | ConvertFrom-Json)
}

function Add-JsonlEvent {
    # Append one compact JSON object as a line to a JSONL file, BOM-less, LF-terminated so
    # strict line parsers (python json.loads, jq, node) accept every record.
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Event
    )
    $line = ($Event | ConvertTo-Json -Compress -Depth 8)
    [System.IO.File]::AppendAllText($Path, $line + "`n", $script:Utf8NoBom)
}

# --- Native git (no Select-Object early-stop; no stderr-as-terminating-error) -----------

function ConvertTo-NativeArgument {
    # Quote one argument using the Windows CommandLineToArgvW / C runtime rules used by
    # ProcessStartInfo.Arguments. This keeps repo paths with spaces and literal quotes intact.
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $slashes = 0
    foreach ($ch in $Value.ToCharArray()) {
        if ($ch -eq '\') {
            $slashes += 1
            continue
        }
        if ($ch -eq '"') {
            if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
            [void]$builder.Append('\"')
            $slashes = 0
            continue
        }
        if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
        [void]$builder.Append($ch)
    }
    # Backslashes before the closing quote must be doubled.
    if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-GitLines {
    # Run git and return stdout decoded explicitly as UTF-8, or @() on failure. Windows
    # PowerShell 5.1 decodes `& git` pipeline output through the host/OEM codepage even when
    # [Console]::OutputEncoding is changed; ProcessStartInfo.StandardOutputEncoding avoids
    # that host-dependent round-trip and preserves branch/file names such as cafe-with-accent.
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$RepoPath,
        [Parameter(Mandatory = $true)][string[]]$GitArgs
    )
    if ([string]::IsNullOrWhiteSpace($RepoPath) -or -not (Test-Path -LiteralPath $RepoPath)) {
        return @()
    }
    $process = $null
    try {
        $git = Get-Command git -ErrorAction Stop
        $allArgs = @('-C', $RepoPath) + @($GitArgs)

        $start = New-Object System.Diagnostics.ProcessStartInfo
        $start.FileName = $git.Source
        $start.Arguments = (($allArgs | ForEach-Object { ConvertTo-NativeArgument -Value ([string]$_) }) -join ' ')
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.StandardOutputEncoding = $script:Utf8NoBom
        $start.StandardErrorEncoding = $script:Utf8NoBom

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $start
        if (-not $process.Start()) { return @() }

        # Drain both streams asynchronously so a noisy git error cannot fill stderr and deadlock.
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $null = $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0 -or [string]::IsNullOrEmpty($stdout)) { return @() }

        $stdout = $stdout.TrimEnd([char[]]@("`r", "`n"))
        if ($stdout.Length -eq 0) { return @() }
        return @($stdout -split "`r?`n")
    }
    catch {
        return @()
    }
    finally {
        if ($null -ne $process) { $process.Dispose() }
    }
}

function Invoke-GitLine {
    # First stdout line of a git call, or "" on any failure.
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$RepoPath,
        [Parameter(Mandatory = $true)][string[]]$GitArgs
    )
    $out = @(Invoke-GitLines -RepoPath $RepoPath -GitArgs $GitArgs)
    if ($out.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$out[0])) {
        return ([string]$out[0]).Trim()
    }
    return ""
}

function Get-GitBranch {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$RepoPath)
    return (Invoke-GitLine -RepoPath $RepoPath -GitArgs @("rev-parse", "--abbrev-ref", "HEAD"))
}

# --- Active-run resolution (so callers don't retype the long run ID) --------------------

function Get-ActiveRunId {
    # The single in-progress run. Empty string when there is none; THROWS when more than one
    # run is in progress - auto-detect must never silently complete/update a parallel
    # session's record (CASE-0007: it shipped the wrong repo's run). created_at is compared
    # as a parsed [DateTimeOffset] (UTC instant), not as a string: local-time strings with
    # mixed UTC offsets (DST fall-back, cross-machine records) sort wrong lexicographically.
    param([Parameter(Mandatory = $true)][string]$RunsDir)

    if (-not (Test-Path -LiteralPath $RunsDir)) { return "" }
    $candidates = @(Get-ChildItem -LiteralPath $RunsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $rj = Join-Path $_.FullName "run.json"
        if (Test-Path -LiteralPath $rj) {
            try {
                $r = Read-JsonFile $rj
                if ((Get-Prop $r "status") -eq "in_progress") {
                    $created = [System.DateTimeOffset]::MinValue
                    try { $created = [System.DateTimeOffset]::Parse([string](Get-Prop $r "created_at")) } catch { }
                    [pscustomobject]@{ Id = $_.Name; Created = $created }
                }
            }
            catch { }
        }
    } | Where-Object { $_ })
    if ($candidates.Count -eq 0) { return "" }
    # Id is a deterministic secondary key so ties on identical created_at are stable.
    $sorted = @($candidates | Sort-Object Created, Id -Descending)
    if ($sorted.Count -gt 1) {
        $list = (@($sorted | ForEach-Object { $_.Id }) -join ", ")
        throw "Multiple in-progress runs - pass -RunId explicitly. Candidates (newest first): $list"
    }
    return $sorted[0].Id
}
