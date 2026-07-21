from enum import Enum


class ThreadState(Enum):
    NEW        = "new"
    READY      = "ready"
    RUNNING    = "running"
    BLOCKED    = "blocked"
    TERMINATED = "terminated"


class TCB:
    _id_counter = 0

    def __init__(self, parent_pid, name="thread", burst_time=5):
        TCB._id_counter += 1
        self.tid         = TCB._id_counter
        self.parent_pid  = parent_pid
        self.name        = name
        self.state       = ThreadState.NEW
        self.burst_time  = burst_time
        self.remaining   = burst_time
        self.start_time  = None
        self.finish_time = None

    @classmethod
    def reset_counter(cls):
        cls._id_counter = 0

    def __repr__(self):
        return (f"TCB(tid={self.tid}, parent={self.parent_pid}, "
                f"state={self.state.value})")