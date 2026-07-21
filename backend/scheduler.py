from collections import deque


class BaseScheduler:
    name = "Base"

    def __init__(self):
        self.ready_queue = []

    def add_process(self, pcb):
        self.ready_queue.append(pcb)

    def next_process(self):
        raise NotImplementedError

    def requeue(self, pcb):
        """Called when a running process must return to ready (preemption)."""
        self.ready_queue.append(pcb)

    def is_empty(self):
        return len(self.ready_queue) == 0

    def queue_snapshot(self):
        return [p.pid for p in self.ready_queue]


# ── FCFS ──────────────────────────────────────────────────────────────────────
class FCFSScheduler(BaseScheduler):
    name = "FCFS"

    def add_process(self, pcb):
        self.ready_queue.append(pcb)

    def next_process(self):
        return self.ready_queue.pop(0) if self.ready_queue else None


# ── Round Robin ───────────────────────────────────────────────────────────────
class RoundRobinScheduler(BaseScheduler):
    def __init__(self, quantum=2):
        super().__init__()
        self.quantum = quantum
        self.queue   = deque()
        self.name    = f"Round Robin (Q={quantum})"

    def add_process(self, pcb):
        self.queue.append(pcb)

    def next_process(self):
        return self.queue.popleft() if self.queue else None

    def requeue(self, pcb):
        self.queue.append(pcb)

    def is_empty(self):
        return len(self.queue) == 0

    def queue_snapshot(self):
        return [p.pid for p in self.queue]


# ── Priority (non-preemptive, lower number = higher priority) ─────────────────
class PriorityScheduler(BaseScheduler):
    name = "Priority (non-preemptive)"

    def next_process(self):
        if not self.ready_queue:
            return None
        best = min(self.ready_queue, key=lambda p: p.priority)
        self.ready_queue.remove(best)
        return best


# ── SJF (non-preemptive) ──────────────────────────────────────────────────────
class SJFScheduler(BaseScheduler):
    name = "SJF (non-preemptive)"

    def next_process(self):
        if not self.ready_queue:
            return None
        shortest = min(self.ready_queue, key=lambda p: p.remaining_time)
        self.ready_queue.remove(shortest)
        return shortest


# ── SRTF (Shortest Remaining Time First – preemptive SJF) ─────────────────────
class SRTFScheduler(BaseScheduler):
    name = "SRTF (preemptive)"

    def next_process(self):
        if not self.ready_queue:
            return None
        shortest = min(self.ready_queue, key=lambda p: p.remaining_time)
        self.ready_queue.remove(shortest)
        return shortest

    def requeue(self, pcb):
        self.ready_queue.append(pcb)