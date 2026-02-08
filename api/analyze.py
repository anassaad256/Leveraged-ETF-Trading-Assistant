"""Vercel serverless function for /api/analyze endpoint."""

import json
import traceback
import datetime
import sys
import os

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
import yfinance as yf
from http.server import BaseHTTPRequestHandler


# ── Known 2x leveraged ETF tickers ──────────────────────────────────────────

KNOWN_2X_ETFS = {
    "SSO", "SDS", "QLD", "QID", "DDM", "DXD", "MVV", "MZZ",
    "SAA", "SDD", "UWM", "TWM", "UYG", "SKF", "ROM", "REW",
    "USD", "SSG", "UGE", "SZK", "UCC", "SCC", "DIG", "DUG",
    "UPW", "SDP", "URE", "SRS", "UXI", "SIJ", "BIB", "BIS",
    "LABU", "LABD", "NUGT", "DUST", "JNUG", "JDST", "GUSH", "DRIP",
    "UCO", "SCO", "AGQ", "ZSL", "UGL", "GLL", "BOIL", "KOLD",
    "TQQQ", "SQQQ", "SPXL", "SPXS", "TECL", "TECS", "FAS", "FAZ",
    "TNA", "TZA", "SOXL", "SOXS", "CURE", "NAIL", "DPST", "RETL",
    "DFEN", "WEBL", "WEBS", "FNGU", "FNGD", "BULZ", "BERZ",
    "UPRO", "SPXU", "UDOW", "SDOW", "UMDD", "SMDD",
}


def is_likely_2x_leveraged(ticker: str) -> bool:
    return ticker.upper() in KNOWN_2X_ETFS


def fetch_price_data(ticker: str, months: int = 14) -> pd.DataFrame:
    end = datetime.date.today()
    start = end - datetime.timedelta(days=months * 30)
    tk = yf.Ticker(ticker)
    df = tk.history(start=str(start), end=str(end), auto_adjust=True)
    if df.empty:
        raise ValueError(f"No price data returned for '{ticker}'.")
    df = df[["Close"]].copy()
    df.columns = ["close"]
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df = df.sort_index()
    return df


def detect_crash(df: pd.DataFrame, decline_threshold: float = 0.17,
                 window_days: int = 30) -> dict:
    closes = df["close"].values
    dates = df.index

    crash_detected = False
    crash_start_idx = None

    for i in range(window_days, len(closes)):
        segment = closes[i - window_days: i + 1]
        peak_idx_local = np.argmax(segment)
        trough_idx_local = peak_idx_local + np.argmin(segment[peak_idx_local:])
        if segment[peak_idx_local] == 0:
            continue
        decline = (segment[peak_idx_local] - segment[trough_idx_local]) / segment[peak_idx_local]
        if decline >= decline_threshold:
            crash_detected = True
            crash_start_idx = i - window_days + peak_idx_local
            break

    if not crash_detected:
        lookback = 40
        if len(closes) >= lookback:
            half = lookback // 2
            recent = closes[-half:]
            earlier = closes[-lookback:-half]
            recent_low = recent.min()
            earlier_low = earlier.min()
            recent_vol = np.std(np.diff(recent) / recent[:-1]) if len(recent) > 1 else 0
            earlier_vol = np.std(np.diff(earlier) / earlier[:-1]) if len(earlier) > 1 else 0
            if recent_low < earlier_low and recent_vol > earlier_vol * 1.4:
                crash_detected = True
                crash_start_idx = len(closes) - lookback

    if not crash_detected:
        if len(closes) >= 10:
            recent_returns = np.diff(closes[-10:]) / closes[-11:-1]
            neg_returns = recent_returns[recent_returns < 0]
            if len(neg_returns) >= 6 and np.mean(neg_returns) < -0.02:
                crash_detected = True
                crash_start_idx = len(closes) - 10

    crash_start_date = None
    if crash_detected and crash_start_idx is not None:
        crash_start_idx = max(0, min(crash_start_idx, len(dates) - 1))
        crash_start_date = dates[crash_start_idx]

    return {"detected": crash_detected, "crash_start_date": crash_start_date}


def build_reference_window(df: pd.DataFrame, crash_info: dict) -> dict:
    if crash_info["detected"] and crash_info["crash_start_date"] is not None:
        crash_date = crash_info["crash_start_date"]
        six_months_before = crash_date - pd.DateOffset(months=6)
        ref_df = df.loc[six_months_before:crash_date - pd.Timedelta(days=1)]
        if len(ref_df) < 20:
            ref_df = df.iloc[:max(1, df.index.get_loc(crash_date))]
        window_type = "Pre-crash 6-month"
    else:
        ref_df = df.iloc[-126:]
        window_type = "Rolling 6-month"
    return {"type": window_type, "start_date": ref_df.index[0],
            "end_date": ref_df.index[-1], "data": ref_df}


