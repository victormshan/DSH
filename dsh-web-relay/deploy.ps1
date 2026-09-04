# dsh-web-relay 部署脚本（含版本断言）
# 用法: powershell -ExecutionPolicy Bypass -File deploy.ps1 [-RepoRoot D:\dsh-web-relay]
# 作用: 校验源仓库版本与安装目录版本关系后，将 lib/ + package.json + cordis.patch.yml 复制到安装目录。
# 版本断言规则（改进方案 P1-2 修正：原"相等才部署"方向反了——正常部署场景恰是"源新于装"）：
#   源 > 装 → 允许覆盖（正常升级部署）
#   源 = 装 → 提示已是最新，跳过
#   源 < 装 → 报错阻止（防误回退）
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

# 语义化版本比较（x.y.z 逐段比较；z 缺失按 0 处理）
function Compare-Version([string]$a, [string]$b) {
    $pa = $a -split '\.' | ForEach-Object { [int]($_ -replace '\D', '0') }
    $pb = $b -split '\.' | ForEach-Object { [int]($_ -replace '\D', '0') }
    for ($i = 0; $i -lt [Math]::Max($pa.Count, $pb.Count); $i++) {
        $va = if ($i -lt $pa.Count) { $pa[$i] } else { 0 }
        $vb = if ($i -lt $pb.Count) { $pb[$i] } else { 0 }
        if ($va -ne $vb) { return $va - $vb }
    }
    return 0
}

$cmp = Compare-Version $srcVersion $instVersion
if ($cmp -lt 0) {
    Write-Warning "版本回退风险：源仓库 $srcVersion < 安装目录 $instVersion。"
    Write-Warning "为避免覆盖较新基线，部署已中止。如需强制回退请手动操作并确认。"
    exit 1
}
if ($cmp -eq 0) {
    Write-Host "源仓库与安装目录版本一致（$srcVersion），已是最新，无需部署。"
    exit 0
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

# ---- 复制自动迭代建模 Skill 到 DSH 全局 skills ----
$SkillSrc = "$RepoRoot\skills\auto-iteration-modeling\SKILL.md"
$SkillDestRoot = Join-Path $env:USERPROFILE '.dsh\skills\auto-iteration-modeling'
if (Test-Path $SkillSrc) {
    $null = New-Item -ItemType Directory -Force -Path $SkillDestRoot
    Copy-Item $SkillSrc (Join-Path $SkillDestRoot 'SKILL.md') -Force
    Write-Host "  已部署 Skill: auto-iteration-modeling -> $SkillDestRoot"
} else {
    Write-Warning "未找到 Skill 文件: $SkillSrc，跳过 Skill 部署"
}

# ---- 复制工具排障 Skill 到 DSH 全局 skills ----
$ToolSkillSrc = "$RepoRoot\skills\agent-tool-troubleshooting\SKILL.md"
$ToolSkillDestRoot = Join-Path $env:USERPROFILE '.dsh\skills\agent-tool-troubleshooting'
if (Test-Path $ToolSkillSrc) {
    $null = New-Item -ItemType Directory -Force -Path $ToolSkillDestRoot
    Copy-Item $ToolSkillSrc (Join-Path $ToolSkillDestRoot 'SKILL.md') -Force
    Write-Host "  已部署 Skill: agent-tool-troubleshooting -> $ToolSkillDestRoot"
} else {
    Write-Warning "未找到 Skill 文件: $ToolSkillSrc，跳过 Skill 部署"
}

# ---- 复制 dsh-web-relay 主 agent Skill 到 DSH 全局 skills ----
$MainSkillSrc = "$RepoRoot\skills\dsh-web-relay-main-agent\SKILL.md"
$MainSkillDestRoot = Join-Path $env:USERPROFILE '.dsh\skills\dsh-web-relay-main-agent'
if (Test-Path $MainSkillSrc) {
    $null = New-Item -ItemType Directory -Force -Path $MainSkillDestRoot
    Copy-Item $MainSkillSrc (Join-Path $MainSkillDestRoot 'SKILL.md') -Force
    Write-Host "  已部署 Skill: dsh-web-relay-main-agent -> $MainSkillDestRoot"
} else {
    Write-Warning "未找到 Skill 文件: $MainSkillSrc，跳过 Skill 部署"
}




Write-Host "部署完成（版本 $srcVersion，安装目录 $instVersion → $srcVersion）。请重启 dsh web 使插件生效。"
