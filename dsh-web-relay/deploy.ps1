# dsh-web-relay 部署脚本（含版本断言）
# 用法: powershell -ExecutionPolicy Bypass -File deploy.ps1 [-RepoRoot D:\dsh-web-relay]
# 作用: 校验源仓库版本 == 安装目录版本后，将 lib/ + package.json + cordis.patch.yml 复制到安装目录。
param(
    [string]$RepoRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [string]$InstallDir = "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-web-relay"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path "$RepoRoot\package.json")) { throw "仓库根无效: $RepoRoot（找不到 package.json）" }
if (-not (Test-Path $InstallDir)) { throw "安装目录不存在: $InstallDir" }

# ---- 版本断言（Version Assertion）----
$srcVersion = (Get-Content "$RepoRoot\package.json" -Raw | ConvertFrom-Json).version
$instVersion = (Get-Content "$InstallDir\package.json" -Raw | ConvertFrom-Json).version

Write-Host "源仓库版本: $srcVersion  安装目录版本: $instVersion"

if ($srcVersion -ne $instVersion) {
    Write-Warning "版本不匹配：源仓库 $srcVersion != 安装目录 $instVersion。"
    Write-Warning "为避免在未知基线上强行覆盖，部署已中止。请先确认安装目录状态（如需要可先备份/回退）。"
    exit 1
}

# ---- 部署前备份 ----
$backup = "$InstallDir.bak-$instVersion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $InstallDir $backup -Recurse -Force
Write-Host "已备份当前安装到: $backup"

# ---- 复制 ----
foreach ($f in @('lib\index.js', 'lib\client.js', 'package.json', 'cordis.patch.yml')) {
    Copy-Item "$RepoRoot\$f" "$InstallDir\$f" -Force
    Write-Host "  已部署: $f"
}

Write-Host "部署完成（版本 $srcVersion）。请重启 dsh web 使插件生效。"
