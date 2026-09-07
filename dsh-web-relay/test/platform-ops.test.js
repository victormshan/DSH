import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createPlatformOps } from '../lib/platform-ops.js';

/**
 * 构造一个可注入的 fake exec：records 记录每次调用的 {cmd, args}，
 * responder(cmd, args) 返回 {status, stdout, stderr} 或抛出异常。
 */
function makeFakeExec(responder) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return responder(cmd, args, opts);
  };
  fn.calls = calls;
  return fn;
}

test('win: findPortPid 解析 netstat -ano，命中 LISTENING 端口', () => {
  const exec = makeFakeExec((cmd, args) => {
    assert.equal(cmd, 'netstat');
    assert.deepEqual(args, ['-ano']);
    return {
      status: 0,
      stdout:
        '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       800\r\n' +
        '  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       9999\r\n',
      stderr: '',
    };
  });
  const ops = createPlatformOps({ platform: 'win32', exec });
  assert.equal(ops.findPortPid(3080), 9999);
  assert.equal(exec.calls.length, 1);
});

test('win: findPortPid 对紧凑/不同间距的 netstat 行也能解析出 PID（版本容错）', () => {
  const exec = makeFakeExec(() => ({
    status: 0,
    stdout: 'TCP 127.0.0.1:3080 0.0.0.0:0 LISTENING 1234\n',
    stderr: '',
  }));
  const ops = createPlatformOps({ platform: 'win32', exec });
  assert.equal(ops.findPortPid(3080), 1234);
});

test('linux: findPortPid 优先解析 ss -ltnp', () => {
  const exec = makeFakeExec((cmd, args) => {
    if (cmd === 'ss') {
      assert.deepEqual(args, ['-ltnp']);
      return {
        status: 0,
        stdout: 'LISTEN 0 511 0.0.0.0:3080 0.0.0.0:* users:(("node",pid=4321,fd=23))\n',
        stderr: '',
      };
    }
    throw new Error('不应调用 ' + cmd);
  });
  const ops = createPlatformOps({ platform: 'linux', exec });
  assert.equal(ops.findPortPid(3080), 4321);
});

test('linux: findPortPid 在 ss 无结果时回退 lsof', () => {
  const exec = makeFakeExec((cmd, args) => {
    if (cmd === 'ss') return { status: 0, stdout: 'State Recv-Q Send-Q Local Address:Port\n', stderr: '' };
    if (cmd === 'lsof') {
      assert.deepEqual(args, ['-iTCP:3080', '-sTCP:LISTEN', '-t']);
      return { status: 0, stdout: '5555\n', stderr: '' };
    }
    throw new Error('未知命令 ' + cmd);
  });
  const ops = createPlatformOps({ platform: 'linux', exec });
  assert.equal(ops.findPortPid(3080), 5555);
});

test('win: killPidTree 调用 taskkill /PID /T /F', () => {
  const exec = makeFakeExec((cmd, args) => {
    assert.equal(cmd, 'taskkill');
    assert.deepEqual(args, ['/PID', '1234', '/T', '/F']);
    return { status: 0, stdout: '', stderr: '' };
  });
  const ops = createPlatformOps({ platform: 'win32', exec });
  assert.deepEqual(ops.killPidTree(1234), { ok: true });
});

test('linux: killPidTree 先 pkill -TERM -P 再 kill -TERM', () => {
  const exec = makeFakeExec((cmd, args) => {
    return { status: 0, stdout: '', stderr: '' };
  });
  const ops = createPlatformOps({ platform: 'linux', exec });
  const result = ops.killPidTree(1234);
  assert.deepEqual(result, { ok: true });
  assert.equal(exec.calls.length, 2);
  assert.deepEqual(exec.calls[0], { cmd: 'pkill', args: ['-TERM', '-P', '1234'], opts: {} });
  assert.deepEqual(exec.calls[1], { cmd: 'kill', args: ['-TERM', '1234'], opts: {} });
});

test('win: readSecret 从 HKCU 注册表回读并展开 %VAR%', () => {
  const exec = makeFakeExec((cmd, args) => {
    assert.equal(cmd, 'reg');
    assert.deepEqual(args, ['query', 'HKCU\\Environment', '/v', 'MY_SECRET']);
    return {
      status: 0,
      stdout:
        'HKEY_CURRENT_USER\\Environment\r\n' +
        '    MY_SECRET    REG_SZ    %BASE%\\secret.txt\r\n\r\n',
      stderr: '',
    };
  });
  const ops = createPlatformOps({ platform: 'win32', exec, env: { BASE: 'C:\\Config' } });
  assert.equal(ops.readSecret('MY_SECRET'), 'C:\\Config\\secret.txt');
});

