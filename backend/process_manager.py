from pcb import PCB, ProcessState
from tcb import TCB, ThreadState


class ProcessManager:
    def __init__(self):
        self.process_table = {}   # pid -> PCB
        self.thread_table  = {}   # tid -> TCB
        self.event_log     = []   # list of event dicts for frontend

    def _log(self, tick, event_type, pid, message, extra=None):
        entry = {"tick": tick, "type": event_type,
                 "pid": pid, "message": message}
        if extra:
            entry.update(extra)
        self.event_log.append(entry)

    def create_process(self, name, burst_time, priority=0,
                       arrival_time=0, io_bursts=None):
        pcb = PCB(name, burst_time, priority, io_bursts)
        pcb.arrival_time = arrival_time
        pcb.state = ProcessState.READY
        self.process_table[pcb.pid] = pcb
        return pcb

    def create_thread(self, parent_pid, name="thread", burst_time=5):
        tcb = TCB(parent_pid, name, burst_time)
        tcb.state = ThreadState.READY
        self.thread_table[tcb.tid] = tcb
        parent = self.process_table.get(parent_pid)
        if parent:
            parent.threads.append(tcb)
        return tcb

    def terminate_process(self, pcb, current_time):
        pcb.state        = ProcessState.TERMINATED
        pcb.finish_time  = current_time
        pcb.turnaround_time = pcb.finish_time - pcb.arrival_time
        pcb.waiting_time    = pcb.turnaround_time - pcb.burst_time
        self._log(current_time, "terminate", pcb.pid,
                  f"{pcb.name} terminated",
                  {"turnaround": pcb.turnaround_time,
                   "waiting":    pcb.waiting_time})

    def get_process(self, pid):
        return self.process_table.get(pid)

    def snapshot(self):
        """Return serialisable list of all processes."""
        out = []
        for p in self.process_table.values():
            out.append({
                "pid":            p.pid,
                "name":           p.name,
                "state":          p.state.value,
                "priority":       p.priority,
                "burst_time":     p.burst_time,
                "remaining_time": p.remaining_time,
                "arrival_time":   p.arrival_time,
                "start_time":     p.start_time,
                "finish_time":    p.finish_time,
                "waiting_time":   p.waiting_time,
                "turnaround_time":p.turnaround_time,
                "cpu_used":       p.cpu_used,
                "threads":        [t.tid for t in p.threads],
            })
        return out