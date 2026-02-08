#!/usr/bin/env python3
"""Entry point for the Leveraged ETF Trading Assistant."""

from backend.app import app

if __name__ == "__main__":
    print("Starting Leveraged ETF Trading Assistant on http://localhost:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