test('win: readSecret 在 HKCU 未命中时回退 HKLM', () => {
  const exec = makeFakeExec((cmd, args) => {
    if (args[1] === 'HKCU\\Environment') {
      return { status: 1, stdout: '', stderr: 'ERROR: 找不到指定的注册表项' };
    }
    assert.equal(
      args[1],
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    );
    return { status: 0, stdout: '    MY_SECRET    REG_SZ    plainvalue\r\n', stderr: '' };
  });
  const ops = createPlatformOps({ platform: 'win32', exec, env: {} });
  assert.equal(ops.readSecret('MY_SECRET'), 'plainvalue');
});

test('linux: readSecret 优先取 process.env，不触碰文件系统', () => {
  const exec = makeFakeExec(() => {
    throw new Error('不应调用 exec');
  });
  const readSpy = mock.method(fs, 'readFileSync', () => {
    throw new Error('不应读取磁盘');
  });
  try {
    const ops = createPlatformOps({ platform: 'linux', exec, env: { MY_SECRET: 'from-env' } });
    assert.equal(ops.readSecret('MY_SECRET'), 'from-env');
    assert.equal(readSpy.mock.callCount(), 0);
  } finally {
    readSpy.mock.restore();
  }
});

test('linux: readSecret 在 env 未命中时解析 ~/.dsh/env 文件', () => {
  const readSpy = mock.method(fs, 'readFileSync', (filePath) => {
    assert.equal(filePath, '/fake/home/.dsh/env');
    return '# comment\nexport FOO=bar\nBAZ="qux with space"\n';
  });
  try {
    const exec = makeFakeExec(() => ({ status: 0, stdout: '', stderr: '' }));
    const ops = createPlatformOps({ platform: 'linux', exec, env: {}, home: '/fake/home' });
    assert.equal(ops.readSecret('FOO'), 'bar');
    assert.equal(ops.readSecret('BAZ'), 'qux with space');
  } finally {
    readSpy.mock.restore();
  }
});

test('win: scheduledTaskStatus 依据 schtasks 退出码判断存在性', () => {
  const execOk = makeFakeExec(() => ({ status: 0, stdout: '', stderr: '' }));
  const opsOk = createPlatformOps({ platform: 'win32', exec: execOk });
  assert.deepEqual(opsOk.scheduledTaskStatus('MyTask'), { exists: true });

  const execFail = makeFakeExec(() => ({ status: 1, stdout: '', stderr: 'ERROR' }));
  const opsFail = createPlatformOps({ platform: 'win32', exec: execFail });
  assert.deepEqual(opsFail.scheduledTaskStatus('MyTask'), { exists: false });
});

test('linux: scheduledTaskStatus 依次检查 systemctl 与 crontab', () => {
  const execSystemd = makeFakeExec((cmd) =>
    cmd === 'systemctl'
      ? { status: 0, stdout: 'watchdog.service loaded active running\n', stderr: '' }
      : { status: 0, stdout: '', stderr: '' }
  );
  const opsSystemd = createPlatformOps({ platform: 'linux', exec: execSystemd });
  assert.deepEqual(opsSystemd.scheduledTaskStatus('watchdog'), { exists: true });

  const execCron = makeFakeExec((cmd) =>
    cmd === 'systemctl'
      ? { status: 0, stdout: '', stderr: '' }
      : { status: 0, stdout: '*/5 * * * * /usr/bin/watchdog\n', stderr: '' }
  );
  const opsCron = createPlatformOps({ platform: 'linux', exec: execCron });
  assert.deepEqual(opsCron.scheduledTaskStatus('watchdog'), { exists: true });

  const execNone = makeFakeExec(() => ({ status: 0, stdout: '', stderr: '' }));
  const opsNone = createPlatformOps({ platform: 'linux', exec: execNone });
  assert.deepEqual(opsNone.scheduledTaskStatus('watchdog'), { exists: false, via: 'cron' });
});

test('容错: exec 抛错时 findPortPid 返回 null', () => {
  const exec = makeFakeExec(() => {
    throw new Error('boom');
  });
  const opsWin = createPlatformOps({ platform: 'win32', exec });
  assert.equal(opsWin.findPortPid(3080), null);
  const opsLinux = createPlatformOps({ platform: 'linux', exec });
  assert.equal(opsLinux.findPortPid(3080), null);
});

test('容错: exec 抛错时 killPidTree 返回 {ok:false}', () => {
  const exec = makeFakeExec(() => {
    throw new Error('boom');
  });
  const opsWin = createPlatformOps({ platform: 'win32', exec });
  assert.equal(opsWin.killPidTree(1234).ok, false);
  const opsLinux = createPlatformOps({ platform: 'linux', exec });
  assert.equal(opsLinux.killPidTree(1234).ok, false);
});
