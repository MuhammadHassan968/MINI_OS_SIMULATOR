class PageTableEntry:
    def __init__(self):
        self.frame     = None   # physical frame number, None = not loaded
        self.valid     = False
        self.dirty     = False
        self.ref_count = 0


class PageTable:
    def __init__(self, pid, num_pages):
        self.pid     = pid
        self.entries = {i: PageTableEntry() for i in range(num_pages)}

    def get_frame(self, page):
        e = self.entries.get(page)
        return e.frame if (e and e.valid) else None


class MemoryManager:
    def __init__(self, total_frames=16, page_size=4):
        self.total_frames  = total_frames
        self.page_size     = page_size              # KB
        self.frames        = [None] * total_frames  # frame_idx -> (pid, page) | None
        self.page_tables   = {}                     # pid -> PageTable
        self.page_faults   = 0
        self.page_hits     = 0
        self.access_log    = []                     # full trace for frontend
        self._fifo_queue   = []                     # (pid, page) in load order
        self._lru_order    = []                     # (pid, page) LRU list

    # ── lifecycle ──────────────────────────────────────────────────────────────
    def allocate(self, pid, num_pages):
        self.page_tables[pid] = PageTable(pid, num_pages)

    def deallocate(self, pid):
        if pid not in self.page_tables:
            return
        pt = self.page_tables.pop(pid)
        for page, entry in pt.entries.items():
            if entry.valid and entry.frame is not None:
                self.frames[entry.frame] = None
                key = (pid, page)
                if key in self._fifo_queue:
                    self._fifo_queue.remove(key)
                if key in self._lru_order:
                    self._lru_order.remove(key)

    # ── access ─────────────────────────────────────────────────────────────────
    def access(self, pid, page_num, policy="lru"):
        pt = self.page_tables.get(pid)
        if pt is None:
            # auto-allocate a small page table if process wasn't pre-allocated
            self.allocate(pid, max(page_num + 1, 4))
            pt = self.page_tables[pid]
            if page_num not in pt.entries:
                pt.entries[page_num] = PageTableEntry()

        entry = pt.entries.get(page_num)
        if entry is None:
            pt.entries[page_num] = PageTableEntry()
            entry = pt.entries[page_num]

        if entry.valid and entry.frame is not None:
            # HIT
            self.page_hits += 1
            frame = entry.frame
            key   = (pid, page_num)
            if policy == "lru":
                if key in self._lru_order:
                    self._lru_order.remove(key)
                self._lru_order.append(key)
            self.access_log.append({
                "pid": pid, "page": page_num,
                "frame": frame, "type": "hit",
                "policy": policy,
            })
            return frame

        # FAULT
        self.page_faults += 1
        frame = self._load_page(pid, page_num, policy)
        self.access_log.append({
            "pid": pid, "page": page_num,
            "frame": frame, "type": "fault",
            "policy": policy,
        })
        return frame

    def _load_page(self, pid, page_num, policy):
        frame = self._find_free_frame()
        if frame is None:
            frame = self._evict(policy)

        self.frames[frame]           = (pid, page_num)
        pt                           = self.page_tables[pid]
        if page_num not in pt.entries:
            pt.entries[page_num] = PageTableEntry()
        entry                        = pt.entries[page_num]
        entry.frame                  = frame
        entry.valid                  = True
        key                          = (pid, page_num)
        self._fifo_queue.append(key)
        if policy == "lru":
            if key in self._lru_order:
                self._lru_order.remove(key)
            self._lru_order.append(key)
        return frame

    def _find_free_frame(self):
        for i, f in enumerate(self.frames):
            if f is None:
                return i
        return None

    def _evict(self, policy):
        if policy == "fifo":
            victim_key = self._fifo_queue.pop(0)
        elif policy == "lru":
            victim_key = self._lru_order.pop(0)
        else:
            victim_key = self._fifo_queue[0] if self._fifo_queue else None

        if victim_key is None:
            return 0

        v_pid, v_page = victim_key
        if v_pid in self.page_tables:
            entry = self.page_tables[v_pid].entries.get(v_page)
            if entry:
                victim_frame  = entry.frame
                entry.frame   = None
                entry.valid   = False
                if victim_frame is not None:
                    self.frames[victim_frame] = None
                    return victim_frame
        # fallback
        for i, f in enumerate(self.frames):
            if f is not None:
                fp, fpage = f
                if fp in self.page_tables:
                    e = self.page_tables[fp].entries.get(fpage)
                    if e:
                        e.frame = None; e.valid = False
                self.frames[i] = None
                return i
        return 0

    # ── snapshots ──────────────────────────────────────────────────────────────
    def frame_snapshot(self):
        return [
            {"frame": i,
             "pid":   f[0] if f else None,
             "page":  f[1] if f else None}
            for i, f in enumerate(self.frames)
        ]

    def stats(self):
        total = self.page_hits + self.page_faults
        return {
            "page_faults":   self.page_faults,
            "page_hits":     self.page_hits,
            "total_accesses":total,
            "hit_rate":      round(self.page_hits / total * 100, 1) if total else 0,
        }