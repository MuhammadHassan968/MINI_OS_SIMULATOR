import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from process_manager import ProcessManager
from pcb import ProcessState
from memory import MemoryManager
from sync import SyncManager


class KernelSimulator:
    def __init__(self, scheduler, memory_manager, sync_manager):
        self.pm          = ProcessManager()
        self.scheduler   = scheduler
        self.mm          = memory_manager
        self.sync        = sync_manager
        self.clock       = 0
        self.gantt       = []          # {pid, name, start, end}
        self.io_queue    = []          # (pcb, io_finish_time)
        self.tick_log    = []          # per-tick snapshots for frontend
        self.pending     = []

    # ── workload loading ───────────────────────────────────────────────────────
    def load_workload(self, workload):
        from pcb import PCB
        PCB.reset_counter()
        self.pending = sorted(workload, key=lambda x: x.get("arrival", 0))
        for w in self.pending:
            pcb = self.pm.create_process(
                name        = w["name"],
                burst_time  = w["burst"],
                priority    = w.get("priority", 0),
                arrival_time= w.get("arrival", 0),
                io_bursts   = w.get("io_bursts", []),
            )
            # allocate pages (1 page per 2 burst units, min 2)
            num_pages = max(2, pcb.burst_time // 2)
            self.mm.allocate(pcb.pid, num_pages)
            w["_pcb"] = pcb

    # ── main simulation loop ───────────────────────────────────────────────────
    def run(self):
        pending_arrivals  = list(self.pending)
        running           = None
        quantum_remaining = getattr(self.scheduler, "quantum", None)
        is_rr             = hasattr(self.scheduler, "quantum")
        is_preemptive     = is_rr

        while True:
            tick_events = []

            # 1. Admit newly arrived processes
            arrived = [w for w in pending_arrivals
                       if w.get("arrival", 0) <= self.clock]
            for w in arrived:
                pcb = w["_pcb"]
                pcb.state = ProcessState.READY
                self.scheduler.add_process(pcb)
                pending_arrivals.remove(w)
                tick_events.append(
                    f"t={self.clock}: {pcb.name} arrived → READY")

            # 2. Handle I/O completions
            done_io = [(pcb, ft) for (pcb, ft) in self.io_queue
                       if ft <= self.clock]
            for (pcb, ft) in done_io:
                self.io_queue.remove((pcb, ft))
                pcb.state = ProcessState.READY
                self.scheduler.add_process(pcb)
                tick_events.append(
                    f"t={self.clock}: {pcb.name} I/O done → READY")

            # 3. Round-Robin quantum expiry
            if running and is_rr and quantum_remaining is not None:
                if quantum_remaining <= 0:
                    if running.remaining_time > 0:
                        running.state = ProcessState.READY
                        self.scheduler.requeue(running)
                        tick_events.append(
                            f"t={self.clock}: {running.name} preempted (quantum expired)")
                        if self.gantt and "end" not in self.gantt[-1]:
                            self.gantt[-1]["end"] = self.clock
                    running = None

            # 4. Pick next process if CPU free
            if running is None:
                running = self.scheduler.next_process()
                if running:
                    running.state = ProcessState.RUNNING
                    if running.start_time is None:
                        running.start_time = self.clock
                    quantum_remaining = getattr(self.scheduler, "quantum", None)
                    self.gantt.append({
                        "pid":   running.pid,
                        "name":  running.name,
                        "start": self.clock,
                    })
                    tick_events.append(
                        f"t={self.clock}: CPU → {running.name} "
                        f"(remaining={running.remaining_time})")

            # 5. Execute one CPU tick
            if running:
                running.remaining_time -= 1
                running.cpu_used       += 1
                if quantum_remaining is not None:
                    quantum_remaining -= 1

                # simulate a memory access each tick
                page = running.cpu_used % max(2, running.burst_time // 2)
                self.mm.access(running.pid, page,
                               policy=getattr(self, "_page_policy", "lru"))

                # check for I/O burst
                io_triggered = False
                for (after_cpu, io_dur) in list(running.io_bursts):
                    if running.cpu_used == after_cpu:
                        running.io_bursts.remove((after_cpu, io_dur))
                        running.state = ProcessState.WAITING
                        finish_io     = self.clock + 1 + io_dur
                        self.io_queue.append((running, finish_io))
                        if self.gantt and "end" not in self.gantt[-1]:
                            self.gantt[-1]["end"] = self.clock + 1
                        tick_events.append(
                            f"t={self.clock}: {running.name} started I/O "
                            f"(finishes t={finish_io})")
                        running       = None
                        io_triggered  = True
                        break

                # check termination
                if running and running.remaining_time <= 0:
                    self.gantt[-1]["end"] = self.clock + 1
                    self.pm.terminate_process(running, self.clock + 1)
                    self.mm.deallocate(running.pid)
                    tick_events.append(
                        f"t={self.clock+1}: {running.name} TERMINATED "
                        f"(TAT={running.turnaround_time}, WT={running.waiting_time})")
                    running = None

            # 6. Record tick snapshot
            self.tick_log.append({
                "tick":          self.clock,
                "running_pid":   running.pid if running else None,
                "running_name":  running.name if running else "idle",
                "ready_queue":   self.scheduler.queue_snapshot(),
                "io_queue":      [(p.pid, ft) for (p, ft) in self.io_queue],
                "events":        list(tick_events),
                "frames":        self.mm.frame_snapshot(),
                "processes":     self.pm.snapshot(),
            })

            # 7. Termination check
            all_done = (
                not pending_arrivals
                and self.scheduler.is_empty()
                and not self.io_queue
                and running is None
            )
            if all_done:
                break

            self.clock += 1
            if self.clock > 1000:
                break

        # close any open gantt segment
        for g in self.gantt:
            if "end" not in g:
                g["end"] = self.clock

    # ── result packaging ───────────────────────────────────────────────────────
    def results(self):
        processes = self.pm.snapshot()
        n = len(processes)
        if n == 0:
            return {}

        avg_wt  = round(sum(p["waiting_time"]    for p in processes) / n, 2)
        avg_tat = round(sum(p["turnaround_time"] for p in processes) / n, 2)
        total_cpu = sum(p["burst_time"]          for p in processes)
        cpu_util  = round(total_cpu / max(self.clock, 1) * 100, 1)

        return {
            "processes":   processes,
            "gantt":       self.gantt,
            "tick_log":    self.tick_log,
            "metrics": {
                "avg_waiting":     avg_wt,
                "avg_turnaround":  avg_tat,
                "cpu_utilization": cpu_util,
                "total_ticks":     self.clock,
                "throughput":      round(n / max(self.clock, 1), 3),
                **self.mm.stats(),
            },
            "scheduler":   self.scheduler.name,
            "frames":      self.mm.frame_snapshot(),
        }