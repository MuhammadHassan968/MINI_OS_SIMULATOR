"""
Entry point for Mini OS Kernel Simulator.
Run:  python run.py
Then open:  http://localhost:5000
"""
import sys, os

# make backend importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from backend.app import app

if __name__ == "__main__":
    print()
    print("  ╔══════════════════════════════════════╗")
    print("  ║   Mini OS Kernel Simulator  v1.0     ║")
    print("  ║   Open → http://localhost:5000        ║")
    print("  ╚══════════════════════════════════════╝")
    print()
    app.run(debug=True, port=5000, use_reloader=True)