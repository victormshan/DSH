# -*- coding: utf-8 -*-
"""
股票系统 · V1 源码层迭代：数据获取与基础指标
职责：yfinance 拉取美股/ETF 日线（fallback 模拟序列），计算基础指标 MA/RSI/ATR。
运行：python data_fetcher.py
"""
import sys
import math
import random
from datetime import datetime, timedelta

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


# ---------- 数据获取（yfinance 优先，fallback 模拟） ----------
def fetch_prices(symbol: str, days: int = 250):
    """返回 [(date_str, close), ...]，yfinance 不可用时生成模拟序列"""
    try:
        import yfinance as yf
        df = yf.Ticker(symbol).history(period=f'{days}d')
        if df is not None and len(df) > 50:
            closes = [float(x) for x in df['Close'].tolist()]
            dates = [d.strftime('%Y-%m-%d') for d in df.index]
            return list(zip(dates, closes)), 'yfinance'
    except Exception as e:
        print(f"  [info] yfinance 不可用（{e}），使用模拟数据")
    # fallback：确定性模拟序列（与真实路径同构，便于开发）
    rng = random.Random(hash(symbol) % 1000)
    price = 100.0
    closes = []
    dates = []
    for i in range(days):
        price *= (1 + rng.gauss(0.0003, 0.012))
        closes.append(round(price, 2))
        dates.append((datetime(2025, 1, 1) - timedelta(days=days - i)).strftime('%Y-%m-%d'))
    return list(zip(dates, closes)), 'simulated'


# ---------- 基础指标 ----------
def sma(closes, period):
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    ag = sum(gains) / period
    al = sum(losses) / period
    if al == 0:
        return 100.0
    rs = ag / al
    return 100 - 100 / (1 + rs)


def atr(prices, period=14):
    """简化 ATR：用收盘序列近似（真实应含高/低价，此处用 |Δ| 序列）"""
    if len(prices) < period + 1:
        return None
    trs = [abs(prices[i] - prices[i - 1]) for i in range(-period, 0)]
    return sum(trs) / period


# ---------- 演示 ----------
def demo():
    for symbol in ['AAPL', 'SPY']:
        prices, source = fetch_prices(symbol)
        closes = [p[1] for p in prices]
        ma20 = sma(closes, 20)
        ma50 = sma(closes, 50)
        ma200 = sma(closes, 200)
        rsi14 = rsi(closes, 14)
        atr14 = atr(closes, 14)
        trend = '金叉(MA50>MA200)' if ma50 and ma200 and ma50 > ma200 else '死叉/震荡'
        print(f"[{symbol}] 来源={source} 天数={len(prices)}")
        print(f"  MA20={ma20:.2f} MA50={ma50:.2f} MA200={ma200 if ma200 else 'N/A'} | {trend}")
        print(f"  RSI14={rsi14:.1f} ATR14={atr14:.2f} 最新收盘={closes[-1]:.2f}")
    print("\n[验证] V1 数据获取与基础指标可运行")


if __name__ == '__main__':
    demo()
