# Skill: agent-tool-troubleshooting

> 用途：当主 agent 会话出现工具缺失、shell 不可用、命令执行失败时使用。
> 归属：平台/工具排障知识。
> 不适用范围：普通业务问题、代码逻辑问题。

## 1. 何时激活

- 当前会话没有 shell / bash / pwsh 工具
- 执行命令报错：`terminal inspection is unsupported on platform win32`
- 需要读取 zstd 会话日志但没有解压工具
- 其他 agent 会话有 shell，但当前会话没有

## 2. 核心判断顺序

不要一开始就认为“当前环境永久无工具”。按以下顺序排查：

1. 检查当前 agent preset
2. 检查 preset 的工具定义
3. 检查平台（Windows/Linux）对应的 shell 配置
4. 如果当前 preset 不适合，考虑修改 settings 或新开会话

## 3. 已知关键知识

### 3.1 agent-presets 与工具

- `minimal`：仅提供持久 bash + str_replace_editor；在 Windows 下 bash 可能不可用。
- `standard`：Windows 下启用 pwsh，Linux 下启用 bash；功能完整。
- `code`：具备标准模式全部能力，并通过 Code Mode SDK 呈现工具。

### 3.2 配置文件位置

```text
C:\Users\Administrator\.dsh\settings.yaml
```

当前默认 preset 设置：

```yaml
agent-presets:
  default: standard
```

### 3.3 工具定义位置

```text
C:\nvm4w\nodejs\node_modules\@deepseek-ai\dsh\config\agent-presets\
```

### 3.4 Windows 关键行为

standard 预设中：

```yaml
- id: tool-bash
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  disabled: !!js process.platform !== 'win32'
```

因此 Windows 下应使用 pwsh，而不是 bash。

## 4. 修复步骤

1. 查看当前 preset：

```yaml
C:\Users\Administrator\.dsh\settings.yaml
```

2. 如果默认是 minimal，改为 standard：

```yaml
agent-presets:
  default: standard
```

3. 重启 dsh web：

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*dsh*' -and $_.CommandLine -notlike '*bridge-watchdog*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
dsh web
```

4. 新开一个会话，确认工具已恢复。

## 5. 验证

在新会话中执行：

```powershell
Write-Output "shell ok"
```

如果能输出，说明 shell 工具已恢复。
