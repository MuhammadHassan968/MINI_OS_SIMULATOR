# MINI OS Simulator

## Overview

MINI OS SIMULATOR is an educational operating system simulator written in Python with a small single-page frontend. It is designed for students and hobbyists who want to learn and experiment with fundamental OS concepts such as CPU scheduling algorithms, memory paging and page-replacement policies, process lifecycle management, and basic synchronization primitives (mutexes and semaphores). The simulator produces per-tick traces, a Gantt chart of CPU usage, and memory/frame snapshots so you can visualize how algorithms behave over time.

Key learning goals:
- Understand and compare CPU scheduling policies: FCFS, Round-Robin, Priority, SJF, and SRTF.
- Observe process life-cycle transitions (NEW → READY → RUNNING → WAITING → TERMINATED).
- Explore paging, page faults, FIFO and LRU replacement, and frame allocation.
- See how simple synchronization primitives (mutex, counting semaphore) behave with blocking and wakeup.

This repository contains a Flask backend that performs the simulation and a small frontend (static files) that visualizes results. The backend is intentionally small and self-contained to make it easy to read and extend.

Table of contents
- Features
- Quick start
- Architecture & important modules
- API reference and examples
- Extending the simulator
- Development notes
- Testing & CI suggestions
- Troubleshooting
- License


## Features

- Multiple built-in workloads (CPU-bound, I/O-bound, mixed, starvation scenarios).
- Scheduling algorithms: FCFS, Round-Robin (time quantum), Priority (non-preemptive), SJF (non-preemptive), SRTF (preemptive SJF).
- Simple memory manager with per-process page tables, frame allocation, FIFO and LRU replacement policies, and access tracing.
- Process and thread control blocks (PCB/TCB) with per-process bookkeeping (waiting time, turnaround time, cpu used).
- Simple synchronization primitives with event logs: simulated Mutex and Counting Semaphore.
- REST API endpoints to run simulations and return JSON results consumable by the frontend.


## Quick start

Requirements
- Python 3.8+ is recommended.
- Git (to clone the repo).

1) Clone the repo

```bash
git clone https://github.com/MuhammadHassan968/MINI_OS_SIMULATOR.git
cd MINI_OS_SIMULATOR
```

2) Create a virtual environment and install dependencies

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows (PowerShell)
.venv\Scripts\Activate.ps1

pip install -r requirement.txt
```

Note: The repository currently includes a minimal requirement.txt. Consider renaming to `requirements.txt` and pinning dependency versions to improve reproducibility (e.g. `Flask==2.x`, `flask-cors==3.x`).

3) Run the backend server

```bash
python backend/app.py
# or, depending on your preference, run the top-level runner
python run.py
```

4) Open the frontend

Open http://localhost:5000/ in your browser. The server serves the frontend static files and the API on port 5000 by default.


## Architecture & important modules

Top-level layout (relevant files)

```
backend/
  app.py              # Flask app, endpoints, wiring: builds scheduler, MemoryManager, SyncManager and KernelSimulator
  kernel.py           # KernelSimulator: main simulation loop, tick/gantt, I/O handling, memory accesses
  scheduler.py        # Scheduling strategies: FCFS, RoundRobin, Priority, SJF, SRTF
  memory.py           # MemoryManager: page tables, frame allocation, FIFO/LRU eviction, stats
  process_manager.py  # ProcessManager: create/terminate/snapshot processes and threads
  pcb.py              # PCB (Process Control Block) and ProcessState enum
  tcb.py              # TCB (Thread Control Block) and ThreadState enum
  sync.py             # SimMutex, SimSemaphore, SyncManager with demo flows
frontend/             # Static frontend (HTML/CSS/JS) - served by Flask app
run.py                # Optional top-level runner script
requirement.txt       # Dependencies list (minimal)
```

How it fits together
- app.py is the entrypoint for running simulations. It prepares a scheduler, MemoryManager, and SyncManager, constructs a KernelSimulator and then runs the simulation for a chosen workload.
- KernelSimulator coordinates arrival/dispatch of processes, handles time ticks, invokes memory accesses, handles I/O bursts, records tick-level snapshots and compiles final metrics.
- MemoryManager tracks per-process page tables and physical frames, implements FIFO and LRU page replacement, and exposes statistics and access traces for visualization.
- Scheduler implementations encapsulate ready-queue behavior and selection strategy; the kernel calls `scheduler.next_process()` to choose the next process and uses `requeue()` for preemption.


## API reference

Base URL: http://localhost:5000

1) GET /api/workloads
- Returns preset workloads (CPU-bound, I/O-bound, mixed, starvation) in a compact form.

Example response (abridged):
```json
{
  "cpu_bound": [{"name":"P1","burst":10, ...}, ...],
  "io_bound": [...]
}
```

2) POST /api/run
- Run a simulation and return the simulation results (process list, Gantt, tick_log, metrics, memory stats).

Request JSON fields
- scheduler: "rr" | "fcfs" | "priority" | "sjf" | "srtf"
- workload: "cpu_bound" | "io_bound" | "mixed" | "starvation" (or provide custom_workload)
- page_policy: "lru" | "fifo"
- quantum: integer (only used for Round-Robin; default 2)
- frames: integer number of physical frames (default 16)
- custom_workload: optional array of processes: {"name", "burst", "priority", "arrival", "io_bursts"}

Example curl

```bash
curl -s -X POST http://localhost:5000/api/run \
  -H "Content-Type: application/json" \
  -d '{"scheduler":"rr","workload":"mixed","page_policy":"lru","quantum":2,"frames":8}'
