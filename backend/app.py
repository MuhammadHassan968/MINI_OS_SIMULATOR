import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, render_template, jsonify, request
from flask_cors import CORS

from scheduler import (FCFSScheduler, RoundRobinScheduler,
                       PriorityScheduler, SJFScheduler, SRTFScheduler)
from memory import MemoryManager
from sync   import SyncManager
from kernel import KernelSimulator

# ── app setup ─────────────────────────────────────────────────────────────────
app = Flask(
    __name__,
    template_folder=os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend')),
    static_folder=os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend')),
    static_url_path='/static'   # 👈 IMPORTANT
)
CORS(app)

# ── built-in workloads ────────────────────────────────────────────────────────
WORKLOADS = {
    "cpu_bound": [
        {"name": "P1", "burst": 10, "priority": 2, "arrival": 0},
        {"name": "P2", "burst":  8, "priority": 1, "arrival": 1},
        {"name": "P3", "burst":  6, "priority": 3, "arrival": 2},
        {"name": "P4", "burst":  4, "priority": 1, "arrival": 3},
        {"name": "P5", "burst":  7, "priority": 2, "arrival": 4},
    ],
    "io_bound": [
        {"name": "P1", "burst": 6,  "priority": 1, "arrival": 0,
         "io_bursts": [[2, 3]]},
        {"name": "P2", "burst": 5,  "priority": 2, "arrival": 1,
         "io_bursts": [[1, 4]]},
        {"name": "P3", "burst": 7,  "priority": 1, "arrival": 2,
         "io_bursts": [[3, 2]]},
        {"name": "P4", "burst": 4,  "priority": 3, "arrival": 3,
         "io_bursts": [[2, 2]]},
    ],
    "mixed": [
        {"name": "CPU1", "burst": 12, "priority": 1, "arrival": 0},
        {"name": "IO1",  "burst":  4, "priority": 2, "arrival": 0,
         "io_bursts": [[2, 3]]},
        {"name": "CPU2", "burst":  7, "priority": 2, "arrival": 3},
        {"name": "IO2",  "burst":  5, "priority": 1, "arrival": 4,
         "io_bursts": [[1, 4]]},
        {"name": "CPU3", "burst":  9, "priority": 3, "arrival": 5},
        {"name": "IO3",  "burst":  6, "priority": 2, "arrival": 6,
         "io_bursts": [[2, 2]]},
    ],
    "starvation": [
        {"name": "High1", "burst": 2,  "priority": 1, "arrival": 0},
        {"name": "High2", "burst": 2,  "priority": 1, "arrival": 1},
        {"name": "High3", "burst": 2,  "priority": 1, "arrival": 2},
        {"name": "Low",   "burst": 10, "priority": 5, "arrival": 0},
        {"name": "High4", "burst": 2,  "priority": 1, "arrival": 3},
    ],
}


def _build_scheduler(key, quantum):
    return {
        "fcfs":     FCFSScheduler,
        "rr":       lambda: RoundRobinScheduler(quantum=int(quantum)),
        "priority": PriorityScheduler,
        "sjf":      SJFScheduler,
        "srtf":     SRTFScheduler,
    }.get(key, FCFSScheduler)()


def _run_kernel(scheduler_key, workload_key, page_policy, quantum,
                frames, custom_workload=None):
    sched  = _build_scheduler(scheduler_key, quantum)
    mm     = MemoryManager(total_frames=int(frames))
    sync   = SyncManager()
    kernel = KernelSimulator(sched, mm, sync)
    kernel._page_policy = page_policy

    wl = custom_workload if custom_workload else \
         [dict(w) for w in WORKLOADS.get(workload_key, WORKLOADS["cpu_bound"])]
    # convert io_bursts lists to tuples
    for w in wl:
        w["io_bursts"] = [tuple(x) for x in w.get("io_bursts", [])]

    kernel.load_workload(wl)
    kernel.run()
    return kernel.results()


# ── routes ────────────────────────────────────────────────────────────────────
from flask import send_from_directory

@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


@app.route("/api/workloads")
def get_workloads():
    out = {}
    for key, wl in WORKLOADS.items():
        out[key] = [{"name": w["name"], "burst": w["burst"],
                     "priority": w.get("priority", 0),
                     "arrival":  w.get("arrival",  0)} for w in wl]
    return jsonify(out)


@app.route("/api/run", methods=["POST"])
def run_simulation():
    d              = request.json or {}
    scheduler_key  = d.get("scheduler",   "rr")
    workload_key   = d.get("workload",    "cpu_bound")
    page_policy    = d.get("page_policy", "lru")
    quantum        = d.get("quantum",     2)
    frames         = d.get("frames",      16)
    custom         = d.get("custom_workload", None)

    try:
        result = _run_kernel(scheduler_key, workload_key,
                             page_policy, quantum, frames, custom)
        return jsonify({"ok": True, **result})
    except Exception as e:
        import traceback
        return jsonify({"ok": False, "error": str(e),
                        "trace": traceback.format_exc()}), 500


@app.route("/api/compare", methods=["POST"])
def compare_schedulers():
    d            = request.json or {}
    workload_key = d.get("workload",    "cpu_bound")
    page_policy  = d.get("page_policy", "lru")
    quantum      = d.get("quantum",     2)
    frames       = d.get("frames",      16)

    schedulers = [
        ("fcfs",     "FCFS"),
        ("rr",       f"Round Robin (Q={quantum})"),
        ("priority", "Priority"),
        ("sjf",      "SJF"),
    ]
    results = []
    for key, label in schedulers:
        r = _run_kernel(key, workload_key, page_policy, quantum, frames)
        results.append({"scheduler": label, "metrics": r["metrics"]})
    return jsonify({"ok": True, "results": results})


@app.route("/api/sync/mutex_demo", methods=["POST"])
def mutex_demo():
    sync = SyncManager()
    data = sync.run_mutex_demo()
    return jsonify({"ok": True, **data})


@app.route("/api/sync/producer_consumer", methods=["POST"])
def producer_consumer():
    d    = request.json or {}
    sync = SyncManager()
    data = sync.run_producer_consumer_demo(
        buffer_size = d.get("buffer_size", 3),
        producers   = d.get("producers",   2),
        consumers   = d.get("consumers",   2),
    )
    return jsonify({"ok": True, **data})


@app.route("/api/memory/demo", methods=["POST"])
def memory_demo():
    d          = request.json or {}
    policy     = d.get("policy", "lru")
    frames     = d.get("frames", 4)
    page_refs  = d.get("page_refs",
                       [0, 1, 2, 3, 0, 1, 4, 0, 1, 2, 3, 4])

    mm = MemoryManager(total_frames=int(frames))
    mm.allocate(1, 8)
    trace = []
    for page in page_refs:
        before_faults = mm.page_faults
        mm.access(1, page, policy=policy)
        fault = mm.page_faults > before_faults
        trace.append({
            "page":   page,
            "fault":  fault,
            "frames": [f[1] if f else None for f in mm.frames[:int(frames)]],
        })
    return jsonify({"ok": True, "trace": trace, **mm.stats()})


if __name__ == "__main__":
    app.run(debug=True, port=5000)