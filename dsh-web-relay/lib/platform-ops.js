/**
 * @fileoverview watchdog 跨平台操作抽象层。
 * 将 bin/watchdog.mjs 中原本仅面向 Windows 的操作
 * （查端口占用、杀进程树、读密钥、查计划任务状态）
 * 抽象为 win32 / linux(+darwin) 双实现，按 process.platform 自动选用。
 *
 * 仅依赖 Node 内置模块（node:child_process / node:fs / node:os），零第三方依赖。
 * exec 与 platform 均可注入，便于单元测试在不触碰真实进程/磁盘的情况下验证命令构造与解析逻辑。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

/**
 * 默认的命令执行实现，封装 node:child_process 的 spawnSync。
 * 统一返回 {status, stdout, stderr} 结构；执行过程中若抛出异常或
 * spawnSync 返回 error（如命令不存在），则归一化为 {status:-1, stdout:'', stderr}。
 *
 * @param {string} cmd 可执行文件名
 * @param {string[]} args 参数列表
 * @param {{timeout?: number}} [opts] 附加选项，timeout 默认 8000ms
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
export function spawnSyncImpl(cmd, args, opts = {}) {
  try {
    const { timeout = 8000, ...rest } = opts || {};
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout,
      stdio: 'pipe',
      ...rest,
    });
    if (result.error) {
      return { status: -1, stdout: '', stderr: String(result.error) };
    }
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } catch (err) {
    return { status: -1, stdout: '', stderr: String(err) };
  }
}

/**
 * 解析 Windows `netstat -ano` 输出，找到指定端口处于 LISTENING 状态的 PID。
 * 只认可本地地址为 127.0.0.1 / 0.0.0.0 / [::] / :: 的监听行。
 *
 * @param {string} stdout netstat -ano 的标准输出
 * @param {number} port 目标端口
 * @returns {number|null}
 */
function parseWinNetstat(stdout, port) {
  const lines = String(stdout).split(/\r?\n/);
  for (const line of lines) {
    if (!/LISTENING/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const localAddr = parts[1];
    const pidToken = parts[parts.length - 1];
    const idx = localAddr.lastIndexOf(':');
    if (idx === -1) continue;
    const addr = localAddr.slice(0, idx);
    const portStr = localAddr.slice(idx + 1);
    if (Number(portStr) !== port) continue;
    if (addr === '127.0.0.1' || addr === '0.0.0.0' || addr === '[::]' || addr === '::') {
      const pid = Number(pidToken);
      if (Number.isFinite(pid)) return pid;
    }
  }
  return null;
}

/**
 * 解析 Linux/darwin `ss -ltnp` 输出，找到指定端口对应的 PID。
 * ss 的本地地址列格式为 `<addr>:<port>`，进程信息列包含 `pid=<n>`。
 *
 * @param {string} stdout ss -ltnp 的标准输出
 * @param {number} port 目标端口
 * @returns {number|null}
 */
function parseSsOutput(stdout, port) {
  const suffix = `:${port}`;
  const lines = String(stdout).split(/\r?\n/);
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const localAddr = cols[3];
    if (!localAddr || !localAddr.endsWith(suffix)) continue;
    const m = line.match(/pid=(\d+)/);
    if (m) {
      const pid = Number(m[1]);
      if (Number.isFinite(pid)) return pid;
    }
  }
  return null;
}

/**
 * 解析 `lsof -iTCP:<port> -sTCP:LISTEN -t` 输出（每行一个 PID）。
 *
 * @param {string} stdout lsof 的标准输出
 * @returns {number|null}
 */
function parseLsofOutput(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(pid)) return pid;
  }
  return null;
}

/**
 * 从 `reg query` 输出中提取指定变量名对应的值。
 * reg query 单条结果行格式为：`    <Name>    <Type>    <Value>`（列之间以多个空格分隔）。
 * 解析策略：按空白切分后，第一个 token 即变量名，第二个 token 是类型（REG_SZ 等），
 * 其余 token（即变量名与类型之后的部分）拼接还原为实际值。
 *
 * @param {string} stdout reg query 的标准输出
 * @param {string} name 变量名
 * @returns {string|null}
 */
function parseRegQueryValue(stdout, name) {
  const lines = String(stdout).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts[0] === name && parts.length >= 3) {
      return parts.slice(2).join(' ');
    }
  }
  return null;
}

/**
 * 展开字符串中的 %VAR% 形式的 Windows 环境变量引用。
 * 未在 env 中找到对应变量时，保留原始 %VAR% 不做替换。
 *
 * @param {string} value 原始字符串
 * @param {Record<string, string|undefined>} env 环境变量表
 * @returns {string}
 */
function expandWinVars(value, env) {
  return String(value).replace(/%([^%]+)%/g, (match, varName) => {
    const replacement = env[varName];
    return replacement !== undefined ? replacement : match;
  });
}

/**
 * 解析 `~/.dsh/env` 风格的文件，提取指定 KEY 对应的值。
 * 支持 `#` 开头的整行注释、`export ` 前缀、以及首尾成对的单/双引号包裹。
 *
 * @param {string} content 文件内容
 * @param {string} name 变量名
 * @returns {string|null}
 */