```

Example of a minimal custom workload

```json
[
  {"name":"A","burst":5,"priority":1,"arrival":0},
  {"name":"B","burst":7,"priority":2,"arrival":1}
]
```

Response structure (abridged)
- ok: true/false
- processes: list of process snapshots (pid, name, state, waiting/turnaround, cpu_used, ...)
- gantt: list of segments {pid, name, start, end}
- tick_log: per-tick snapshots used by the frontend for visualization
- metrics: {avg_waiting, avg_turnaround, cpu_utilization, throughput, page_faults, page_hits, ...}

3) POST /api/compare
- Runs several schedulers on the same workload and returns metrics for each for side-by-side comparison.

4) POST /api/memory/demo
- Simulate a page reference trace; useful for debugging page replacement policies. Accepts fields `policy`, `frames`, `page_refs` and returns a trace and memory stats.

5) /api/sync/mutex_demo and /api/sync/producer_consumer
- Demonstration endpoints for the synchronization primitives; useful to inspect event logs for mutex/semaphore behavior.


## Extending the simulator

Add a new scheduler
1. Edit `backend/scheduler.py` and add a new class that extends `BaseScheduler`.
2. Implement `add_process()`, `next_process()` and (optionally) `requeue()` if it supports preemption.
3. Add an entry in `backend/app.py` `_build_scheduler` mapping (key -> constructor) so the API can create instances by name.

Add a new page replacement policy
1. Edit `backend/memory.py` and modify `_evict(self, policy)` to add a new policy branch (for example, "second-chance" or "clock").
2. Maintain necessary metadata in PageTableEntry (e.g., a reference bit) and update `_load_page()` and `access()` behaviors accordingly.

Add new visualization in the frontend
- The backend returns `tick_log`, `gantt`, and `frame_snapshot()` which can be used to render time-series views, a Gantt chart, and frame contents over time. Add a UI in `frontend/` that consumes these fields.


## Development notes

- The simulation runs a discrete-time main loop inside `KernelSimulator.run()`. Each loop iteration is a single CPU tick. The kernel performs arrivals, I/O completions, scheduling/dispatch, one tick of CPU execution (memory access + possible I/O), and then logs the tick snapshot.
- Memory accesses are simulated on every CPU tick by computing a page index based on `cpu_used % num_pages` for the running process. This keeps the memory behavior deterministic for a given workload.
- Processes are provisioned with `num_pages = max(2, burst_time // 2)` pages when created. You can change this allocation policy in `kernel.load_workload()` if you want different behavior.
- Round-Robin: the kernel tracks `quantum_remaining` and uses `scheduler.requeue()` on expiry. SRTF relies on the scheduler being polled each tick; `KernelSimulator` will preempt when RR quantum expires or when scheduler selection yields a different process (SRTF behavior is achieved by re-adding preempted processes and comparing remaining times in the scheduler).


## Testing & CI suggestions

Add a simple smoke test that runs the server in a subprocess or directly imports the `KernelSimulator` and runs a few deterministic workloads and asserts expected outcomes. Example tests to add under a `tests/` directory:

- test_smoke_run_rr.py: run a small workload under RR and assert that `ok` is True and `metrics` include a reasonable `total_ticks` > 0.
- test_memory_fifo_vs_lru.py: run the same page reference sequence under FIFO and LRU and assert the page_faults differ (and match expected counts for your trace).

Example pytest snippet (pseudo):

```python
from backend.app import _run_kernel

def test_small_rr():
    res = _run_kernel('rr', 'cpu_bound', page_policy='lru', quantum=2, frames=8)
    assert 'metrics' in res and res['metrics']['total_ticks'] > 0
```

CI pipeline (GitHub Actions) idea
- Workflow that creates venv, installs dependencies, runs tests and lints (optional).
- Another workflow that builds a small Docker image that serves the app for demos (optional).


## Troubleshooting

- Port already in use: if `python backend/app.py` fails with `Address already in use`, either stop the process using port 5000 or set a different port in `app.run(port=XXXX)`.
- Missing dependencies: ensure virtual environment activated and run `pip install -r requirement.txt`. Consider pinning versions to avoid unexpected breakages.
- Long-running simulations: the kernel caps tick count with `if self.clock > 1000: break` to avoid infinite loops for malformed workloads. Adjust this threshold for longer experiments.


## Contributing

Contributions are welcome. A few suggestions for good-first changes:
- Add unit tests for KernelSimulator for several scheduling policies.
- Implement additional page replacement policies (Second-Chance, Clock, Optimal (Belady) for small traces).
- Improve frontend visualizations: make the tick timeline interactive and allow stepping through ticks.
- Add CLI options to run the simulator headlessly and output results to JSON files for batch experiments.

When submitting a PR, please include a short description, example commands to reproduce, and if relevant, expected output.


## License

This repository does not include an explicit license file. If you want to make this project open source, add a LICENSE file (for example, MIT or Apache-2.0) and include a short header in source files if desired.


## Acknowledgements

This project is an educational tool inspired by standard OS textbooks and teaching lab exercises. The code aims to remain compact and readable so it can be used in classrooms or self-study.


---
