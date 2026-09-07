# dsh-web-relay idempotent new-env installer (v4.9.2, pure ASCII for PS5.1)
# Steps: plugin offline install (copy + cordis.patch idempotent) -> capability pack
#        (skills sync + docs/scripts mirror) -> watchdog scheduled task (idempotent)
# Usage:
#   powershell -File scripts/install-new-env.ps1 -PluginSource D:\DSH\dsh-web-relay -WhatIf
#   powershell -ExecutionPolicy Bypass -File scripts/install-new-env.ps1 -PluginSource D:\DSH\dsh-web-relay
[CmdletBinding()]
param(
  [string]$PluginSource = '',
  [string]$Profile = 'web',
  [string]$CapabilityPack = '',
  [string]$RepoDest = '',
  [switch]$RegisterWatchdog = $true,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
function Log($m) { Write-Host "[install] $m" }
function Maybe($desc, $action) {
  if ($WhatIf) { Log "[WhatIf] $desc" } else { Log $desc; & $action }
}

$homeDsh = Join-Path $env:USERPROFILE '.dsh'
$profileDir = Join-Path $homeDsh ("profiles\" + $Profile)
if (-not (Test-Path $profileDir)) { throw "profile dir missing: $profileDir (init: dsh --profile $Profile first)" }

# ---------- 1) plugin offline install (idempotent: skip if version matches) ----------
if ($PluginSource) {
  $dst = Join-Path $profileDir ('node_modules' + [IO.Path]::DirectorySeparatorChar + 'dsh-web-relay')
  $srcPkg = Join-Path $PluginSource 'package.json'
  if (-not (Test-Path $srcPkg)) { throw "PluginSource missing package.json: $PluginSource" }
  $needCopy = $true
  if (Test-Path (Join-Path $dst 'package.json')) {
    $sv = (Get-Content $srcPkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $dv = (Get-Content (Join-Path $dst 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($sv -eq $dv) { $needCopy = $false; Log "plugin already v$dv (skip copy)" }
    else { Log "plugin version mismatch (src=$sv dst=$dv) -> overwrite" }
  }
  if ($needCopy) {
    Maybe "copy plugin to $dst" {
      New-Item -ItemType Directory -Force -Path $dst | Out-Null
      Copy-Item (Join-Path $PluginSource 'lib') (Join-Path $dst 'lib') -Recurse -Force
      Copy-Item (Join-Path $PluginSource 'bin') (Join-Path $dst 'bin') -Recurse -Force -ErrorAction SilentlyContinue
      Copy-Item $srcPkg $dst -Force
      Copy-Item (Join-Path $PluginSource 'cordis.patch.yml') $dst -Force
    }
  }
  $patch = Join-Path $profileDir 'cordis.patch.yml'
  if (Test-Path $patch) {
    $has = Select-String -Path $patch -Pattern 'dsh-web-relay' -Quiet
    if (-not $has) {
      Maybe "append plugin row to $patch" {
        Add-Content $patch ("`n- insert:`n  - id: dsh-web-relay`n    name: dsh-web-relay")
      }
    } else { Log 'cordis.patch.yml already has dsh-web-relay (skip append)' }
  } else { Log "warning: no cordis.patch.yml at $patch (profile may have no static plugins yet)" }
}

# ---------- 2) capability pack (skills -> ~/.dsh/skills; docs/scripts -> RepoDest or PluginSource) ----------
if ($CapabilityPack -and (Test-Path $CapabilityPack)) {
  $tmp = Join-Path $env:TEMP ('dsh-relay-pack-' + [guid]::NewGuid().ToString('N'))
  Maybe "extract capability pack -> $tmp (skills sync + docs/scripts mirror)" {
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    tar -xzf $CapabilityPack -C $tmp
    $homeSkills = Join-Path $homeDsh 'skills'
    foreach ($d in Get-ChildItem (Join-Path $tmp 'skills') -Directory) {
      Copy-Item $d.FullName (Join-Path $homeSkills $d.Name) -Recurse -Force
      Log "  skills synced: $($d.Name)"
    }
    $destRoot = if ($RepoDest) { $RepoDest } else { $PluginSource }
    if ($destRoot) {
      Copy-Item (Join-Path $tmp 'docs') (Join-Path $destRoot 'docs') -Recurse -Force
      Copy-Item (Join-Path $tmp 'scripts') (Join-Path $destRoot 'scripts') -Recurse -Force
      Log "  docs/scripts mirrored: $destRoot"
    }
    Remove-Item $tmp -Recurse -Force
  }
}

# ---------- 3) watchdog scheduled task (idempotent) ----------
if ($RegisterWatchdog -and -not $WhatIf) {
  $exists = Get-ScheduledTask -TaskName 'DSH-WEB-Watchdog' -ErrorAction SilentlyContinue
  if ($exists) { Log 'DSH-WEB-Watchdog already exists (skip)' }
  elseif ($PluginSource) {
    $node = (Get-Command node).Source
    $wd = Join-Path $PluginSource 'bin\watchdog.mjs'
    if (Test-Path $wd) {
      Maybe "register scheduled task DSH-WEB-Watchdog ($node $wd)" {
        $action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $wd + '"') -WorkingDirectory $PluginSource
        Register-ScheduledTask -TaskName 'DSH-WEB-Watchdog' -Action $action -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Force | Out-Null
      }
    } else { Log "skip watchdog: no bin\watchdog.mjs under PluginSource" }
  }
}

# ---------- 4) notes ----------
Log 'Done. Next: 1) restart dsh web (Host half loads); 2) setx DSH_RELAY_REPO <repo> (User); 3) optional setx DSH_SESSION_ID (see OPS-RESTART-RESUME s6).'