def compute_quintiles(ref_window: dict) -> dict:
    closes = ref_window["data"]["close"]
    ref_high = closes.max()
    ref_low = closes.min()
    band = (ref_high - ref_low) / 5.0
    quintiles = {}
    for q in range(1, 6):
        lower = ref_low + (q - 1) * band
        upper = ref_low + q * band
        quintiles[q] = {"lower": round(float(lower), 2), "upper": round(float(upper), 2)}
    return {"ref_high": round(float(ref_high), 2), "ref_low": round(float(ref_low), 2),
            "band_width": round(float(band), 2), "quintiles": quintiles}


def assess_current_price(current_price: float, quintile_data: dict, crash_info: dict) -> dict:
    q = quintile_data["quintiles"]
    position = None
    quintile_num = None

    if current_price < q[1]["lower"]:
        position = "Below 1st Quintile (Dislocation/Overshoot)" if crash_info["detected"] else "Below 1st Quintile"
        quintile_num = 0
    elif current_price > q[5]["upper"]:
        position = "Above 5th Quintile"
        quintile_num = 6
    else:
        for i in range(1, 6):
            if q[i]["lower"] <= current_price <= q[i]["upper"]:
                labels = {1: "1st Quintile (Cheapest)", 2: "2nd Quintile (Below Average)",
                          3: "3rd Quintile (Neutral)", 4: "4th Quintile (Expensive)",
                          5: "5th Quintile (Stretched)"}
                position = labels[i]
                quintile_num = i
                break

    if quintile_num is None:
        quintile_num = 3
        position = "3rd Quintile (Neutral)"

    return {"current_price": round(current_price, 2), "quintile_num": quintile_num,
            "position": position, "ref_high": quintile_data["ref_high"],
            "ref_low": quintile_data["ref_low"]}


def generate_buy_recommendation(price_assessment: dict, quintile_data: dict) -> dict:
    q = quintile_data["quintiles"]
    qn = price_assessment["quintile_num"]
    entry_plan = {"upper_1st": round(q[1]["upper"], 2),
                  "mid_1st": round((q[1]["lower"] + q[1]["upper"]) / 2, 2),
                  "lower_1st": round(q[1]["lower"], 2)}

    if qn == 0:
        recommendation = "BUY"
        status = ("Price is below the 1st quintile — panic overshoot territory. "
                  "Staggered entries recommended with awareness of further downside.")
    elif qn == 1:
        recommendation = "BUY"
        status = ("Price is in the 1st quintile (cheapest zone). "
                  "Mean-reversion setup is active. Use staggered entries.")
    elif qn == 2:
        recommendation = "WAIT"
        status = (f"Price is in the 2nd quintile. Not optimal yet. "
                  f"Best buy occurs if price enters the 1st quintile near ${entry_plan['upper_1st']:.2f}.")
    else:
        recommendation = "WAIT"
        label = {3: "3rd", 4: "4th", 5: "5th", 6: "above 5th"}.get(qn, f"{qn}th")
        status = (f"Price is in the {label} quintile. Do not buy. "
                  f"Best buy occurs if price enters the 1st quintile near ${entry_plan['upper_1st']:.2f}.")

    return {"recommendation": recommendation, "status": status,
            "entry_plan": entry_plan if qn <= 1 else None, "target_entry": entry_plan}


def generate_exit_recommendation(price_assessment: dict, quintile_data: dict) -> dict:
    q = quintile_data["quintiles"]
    qn = price_assessment["quintile_num"]
    exit_zones = {"partial_exit": round(q[3]["lower"], 2),
                  "full_exit": round(q[4]["lower"], 2),
                  "strong_exit": round(q[5]["lower"], 2)}

    exit_note = None
    exit_recommendation = None

    if qn >= 5 or qn == 6:
        exit_recommendation = "SELL"
        exit_note = ("Strongly discourage holding — volatility decay risk is elevated. "
                     "Full exit recommended immediately.")
    elif qn == 4:
        exit_recommendation = "SELL"
        exit_note = "Full or near-full exit recommended. Asymmetry is no longer favorable."
    elif qn == 3:
        exit_recommendation = "PARTIAL SELL"
        exit_note = "Consider partial profit-taking. Asymmetry is diminishing in mid-to-late 3rd quintile."
    else:
        exit_note = "No exit signal. Hold or build position per entry plan."

    return {"exit_zones": exit_zones, "exit_note": exit_note,
            "exit_recommendation": exit_recommendation}


