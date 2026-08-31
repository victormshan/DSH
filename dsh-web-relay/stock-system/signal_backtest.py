# -*- coding: utf-8 -*-
"""
股票系统 · V3 源码层迭代：信号生成与组合回测收口
职责：买卖信号量化判定（001 十章条件）+ 真实行情价格路径回测（yfinance 日线对齐 + 绩效指标）。
运行：python signal_backtest.py
"""
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from data_fetcher import fetch_prices, sma, rsi
from scoring import technical_score, composite_score


# ---------- 信号判定（001 十章：买入≥3 项 / 卖出≥2 项） ----------
def buy_signal(composite, closes, rsi14, sentiment):
    hits = 0
    if composite > 75:
        hits += 1
    ma50, ma200 = sma(closes, 50), sma(closes, 200)
    if ma50 and ma200 and ma50 > ma200:
        hits += 1
    if rsi14 is not None and rsi14 > 40:
        hits += 1
    if sentiment > 0.2:
        hits += 1
    return hits >= 3, hits


def sell_signal(composite, closes, rsi14, sentiment):
    hits = 0
    if composite < 40:
        hits += 1
    ma50, ma200 = sma(closes, 50), sma(closes, 200)
    if ma50 and ma200 and ma50 < ma200:
        hits += 1
    if rsi14 is not None and rsi14 > 75:
        hits += 1
    if sentiment < -0.2:
        hits += 1
    return hits >= 2, hits


# ---------- 组合回测（真实行情价格路径，信号驱动持仓） ----------
def backtest(symbols, days=250, macro=0.5):
    """真实收盘价逐日对齐；每标的按当日信号决定持仓（1=持有/0=空仓），等权组合权益曲线。"""
    # 1) 拉真实行情并按日期对齐
    by_date = {}
    sources = {}
    for sym in symbols:
        prices, src = fetch_prices(sym, days)
        sources[sym] = src
        for d, c in prices:
            by_date.setdefault(d, {})[sym] = c
    dates = sorted(by_date.keys())
    if len(dates) < 60:
        return {'annual': 0, 'sharpe': 0, 'drawdown': 0, 'trades': 0, 'source': 'insufficient'}
    # 2) 逐日计算各标的信号，构建组合权益曲线
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    trades = 0
    rets = []
    held = {sym: False for sym in symbols}
    for i in range(1, len(dates)):
        day = dates[i]
        prev = dates[i - 1]
        daily_r = []
        for sym in symbols:
            if sym not in by_date[day] or sym not in by_date[prev]:
                continue  # 停牌日跳过
            r = by_date[day][sym] / by_date[prev][sym] - 1
            # 用截至当日的历史序列判定信号（滚动窗口）
            hist = [by_date[d][sym] for d in dates[:i + 1] if sym in by_date[d]]
            closes = hist[-220:]
            if len(closes) >= 60:
                ts = technical_score(closes, [])
                cs = composite_score(40.0, ts, 60.0, macro)  # 基本面/情绪取中性基准
                b, _ = buy_signal(cs, closes, rsi(closes, 14), 0.3)
                s, _ = sell_signal(cs, closes, rsi(closes, 14), 0.3)
                if b and not held[sym]:
                    held[sym] = True
                    trades += 1
                elif s:
                    held[sym] = False
            daily_r.append(r if held[sym] else 0.0)
        if daily_r:
            rets.append(sum(daily_r) / len(daily_r))
    # 3) 绩效指标
    for r in rets:
        equity *= (1 + r)
        peak = max(peak, equity)
        max_dd = max(max_dd, (peak - equity) / peak)
    n = max(len(rets), 1)
    annual = equity ** (250 / n) - 1 if equity > 0 else -1
    mean = sum(rets) / n
    var = sum((x - mean) ** 2 for x in rets) / n
    vol = var ** 0.5 * (250 ** 0.5)
    sharpe = (annual - 0.02) / vol if vol > 0 else 0
    return {'annual': annual, 'sharpe': sharpe, 'drawdown': max_dd, 'trades': trades,
            'source': 'real' if any(v == 'yfinance' for v in sources.values()) else 'simulated',
            'days': n}


def demo():
    for symbol in ['AAPL', 'SPY', 'QQQ', 'MSFT', 'NVDA']:
        prices, source = fetch_prices(symbol)
        closes = [p[1] for p in prices]
        rsi14 = rsi(closes, 14)
        ts = technical_score(closes, [])
        cs = composite_score(40.0, ts, 60.0, 0.5)
        b, bhits = buy_signal(cs, closes, rsi14, 0.3)
        s, shits = sell_signal(cs, closes, rsi14, 0.3)
        print(f"[{symbol}] 来源={source} 综合分={cs:.0f} 买入信号={'触发' if b else '未触发'}({bhits}/5) 卖出信号={'触发' if s else '未触发'}({shits}/5)")
    print()
    report = backtest(['AAPL', 'SPY', 'QQQ', 'MSFT', 'NVDA'])
    print(f"[组合回测 真实行情] 数据源={report['source']} 天数={report['days']} 年化={report['annual']:.2%} 夏普={report['sharpe']:.2f} "
          f"回撤={report['drawdown']:.2%} 信号次数={report['trades']}")
    passed = report['sharpe'] >= 0.8 and report['drawdown'] <= 0.25
    print(f"[验证] 回测门槛（sharpe≥0.8 且 dd≤25%）: {'✅ 通过' if passed else '❌ 未达'}")
    print("[V3 收口] 真实行情→评分→信号→回测 全链路可运行")


if __name__ == '__main__':
    demo()
