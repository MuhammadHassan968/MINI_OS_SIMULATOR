import threading


class SimMutex:
    """Simulated mutex with full ownership tracking and event log."""

    def __init__(self, name):
        self.name       = name
        self.owner      = None
        self._lock      = threading.Lock()
        self.wait_queue = []
        self.event_log  = []

    def _log(self, event_type, pid, message):
        self.event_log.append({
            "type":    event_type,
            "pid":     pid,
            "message": message,
            "owner":   self.owner,
            "queue":   list(self.wait_queue),
        })

    def acquire(self, pid):
        with self._lock:
            if self.owner is None:
                self.owner = pid
                self._log("acquired", pid,
                          f"PID {pid} acquired '{self.name}'")
                return True
            else:
                self.wait_queue.append(pid)
                self._log("blocked", pid,
                          f"PID {pid} BLOCKED – '{self.name}' held by PID {self.owner}")
                return False

    def release(self, pid):
        with self._lock:
            if self.owner != pid:
                raise RuntimeError(
                    f"PID {pid} tried to release mutex it doesn't own "
                    f"(owner={self.owner})"
                )
            self.owner = None
            self._log("released", pid,
                      f"PID {pid} released '{self.name}'")
            if self.wait_queue:
                next_pid   = self.wait_queue.pop(0)
                self.owner = next_pid
                self._log("transferred", next_pid,
                          f"'{self.name}' transferred to PID {next_pid}")

    def state_dict(self):
        return {
            "name":       self.name,
            "owner":      self.owner,
            "wait_queue": list(self.wait_queue),
        }


class SimSemaphore:
    """Counting semaphore with event log."""

    def __init__(self, name, initial=1):
        self.name       = name
        self.count      = initial
        self.initial    = initial
        self._lock      = threading.Lock()
        self.wait_queue = []
        self.event_log  = []

    def _log(self, event_type, pid, message):
        self.event_log.append({
            "type":    event_type,
            "pid":     pid,
            "count":   self.count,
            "message": message,
            "queue":   list(self.wait_queue),
        })

    def wait(self, pid):          # P() / down()
        with self._lock:
            self.count -= 1
            if self.count < 0:
                self.wait_queue.append(pid)
                self._log("blocked", pid,
                          f"PID {pid} BLOCKED on '{self.name}' (count={self.count})")
                return False
            self._log("acquired", pid,
                      f"PID {pid} acquired '{self.name}' (count={self.count})")
            return True

    def signal(self, pid):        # V() / up()
        with self._lock:
            self.count += 1
            self._log("signaled", pid,
                      f"PID {pid} signaled '{self.name}' (count={self.count})")
            if self.wait_queue:
                unblocked = self.wait_queue.pop(0)
                self._log("unblocked", unblocked,
                          f"PID {unblocked} UNBLOCKED from '{self.name}'")

    def state_dict(self):
        return {
            "name":       self.name,
            "count":      self.count,
            "initial":    self.initial,
            "wait_queue": list(self.wait_queue),
        }


class SyncManager:
    def __init__(self):
        self.mutexes    = {}
        self.semaphores = {}

    def create_mutex(self, name):
        m = SimMutex(name)
        self.mutexes[name] = m
        return m

    def create_semaphore(self, name, initial=1):
        s = SimSemaphore(name, initial)
        self.semaphores[name] = s
        return s

    def run_producer_consumer_demo(self, buffer_size=3, producers=2, consumers=2):
        """Classic producer-consumer with a semaphore-guarded buffer."""
        log = []
        empty  = SimSemaphore("empty",  buffer_size)
        full   = SimSemaphore("full",   0)
        mutex  = SimMutex("buffer_lock")
        buffer = []

        def record(pid, role, action, buf_state):
            log.append({
                "pid":    pid,
                "role":   role,
                "action": action,
                "buffer": list(buf_state),
                "empty":  empty.count,
                "full":   full.count,
            })

        pid = 100
        for i in range(producers):
            pid += 1
            # produce item
            empty.wait(pid)
            mutex.acquire(pid)
            item = f"item{i+1}"
            buffer.append(item)
            record(pid, "producer", f"produced {item}", buffer)
            mutex.release(pid)
            full.signal(pid)

        for i in range(consumers):
            pid += 1
            full.wait(pid)
            mutex.acquire(pid)
            if buffer:
                item = buffer.pop(0)
                record(pid, "consumer", f"consumed {item}", buffer)
            mutex.release(pid)
            empty.signal(pid)

        return {
            "log":       log,
            "mutex_log": mutex.event_log,
            "empty_log": empty.event_log,
            "full_log":  full.event_log,
        }

    def run_mutex_demo(self):
        """Three processes competing for one mutex."""
        mutex = SimMutex("resource_A")
        log   = []

        for pid in [1, 2, 3]:
            result = mutex.acquire(pid)
            log.append({
                "pid":     pid,
                "action":  "acquire",
                "success": result,
                "owner":   mutex.owner,
                "queue":   list(mutex.wait_queue),
                "message": mutex.event_log[-1]["message"],
            })

        # P1 releases → P2 gets it
        mutex.release(1)
        log.append({
            "pid":    1,
            "action": "release",
            "owner":  mutex.owner,
            "queue":  list(mutex.wait_queue),
            "message": f"PID 1 released mutex → now owner: PID {mutex.owner}",
        })
        # P2 releases → P3 gets it
        mutex.release(2)
        log.append({
            "pid":    2,
            "action": "release",
            "owner":  mutex.owner,
            "queue":  list(mutex.wait_queue),
            "message": f"PID 2 released mutex → now owner: PID {mutex.owner}",
        })
        # P3 releases
        mutex.release(3)
        log.append({
            "pid":    3,
            "action": "release",
            "owner":  mutex.owner,
            "queue":  list(mutex.wait_queue),
            "message": "PID 3 released mutex → mutex is FREE",
        })
        return {"log": log, "mutex_log": mutex.event_log}