def assess_risk(price_assessment: dict, crash_info: dict, quintile_data: dict) -> str:
    qn = price_assessment["quintile_num"]
    if qn >= 4:
        return ("Volatility decay: Holding a 2x leveraged ETF in the upper quintiles "
                "exposes you to accelerating decay if the underlying moves sideways or reverses. "
                "Path dependency makes prolonged holds dangerous.")
    if qn == 0 and crash_info["detected"]:
        return ("Regime break risk: Price has broken below the pre-crash reference range. "
                "Extended time below the 1st quintile could indicate a structural shift "
                "rather than a temporary overshoot. Position sizing must be conservative.")
    if qn <= 1 and crash_info["detected"]:
        return ("Drawdown risk: In a crash regime, prices can continue falling further "
                "than historical norms suggest. Use staggered entries and keep reserves. "
                "2x leverage amplifies both recovery gains and further losses.")
    if qn <= 1:
        return ("Drawdown risk: While in the cheapest quintile, further decline is possible. "
                "2x leveraged ETFs have path-dependent returns — a prolonged drawdown can "
                "erode capital even if the underlying eventually recovers.")
    return ("Path dependency: 2x leveraged instruments are designed for daily rebalancing. "
            "Extended holding periods in volatile markets can produce returns that diverge "
            "significantly from 2x the underlying's cumulative return.")


def generate_summary(buy_rec: dict, exit_rec: dict, price_assessment: dict, crash_info: dict) -> dict:
    if exit_rec["exit_recommendation"] in ("SELL", "PARTIAL SELL"):
        final = exit_rec["exit_recommendation"]
    else:
        final = buy_rec["recommendation"]

    price = price_assessment["current_price"]
    crash = crash_info["detected"]

    if final == "SELL":
        text = (f"At ${price:.2f}, the ETF is in an expensive zone. "
                "Exit positions to avoid volatility decay and unfavorable asymmetry.")
    elif final == "PARTIAL SELL":
        text = (f"At ${price:.2f}, the ETF is in neutral territory. "
                "Consider booking partial profits while maintaining a reduced position.")
    elif final == "BUY":
        crash_note = " Crash regime is active — size positions conservatively." if crash else ""
        text = (f"At ${price:.2f}, the ETF is in the cheapest zone offering "
                f"favorable mean-reversion asymmetry. Use staggered entries.{crash_note}")
    else:
        text = (f"At ${price:.2f}, the ETF is not yet in the optimal buy zone. "
                "Monitor for a move into the 1st quintile before deploying capital.")

    return {"text": text, "final_recommendation": final}


def analyze_ticker(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    is_2x = is_likely_2x_leveraged(ticker)
    df = fetch_price_data(ticker)

    if len(df) < 30:
        raise ValueError(f"Insufficient historical data for '{ticker}' ({len(df)} days). "
                         "Need at least 30 trading days.")

    crash_info = detect_crash(df)
    ref_window = build_reference_window(df, crash_info)
    quintile_data = compute_quintiles(ref_window)
    current_price = float(df["close"].iloc[-1])
    price_assessment = assess_current_price(current_price, quintile_data, crash_info)
    buy_rec = generate_buy_recommendation(price_assessment, quintile_data)
    exit_rec = generate_exit_recommendation(price_assessment, quintile_data)
    risk = assess_risk(price_assessment, crash_info, quintile_data)
    summary = generate_summary(buy_rec, exit_rec, price_assessment, crash_info)

    crash_start_str = None
    if crash_info["crash_start_date"] is not None:
        crash_start_str = crash_info["crash_start_date"].strftime("%Y-%m-%d")

    return {
        "ticker": ticker,
        "is_2x_leveraged": is_2x,
        "reference_window": {
            "type": ref_window["type"],
            "start_date": ref_window["start_date"].strftime("%Y-%m-%d"),
            "end_date": ref_window["end_date"].strftime("%Y-%m-%d"),
            "crash_detected": crash_info["detected"],
            "crash_start_date": crash_start_str,
        },
        "quintiles": quintile_data,
        "current_status": price_assessment,
        "buy_assessment": buy_rec,
        "exit_assessment": exit_rec,
        "primary_risk": risk,
        "summary": summary,
    }


# ── Vercel handler ───────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                data = {}

            ticker = (data.get("ticker") or "").strip().upper()

            if not ticker:
                self._respond(400, {"error": "Ticker symbol is required."})
                return

            if len(ticker) > 10 or not ticker.isalpha():
                self._respond(400, {"error": f"Invalid ticker symbol: '{ticker}'."})
                return

            warning = None
            if not is_likely_2x_leveraged(ticker):
                warning = (f"'{ticker}' is not recognized as a 2x leveraged ETF. "
                           "Results are shown for informational purposes. "
                           "This framework is designed for daily 2x leveraged instruments.")

            try:
                result = analyze_ticker(ticker)
                result["warning"] = warning
                self._respond(200, result)
            except ValueError as exc:
                self._respond(400, {"error": str(exc)})
            except Exception:
                traceback.print_exc()
                self._respond(500, {"error": "Failed to fetch or analyze data. Please check the ticker and try again."})
        except Exception as exc:
            traceback.print_exc()
            self._respond(500, {"error": f"Internal server error: {str(exc)}"})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _respond(self, status_code: int, data: dict):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
