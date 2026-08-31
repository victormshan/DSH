# -*- coding: utf-8 -*-
"""
股票系统 · V2 源码层迭代：三引擎评分
职责：基本面/技术面/情绪评分（接入 001 九章权重 0.4/0.3/0.2 + 宏观 0.1），
     min-max 归一化 0-100，输出综合分。
运行：python scoring.py
"""
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from data_fetcher import fetch_prices, sma, rsi


# ---------- 归一化辅助 ----------
def clip01(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


# ---------- 基本面评分（权重 40%） ----------
def fundamental_score(f: dict) -> float:
    """f: {roe, gross_margin, rev_yoy, eps_yoy, peg, debt_ratio, fcf_positive}"""
    s = 0.0
    s += 100 * clip01((f.get('roe', 0) - 10) / 15)                 # ROE>25% 满分
    s += 100 * clip01((f.get('gross_margin', 0) - 20) / 10)        # 毛利率
    s += 100 * clip01((f.get('rev_yoy', 0)) / 15)                  # 营收 YoY
    s += 100 * clip01((f.get('eps_yoy', 0)) / 15)                  # EPS YoY
    peg = f.get('peg', 99)
    s += 100 if peg <= 1.5 else (50 if peg <= 2 else 0)            # PEG
    debt = f.get('debt_ratio', 100)
    s += 100 if debt < 60 else (0 if debt > 70 else 50)            # 负债率
    s += 100 if f.get('fcf_positive', False) else 0                # 自由现金流
    return s / 7  # 7 项均值


# ---------- 技术面评分（权重 30%） ----------
def technical_score(closes, prices) -> float:
    s = 0.0
    ma50 = sma(closes, 50)
    ma200 = sma(closes, 200)
    rsi14 = rsi(closes, 14)
    if ma50 and ma200:
        s += 40 + (10 if ma50 > ma200 else 0)                      # 趋势（金叉 +10）
    if rsi14 is not None:
        if 45 <= rsi14 <= 65:
            s += 40
        elif 35 <= rsi14 <= 75:
            s += 20
        else:
            s += 0
    return s  # 0-90（波动率/量价简化为默认 10 分 → 总分 100）


# ---------- 情绪评分（权重 20%，简化） ----------
def sentiment_score(news_sentiment: float) -> float:
    """news_sentiment -1..+1（FinBERT 得分）"""
    return 100 * clip01((news_sentiment + 1) / 2)


# ---------- 综合分 ----------
def composite_score(fundamental, technical, sentiment, macro=0.5):
    score = 0.4 * fundamental + 0.3 * technical + 0.2 * sentiment + 0.1 * (100 * macro)
    return round(score, 1)


# ---------- 演示 ----------
def demo():
    for symbol in ['AAPL', 'SPY']:
        prices, source = fetch_prices(symbol)
        closes = [p[1] for p in prices]
        f = {'roe': 28, 'gross_margin': 45, 'rev_yoy': 12, 'eps_yoy': 15,
             'peg': 1.2, 'debt_ratio': 45, 'fcf_positive': True}
        fs = fundamental_score(f)
        ts = technical_score(closes, prices)
        se = sentiment_score(0.3)
        cs = composite_score(fs, ts, se)
        verdict = '推荐（>75）' if cs > 75 else ('观察（40-75）' if cs >= 40 else '回避（<40）')
        print(f"[{symbol}] 基本面={fs:.0f} 技术面={ts:.0f} 情绪={se:.0f} → 综合分={cs} {verdict}")
    print("\n[验证] V2 三引擎评分可运行（接入 001 九章权重）")


if __name__ == '__main__':
    demo()
