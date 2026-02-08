"""Flask application serving the Leveraged ETF Trading Assistant."""

import os
import traceback

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from backend.analyzer import analyze_ticker, is_likely_2x_leveraged

app = Flask(
    __name__,
    static_folder=os.path.join(os.path.dirname(__file__), "..", "frontend"),
)
CORS(app)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json(force=True, silent=True) or {}
    ticker = (data.get("ticker") or "").strip().upper()

    if not ticker:
        return jsonify({"error": "Ticker symbol is required."}), 400

    if len(ticker) > 10 or not ticker.isalpha():
        return jsonify({"error": f"Invalid ticker symbol: '{ticker}'."}), 400

    warning = None
    if not is_likely_2x_leveraged(ticker):
        warning = (
            f"'{ticker}' is not recognized as a 2x leveraged ETF. "
            "Results are shown for informational purposes. "
            "This framework is designed for daily 2x leveraged instruments."
        )

    try:
        result = analyze_ticker(ticker)
        result["warning"] = warning
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        traceback.print_exc()
        return jsonify({
            "error": "Failed to fetch or analyze data. Please check the ticker and try again."
        }), 500


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
