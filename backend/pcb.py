from enum import Enum


class ProcessState(Enum):
    NEW        = "new"
    READY      = "ready"
    RUNNING    = "running"
    WAITING    = "waiting"
    TERMINATED = "terminated"


class PCB:
    _id_counter = 0

    def __init__(self, name, burst_time, priority=0, io_bursts=None):
        PCB._id_counter += 1
        self.pid             = PCB._id_counter
        self.name            = name
        self.state           = ProcessState.NEW
        self.priority        = priority
        self.burst_time      = burst_time
        self.remaining_time  = burst_time
        self.io_bursts       = list(io_bursts) if io_bursts else []
        self.arrival_time    = 0
        self.start_time      = None
        self.finish_time     = None
        self.waiting_time    = 0
        self.turnaround_time = 0
        self.threads         = []
        self.cpu_used        = 0          # ticks actually on CPU

    @classmethod
    def reset_counter(cls):
        cls._id_counter = 0

    def __repr__(self):
        return (f"PCB(pid={self.pid}, name={self.name}, "
                f"state={self.state.value}, remaining={self.remaining_time})")