function parseEnvFile(content, name) {
  const lines = String(content).split(/\r?\n/);
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('export ')) {
      trimmed = trimmed.slice('export '.length).trim();
    }
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    if (key !== name) continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/**
 * 创建一个跨平台操作对象，供 watchdog 按 process.platform 选用对应实现。
 *
 * @param {object} [options]
 * @param {NodeJS.Platform} [options.platform=process.platform] 目标平台，可注入 'win32'/'linux'/'darwin' 便于测试
 * @param {(cmd: string, args: string[], opts?: object) => {status: number|null, stdout: string, stderr: string}} [options.exec=spawnSyncImpl] 命令执行函数，可注入 fake 实现
 * @param {Record<string, string|undefined>} [options.env=process.env] 环境变量表
 * @param {string} [options.home=os.homedir()] 用户主目录，用于定位 ~/.dsh/env
 * @param {(...args: any[]) => void} [options.log=console.log] 日志函数
 * @returns {{
 *   findPortPid: (port: number) => number|null,
 *   killPidTree: (pid: number) => {ok: boolean, error?: string},
 *   readSecret: (name: string) => string|null,
 *   scheduledTaskStatus: (name: string) => {exists: boolean, via?: string},
 *   isWindows: boolean,
 *   isLinux: boolean,
 * }}
 */
export function createPlatformOps({
  platform = process.platform,
  exec = spawnSyncImpl,
  env = process.env,
  home = os.homedir(),
  log = console.log,
} = {}) {
  const isWindows = platform === 'win32';
  // isLinux 表示“非 Windows”分支（linux 与 darwin 共用同一套实现）
  const isLinux = !isWindows;

  /**
   * 返回监听该端口的进程 PID，找不到时返回 null。
   * @param {number} port
   * @returns {number|null}
   */
  function findPortPid(port) {
    try {
      if (isWindows) {
        const r = exec('netstat', ['-ano'], {});
        if (!r || !r.stdout) return null;
        return parseWinNetstat(r.stdout, port);
      }
      const ssResult = exec('ss', ['-ltnp'], {});
      if (ssResult && ssResult.stdout) {
        const pid = parseSsOutput(ssResult.stdout, port);
        if (pid !== null) return pid;
      }
      const lsofResult = exec('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-t'], {});
      if (lsofResult && lsofResult.stdout) {
        return parseLsofOutput(lsofResult.stdout);
      }
      return null;
    } catch (err) {
      log('[platform-ops] findPortPid 失败:', err);
      return null;
    }
  }

  /**
   * 结束指定 PID 及其子进程树。
   * @param {number} pid
   * @returns {{ok: boolean, error?: string}}
   */
  function killPidTree(pid) {
    try {
      if (isWindows) {
        const r = exec('taskkill', ['/PID', String(pid), '/T', '/F'], {});
        if (r && r.status === 0) return { ok: true };
        return { ok: false, error: (r && r.stderr) || `taskkill exited with ${r && r.status}` };
      }
      exec('pkill', ['-TERM', '-P', String(pid)], {});
      const r = exec('kill', ['-TERM', String(pid)], {});
      if (r && r.status === 0) return { ok: true };
      return { ok: false, error: (r && r.stderr) || `kill exited with ${r && r.status}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * 读取密钥：Windows 从注册表（HKCU 优先，HKLM 兜底）回读；
   * Linux/darwin 优先读 process.env，兜底解析 ~/.dsh/env 文件。
   * @param {string} name
   * @returns {string|null}
   */
  function readSecret(name) {
    try {
      if (isWindows) {
        const regPaths = [
          'HKCU\\Environment',
          'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
        ];
        for (const regPath of regPaths) {
          const r = exec('reg', ['query', regPath, '/v', name], {});
          if (!r || r.status !== 0 || !r.stdout) continue;
          const value = parseRegQueryValue(r.stdout, name);
          if (value !== null) return expandWinVars(value, env);
        }
        return null;
      }
      if (env && env[name]) return env[name];
      const filePath = `${home}/.dsh/env`;
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
      return parseEnvFile(content, name);
    } catch (err) {
      log('[platform-ops] readSecret 失败:', err);
      return null;
    }
  }

  /**
   * 查询计划任务/定时任务是否存在。
   * Windows 用 schtasks /Query /TN 判断退出码；
   * Linux/darwin 依次查 systemctl --user 与 crontab -l。
   * @param {string} name
   * @returns {{exists: boolean, via?: string}}
   */
  function scheduledTaskStatus(name) {
    try {
      if (isWindows) {
        const r = exec('schtasks', ['/Query', '/TN', name], {});
        return { exists: !!r && r.status === 0 };
      }
      const systemctlResult = exec('systemctl', ['--user', 'list-units', '--all'], {});
      const foundInSystemd = !!(systemctlResult && systemctlResult.stdout && systemctlResult.stdout.includes(name));
      const crontabResult = exec('crontab', ['-l'], {});
      const foundInCron = !!(crontabResult && crontabResult.stdout && crontabResult.stdout.includes(name));
      if (foundInSystemd || foundInCron) return { exists: true };
      return { exists: false, via: 'cron' };
    } catch (err) {
      return { exists: false, via: 'cron' };
    }
  }

  return {
    findPortPid,
    killPidTree,
    readSecret,
    scheduledTaskStatus,
    isWindows,
    isLinux,
  };
}
