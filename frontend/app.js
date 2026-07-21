// ─────────────────────────────────────────────────────────────────────────────
//  Mini OS Kernel Simulator — app.js   (fully corrected)
// ─────────────────────────────────────────────────────────────────────────────

// ── SAFE DOM HELPERS (prevents null.style / null.textContent crashes) ──
function $(id) {
  return document.getElementById(id);
}
function safeStyle(id, prop, value) {
  const el = $(id);
  if (el) el.style[prop] = value;
}
function safeText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}
function safeHTML(id, value) {
  const el = $(id);
  if (el) el.innerHTML = value;
}

let lastResult  = null;
let tickIndex   = 0;
let charts      = {};

// Animation state
let procSteps   = [];
let procIdx     = 0;
let procPlaying = false;
let procTimer   = null;

let schedSteps  = [];
let schedIdx    = 0;
let schedPlaying = false;
let schedTimer  = null;

let memEvents   = [];
let memState    = [];
let memIdx      = 0;
let memPlaying  = false;
let memTimer    = null;

const ANIM_DELAY = 1500; // ms per step

// ── Process colours ───────────────────────────────────────────────────────────
const PROC_COLORS = [
  { bg: "#4c1d95", fg: "#ddd6fe", border: "#7c3aed" },
  { bg: "#14532d", fg: "#86efac", border: "#16a34a" },
  { bg: "#7c2d12", fg: "#fed7aa", border: "#ea580c" },
  { bg: "#1e3a5f", fg: "#93c5fd", border: "#2563eb" },
  { bg: "#4a044e", fg: "#f0abfc", border: "#a21caf" },
  { bg: "#064e3b", fg: "#6ee7b7", border: "#059669" },
  { bg: "#713f12", fg: "#fef08a", border: "#ca8a04" },
];
function pc(pid) { return PROC_COLORS[(pid - 1) % PROC_COLORS.length]; }

function pill(pid, name, extraClass = "") {
  const c = pc(pid);
  return `<span class="proc-pill ${extraClass}"
               style="background:${c.bg};color:${c.fg};border:1px solid ${c.border}">
            ${name}
          </span>`;
}

// ── Panel nav ─────────────────────────────────────────────────────────────────
function showPanel(name) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const panel = document.getElementById("panel-" + name);
  if (panel) panel.classList.add("active");
  const btn = document.querySelector(`.nav-btn[data-panel="${name}"]`);
  if (btn) btn.classList.add("active");
}

function onSchedulerChange() {
  const sel = $("schedulerSel");
  const qi  = $("quantumInput");
  if (!sel || !qi) return;
  qi.disabled = (sel.value !== "rr" && sel.value !== "srtf");
}

// ── Stop all animations ───────────────────────────────────────────────────────
function stopAllAnims() {
  clearInterval(procTimer);  procTimer  = null; procPlaying  = false;
  clearInterval(schedTimer); schedTimer = null; schedPlaying = false;
  clearInterval(memTimer);   memTimer   = null; memPlaying   = false;
  ["procPlayBtn", "schedPlayBtn", "memPlayBtn"].forEach(id => {
    const b = $(id);
    if (b) b.textContent = "▶ Play";
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  RUN SIMULATION
// ═════════════════════════════════════════════════════════════════════════════
async function runSimulation() {
  stopAllAnims();
  const btn    = $("runBtn");
  const loader = $("loader");
  if (btn)    btn.disabled = true;
  if (loader) loader.classList.add("active");
  safeStyle("statusLight", "background", "#f59e0b");

  const schedulerSel  = $("schedulerSel");
  const workloadSel   = $("workloadSel");
  const pagePolicySel = $("pagePolicySel");
  const quantumInput  = $("quantumInput");
  const framesInput   = $("framesInput");

  const payload = {
    scheduler:   schedulerSel  ? schedulerSel.value  : "rr",
    workload:    workloadSel   ? workloadSel.value    : "mixed",
    page_policy: pagePolicySel ? pagePolicySel.value  : "lru",
    quantum:     parseInt(quantumInput ? quantumInput.value : "2")  || 2,
    frames:      parseInt(framesInput  ? framesInput.value  : "16") || 16,
  };

  try {
    const res  = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Unknown error");

    lastResult = data;
    tickIndex  = 0;

    buildProcSteps(data);
    buildSchedSteps(data);
    buildMemEvents(data);

    renderStats(data.metrics);
    renderProcessTable(data.processes);
    renderGanttFull(data.gantt, data.metrics.total_ticks);
    renderMetrics(data);
    renderTimeline(data);

    // init animation at step 0
    memState = Array(data.frames.length).fill(null);
    procIdx = 0; schedIdx = 0; memIdx = 0;
    if (procSteps.length)  renderProcStep(0);
    if (schedSteps.length) renderSchedStep(0);
    if (memEvents.length)  renderMemStep(0);
    else                   renderMemFinal();

    // enable play buttons
    ["procPlayBtn", "schedPlayBtn", "memPlayBtn"].forEach(id => {
      const b = $(id);
      if (b) b.disabled = false;
    });

    // auto-play with staggered start
    setTimeout(() => startProcAnim(),   400);
    setTimeout(() => startSchedAnim(),  800);
    setTimeout(() => startMemAnim(),   1200);

    safeText("clockBadge", `clock: t=${data.metrics.total_ticks}`);
    safeStyle("statusLight", "background", "#22c55e");

    const slider = $("tickSlider");
    if (slider) {
      slider.max   = (data.tick_log || []).length - 1;
      slider.value = slider.max;
      goToTick(slider.max);
    }

  } catch (e) {
    alert("Error: " + e.message);
    console.error(e);
    safeStyle("statusLight", "background", "#ef4444");
  }

  if (btn)    btn.disabled = false;
  if (loader) loader.classList.remove("active");
}

function resetAll() {
  stopAllAnims();
  lastResult = null; tickIndex = 0;
  procSteps = []; schedSteps = []; memEvents = []; memState = [];
  safeText("clockBadge", "clock: idle");
  safeStyle("statusLight", "background", "#22c55e");

  ["statCPU", "statWT", "statTAT", "statPF", "statTP"].forEach(id => safeText(id, "—"));
  ["statWTsub", "statTATsub", "statPFsub", "statTPsub"].forEach(id => safeText(id, "\u00a0"));
  safeStyle("cpuBar", "width", "0");

  safeHTML("processTableBody",
    '<tr><td colspan="10" class="empty-row">Run a simulation to see processes</td></tr>');
  safeHTML("ganttContainer", '<p class="empty-msg">Run a simulation first</p>');
  safeHTML("memGrid",        '<p class="empty-msg">Run simulation to see memory</p>');
  safeHTML("memLegend", "");

  safeText("procCommentaryText",  "Run a simulation to see step-by-step process state transitions…");
  safeText("schedCommentaryText", "Run a simulation to see the CPU scheduler in action…");
  safeText("memCommentaryText",   "Run a simulation to watch pages load into physical memory frames…");

  ["procPlayBtn", "schedPlayBtn", "memPlayBtn"].forEach(id => {
    const b = $(id);
    if (b) { b.disabled = true; b.textContent = "▶ Play"; }
  });

  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
  charts = {};
}

// ═════════════════════════════════════════════════════════════════════════════
//  PROCESS MANAGER ANIMATION
// ═════════════════════════════════════════════════════════════════════════════
function buildProcSteps(data) {
  procSteps = [];
  if (!data.tick_log) return;
  data.tick_log.forEach(tick => {
    (tick.events || []).forEach(ev => {
      let state = null, pid = null, name = "";
      if (/arrived/.test(ev)) {
        const m = ev.match(/(\w+)\s+arrived/); if (m) name = m[1]; state = "new";
      } else if (/CPU\s+→/.test(ev)) {
        const m = ev.match(/CPU\s+→\s+(\w+)/); if (m) name = m[1]; state = "running";
      } else if (/DONE/.test(ev)) {
        const m = ev.match(/(\w+)\s+DONE/); if (m) name = m[1]; state = "terminated";
      } else if (/→\s+I\/O/.test(ev)) {
        const m = ev.match(/(\w+)\s+→\s+I\/O/); if (m) name = m[1]; state = "waiting";
      } else if (/I\/O\s+done/.test(ev)) {
        const m = ev.match(/(\w+)\s+I\/O\s+done/); if (m) name = m[1]; state = "ready";
      } else if (/preempted/.test(ev)) {
        const m = ev.match(/(\w+)\s+preempted/); if (m) name = m[1]; state = "ready";
      }
      if (name && state) {
        const p = data.processes.find(x => x.name === name);
        if (p) pid = p.pid;
        if (pid) procSteps.push({
          tick: tick.tick, state, pid, name, event: ev,
          readyQ: tick.ready_queue || [],
          ioQ:    tick.io_queue    || [],
          processes: tick.processes || [],
        });
      }
    });
  });
}

const STATE_POS = {
  new:        { cx: 70,  cy: 105 },
  ready:      { cx: 220, cy: 105 },
  running:    { cx: 395, cy: 105 },
  waiting:    { cx: 395, cy: 183 },
  terminated: { cx: 578, cy: 105 },
};

function renderProcStep(idx) {
  if (!procSteps.length) return;
  idx = Math.max(0, Math.min(procSteps.length - 1, idx));
  procIdx = idx;
  const step = procSteps[idx];
  const c    = pc(step.pid);
  const pos  = STATE_POS[step.state] || STATE_POS.ready;

  // Move badge
  const badge  = $("procBadge");
  const bRect  = $("procBadgeRect");
  const bText  = $("procBadgeText");
  if (badge) badge.style.display = "block";
  if (bRect) {
    bRect.setAttribute("x",      pos.cx - 35);
    bRect.setAttribute("y",      pos.cy - 50);
    bRect.setAttribute("fill",   c.bg);
    bRect.setAttribute("stroke", c.border);
    bRect.setAttribute("stroke-width", "2");
  }
  if (bText) {
    bText.setAttribute("x",    pos.cx);
    bText.setAttribute("y",    pos.cy - 34);
    bText.setAttribute("fill", c.fg);
    bText.textContent = step.name;
  }

  // Highlight active state bubble
  const stateMap = {
    new: "sNew", ready: "sReady", running: "sRunning",
    waiting: "sWaiting", terminated: "sTerminated"
  };
  Object.entries(stateMap).forEach(([s, id]) => {
    const el  = $(id);
    if (!el) return;
    const ell = el.querySelector("ellipse");
    if (!ell) return;
    if (s === step.state) {
      ell.setAttribute("stroke-width", "3.5");
      ell.setAttribute("filter", "url(#glow)");
    } else {
      ell.setAttribute("stroke-width", "1.5");
      ell.removeAttribute("filter");
    }
  });

  // Commentary
  const wt  = (step.processes || []).find(p => p.pid === step.pid)?.waiting_time    ?? "?";
  const tat = (step.processes || []).find(p => p.pid === step.pid)?.turnaround_time ?? "?";
  const rqStr = (step.readyQ || []).map(p => "PID " + p).join(", ") || "empty";
  const msgs = {
    new:        `🆕  t=${step.tick}: Process "${step.name}" (PID ${step.pid}) is CREATED. The OS builds a PCB for it and places it in the NEW state. It will be admitted to the ready queue next.`,
    ready:      `📋  t=${step.tick}: "${step.name}" entered the READY QUEUE — it is in memory, waiting its turn for the CPU. Ready queue right now: [${rqStr}]`,
    running:    `⚡  t=${step.tick}: Scheduler dispatched "${step.name}" to the CPU! It is now RUNNING. The CPU is executing its instructions. Ready queue: [${rqStr}]`,
    waiting:    `⏳  t=${step.tick}: "${step.name}" issued an I/O request and moved to WAITING. CPU is released so another process can run while I/O completes.`,
    terminated: `✅  t=${step.tick}: "${step.name}" has TERMINATED — all its CPU bursts are done. WT=${wt}t | TAT=${tat}t. Its PCB will be removed from the process table.`,
  };
  safeText("procCommentaryText", msgs[step.state] || step.event);
  safeText("procStepLabel",      `Step ${idx + 1} / ${procSteps.length}`);
  renderProcessTable(step.processes || lastResult.processes, step.pid);
}

function stepProc(d)     { renderProcStep(procIdx + d); }
function startProcAnim() {
  procPlaying = true;
  safeText("procPlayBtn", "⏸ Pause");
  procTimer = setInterval(() => {
    if (procIdx >= procSteps.length - 1) { stopProcAnim(); return; }
    renderProcStep(procIdx + 1);
  }, ANIM_DELAY);
}
function stopProcAnim() {
  clearInterval(procTimer); procTimer = null; procPlaying = false;
  safeText("procPlayBtn", "▶ Play");
}
function toggleProcAnim() { if (procPlaying) stopProcAnim(); else startProcAnim(); }

// ═════════════════════════════════════════════════════════════════════════════
//  CPU SCHEDULER ANIMATION
// ═════════════════════════════════════════════════════════════════════════════
function buildSchedSteps(data) { schedSteps = data.tick_log || []; }

function renderSchedStep(idx) {
  if (!schedSteps.length) return;
  idx = Math.max(0, Math.min(schedSteps.length - 1, idx));
  schedIdx = idx;
  const tick = schedSteps[idx];
  if (!tick) return;

  // Zone NEW
  const arrivals = (tick.events || [])
    .filter(e => /arrived/.test(e))
    .map(e => { const m = e.match(/(\w+)\s+arrived/); return m ? m[1] : "?"; });
  safeHTML("zoneNew", arrivals.length
    ? arrivals.map(n => {
        const p = lastResult.processes.find(x => x.name === n);
        return p ? pill(p.pid, n) : n;
      }).join(" ")
    : `<span class="muted">—</span>`);

  // Zone READY
  safeHTML("zoneReady", (tick.ready_queue || []).length
    ? (tick.ready_queue || []).map(pid => {
        const p = lastResult.processes.find(x => x.pid === pid);
        return pill(pid, p ? p.name : "P" + pid);
      }).join(" ")
    : `<span class="muted">empty</span>`);

  // Zone CPU
  const zCPU = $("zoneCPU");
  if (zCPU) {
    if (tick.running_pid) {
      const c   = pc(tick.running_pid);
      const rem = (tick.processes || []).find(x => x.pid === tick.running_pid)?.remaining_time;
      zCPU.innerHTML = `<div style="text-align:center">
        <span class="proc-pill proc-pill-cpu"
              style="background:${c.bg};color:${c.fg};border:2px solid ${c.border};
                     font-size:13px;padding:6px 16px">${tick.running_name}</span>
        ${rem != null ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">remaining: ${rem}t</div>` : ""}
      </div>`;
    } else {
      zCPU.innerHTML = `<span class="muted" style="font-style:italic">idle</span>`;
    }
  }

  // Zone IO
  safeHTML("zoneIO", (tick.io_queue || []).length
    ? (tick.io_queue || []).map(([pid, ft]) => {
        const p = lastResult.processes.find(x => x.pid === pid);
        const c = pc(pid);
        return `<span class="proc-pill" style="background:${c.bg};color:${c.fg};border:1px solid ${c.border}">
                  ${p ? p.name : "P" + pid}<span style="font-size:9px;opacity:.7;margin-left:4px">done@t=${ft}</span>
                </span>`;
      }).join(" ")
    : `<span class="muted">none</span>`);

  // Zone DONE
  const terminated = lastResult.processes.filter(
    p => p.state === "terminated" && p.finish_time != null && p.finish_time <= tick.tick + 1
  );
  safeHTML("zoneDone", terminated.length
    ? terminated.map(p => pill(p.pid, p.name)).join(" ")
    : `<span class="muted">—</span>`);

  // Tick info
  safeText("schedTickInfo",
    `t=${tick.tick}: ` + ((tick.events || []).join(" | ") || "no events this tick"));

  // Commentary
  let msg = "";
  if (tick.running_pid) {
    const rem = (tick.processes || []).find(x => x.pid === tick.running_pid)?.remaining_time;
    msg = `⚡ t=${tick.tick}: CPU is running "${tick.running_name}". ` +
          `Ready queue has ${(tick.ready_queue || []).length} process(es) waiting. ` +
          (rem != null ? `This process has ${rem} tick(s) of CPU work remaining. ` : "") +
          ((tick.io_queue || []).length
            ? `${tick.io_queue.length} process(es) are in I/O wait.`
            : "No I/O waits.");
  } else if ((tick.ready_queue || []).length) {
    msg = `📋 t=${tick.tick}: CPU is about to pick the next process. ` +
          `${lastResult.scheduler} will choose from ready queue: ` +
          `[${tick.ready_queue.map(p => "PID " + p).join(", ")}].`;
  } else if ((tick.io_queue || []).length) {
    msg = `⏳ t=${tick.tick}: CPU is IDLE — all processes are waiting on I/O. ` +
          `Waiting: ${tick.io_queue.map(([p, ft]) => "PID " + p + " returns at t=" + ft).join(", ")}`;
  } else {
    msg = `t=${tick.tick}: All processes have completed. Simulation done.`;
  }
  safeText("schedCommentaryText", msg);
  safeText("schedStepLabel",      `Tick ${idx + 1} / ${schedSteps.length}`);

  renderGanttUpTo(tick.tick);
}

function stepSched(d)      { renderSchedStep(schedIdx + d); }
function startSchedAnim()  {
  schedPlaying = true;
  safeText("schedPlayBtn", "⏸ Pause");
  schedTimer = setInterval(() => {
    if (schedIdx >= schedSteps.length - 1) { stopSchedAnim(); return; }
    renderSchedStep(schedIdx + 1);
  }, ANIM_DELAY);
}
function stopSchedAnim()   {
  clearInterval(schedTimer); schedTimer = null; schedPlaying = false;
  safeText("schedPlayBtn", "▶ Play");
}
function toggleSchedAnim() { if (schedPlaying) stopSchedAnim(); else startSchedAnim(); }

// Gantt that grows tick by tick
function renderGanttUpTo(currentTick) {
  if (!lastResult?.gantt) return;
  const gantt      = lastResult.gantt;
  const totalTicks = lastResult.metrics.total_ticks;
  const names      = [...new Set(gantt.map(g => g.name))];
  const step       = Math.max(1, Math.ceil(totalTicks / 20));

  let html = `<div class="gantt-ticks">`;
  for (let t = 0; t <= totalTicks; t += step)
    html += `<div class="gantt-tick" style="flex:${step}">${t}</div>`;
  html += `</div>`;

  names.forEach(name => {
    const pid  = gantt.find(g => g.name === name)?.pid || 1;
    const c    = pc(pid);
    const segs = gantt.filter(g => g.name === name && g.end != null && g.start <= currentTick);
    html += `<div class="gantt-row">
      <div class="gantt-lbl">${name}</div>
      <div class="gantt-track">`;
    segs.forEach(seg => {
      const visEnd = Math.min(seg.end, currentTick + 1);
      const l = (seg.start / totalTicks * 100).toFixed(2);
      const w = ((visEnd - seg.start) / totalTicks * 100).toFixed(2);
      const active = seg.start <= currentTick && seg.end > currentTick;
      html += `<div class="gantt-seg"
                    style="left:${l}%;width:${w}%;background:${c.bg};color:${c.fg};
                           border-left:2px solid ${c.border};
                           ${active ? "box-shadow:0 0 8px " + c.border + "99;" : ""}"
                    title="${name} t${seg.start}→t${seg.end}">
                 ${parseFloat(w) > 4 ? seg.start + "-" + visEnd : ""}
               </div>`;
    });
    html += `</div></div>`;
  });
  safeHTML("ganttContainer", html);
  safeText("ganttSchedLabel", lastResult.scheduler);
}

function renderGanttFull(gantt, totalTicks) { renderGanttUpTo(totalTicks); }

// ═════════════════════════════════════════════════════════════════════════════
//  MEMORY ANIMATION
// ═════════════════════════════════════════════════════════════════════════════
function buildMemEvents(data) {
  memEvents = [];
  if (!data.tick_log) return;
  const seen = new Map();
  data.tick_log.forEach(tick => {
    (tick.frames || []).forEach(f => {
      const cur  = f.pid != null ? `${f.pid}-${f.page}` : "free";
      const prev = seen.get(f.frame) || "free";
      if (cur !== prev) {
        const isLoad = (f.pid != null);
        const pName  = f.pid
          ? (lastResult?.processes?.find(p => p.pid === f.pid)?.name || ("P" + f.pid))
          : "";
        const policyEl = $("pagePolicySel");
        const policy   = policyEl ? policyEl.value : "lru";
        memEvents.push({
          frame: f.frame, pid: f.pid, page: f.page, tick: tick.tick,
          fault: isLoad,
          commentary: isLoad
            ? `⚡ PAGE FAULT — t=${tick.tick}: Process "${pName}" tried to access Page ${f.page}, but it wasn't in RAM.\n→ OS paused "${pName}", fetched Page ${f.page} from disk, and loaded it into Frame ${f.frame}.\n→ This is a PAGE FAULT. Total faults so far keeps increasing.`
            : `🔄 t=${tick.tick}: Frame ${f.frame} was EVICTED — the OS needed space and removed this page using the ${policy.toUpperCase()} replacement policy.`,
        });
        seen.set(f.frame, cur);
      }
    });
  });
}

function renderMemStep(idx) {
  if (!memEvents.length) { renderMemFinal(); return; }
  idx = Math.max(0, Math.min(memEvents.length - 1, idx));
  memIdx = idx;

  const totalFrames = lastResult.frames.length;
  memState = Array(totalFrames).fill(null);
  let faultCount = 0;
  for (let i = 0; i <= idx; i++) {
    const ev = memEvents[i];
    memState[ev.frame] = ev.pid != null ? { pid: ev.pid, page: ev.page, tick: ev.tick } : null;
    if (ev.fault) faultCount++;
  }

  const ev   = memEvents[idx];
  const used = memState.filter(s => s !== null).length;

  safeText("memFaultCount", faultCount);
  safeText("memHitCount",   lastResult.metrics.page_hits);
  safeText("memUsedCount",  used);
  safeText("memStepLabel",  `${idx + 1} / ${memEvents.length}`);

  const policyEl = $("pagePolicySel");
  safeText("memPolicyChip",
    (policyEl ? policyEl.value.toUpperCase() : "LRU") + " · " + totalFrames + " frames");

  safeText("memCommentaryText", (ev.commentary || "").replace(/\n/g, " "));

  // Render grid
  const grid   = $("memGrid");
  const legend = $("memLegend");
  if (!grid) return;

  const pidSet = new Set(memState.filter(s => s).map(s => s.pid));
  grid.innerHTML = memState.map((s, i) => {
    const isNew   = (ev && i === ev.frame && ev.pid !== null);
    if (s !== null) {
      const c = pc(s.pid);
      return `<div class="mem-frame${isNew ? " mem-frame-new" : ""}"
                   style="background:${c.bg};color:${c.fg};
                          border:${isNew ? "2px solid " + c.fg : "1px solid " + c.border};
                          transform:${isNew ? "scale(1.08)" : "scale(1)"};
                          transition:all .35s ease;"
                   title="Frame ${i} | PID ${s.pid} | Page ${s.page} | loaded at t=${s.tick}">
                P${s.pid}·${s.page}
              </div>`;
    }
    return `<div class="mem-frame frame-free"
                 style="transition:all .35s ease;"
                 title="Frame ${i} — FREE">FREE</div>`;
  }).join("");

  if (legend) {
    legend.innerHTML = [...pidSet].map(pid => {
      const c = pc(pid);
      const p = lastResult.processes.find(x => x.pid === pid);
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:11px;color:${c.fg}">
                <span style="width:10px;height:10px;border-radius:2px;background:${c.bg};border:1px solid ${c.border}"></span>
                ${p ? p.name : "P" + pid}
              </span>`;
    }).join("") +
    `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#4b5563">
       <span style="width:10px;height:10px;border-radius:2px;background:var(--bg);border:1px solid var(--border)"></span>
       Free
     </span>`;
  }
}

function renderMemFinal() {
  if (!lastResult) return;
  const frames      = lastResult.frames;
  const totalFrames = frames.length;
  const grid        = $("memGrid");
  const legend      = $("memLegend");
  const pidSet      = new Set(frames.filter(f => f.pid !== null).map(f => f.pid));
  const used        = frames.filter(f => f.pid !== null).length;

  safeText("memUsedCount",  used);
  safeText("memFaultCount", lastResult.metrics.page_faults);
  safeText("memHitCount",   lastResult.metrics.page_hits);
  safeText("memStepLabel",  "final state");
  safeText("memCommentaryText",
    `✅ Simulation complete. ${used}/${totalFrames} frames occupied. ` +
    `Total page faults: ${lastResult.metrics.page_faults}, ` +
    `hit rate: ${lastResult.metrics.hit_rate}%.`);

  const policyEl = $("pagePolicySel");
  safeText("memPolicyChip",
    (policyEl ? policyEl.value.toUpperCase() : "LRU") + " · " + totalFrames + " frames");

  if (grid) {
    grid.innerHTML = frames.map((f, i) => {
      if (f.pid !== null) {
        const c = pc(f.pid);
        return `<div class="mem-frame" style="background:${c.bg};color:${c.fg};border:1px solid ${c.border}"
                     title="Frame ${i}|PID ${f.pid}|Page ${f.page}">P${f.pid}·${f.page}</div>`;
      }
      return `<div class="mem-frame frame-free">FREE</div>`;
    }).join("");
  }

  if (legend) {
    legend.innerHTML = [...pidSet].map(pid => {
      const c = pc(pid);
      const p = lastResult.processes.find(x => x.pid === pid);
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:11px;color:${c.fg}">
                <span style="width:10px;height:10px;border-radius:2px;background:${c.bg};border:1px solid ${c.border}"></span>
                ${p ? p.name : "P" + pid}</span>`;
    }).join("") +
    `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#4b5563">
       <span style="width:10px;height:10px;border-radius:2px;background:var(--bg);border:1px solid var(--border)"></span>Free</span>`;
  }
}

function stepMem(d)      { renderMemStep(memIdx + d); }
function startMemAnim()  {
  memPlaying = true;
  safeText("memPlayBtn", "⏸ Pause");
  memTimer = setInterval(() => {
    if (memIdx >= memEvents.length - 1) { stopMemAnim(); renderMemFinal(); return; }
    renderMemStep(memIdx + 1);
  }, ANIM_DELAY);
}
function stopMemAnim()   {
  clearInterval(memTimer); memTimer = null; memPlaying = false;
  safeText("memPlayBtn", "▶ Play");
}
function toggleMemAnim() { if (memPlaying) stopMemAnim(); else startMemAnim(); }

// ═════════════════════════════════════════════════════════════════════════════
//  STATS
// ═════════════════════════════════════════════════════════════════════════════
function renderStats(m) {
  const cpu = Math.min(parseFloat(m.cpu_utilization), 100);
  safeText("statCPU",    cpu.toFixed(1) + "%");
  safeText("statWT",     m.avg_waiting + "t");
  safeText("statTAT",    m.avg_turnaround + "t");
  safeText("statPF",     m.page_faults);
  safeText("statTP",     m.throughput + "/t");
  safeStyle("cpuBar",    "width", cpu + "%");
  safeText("statWTsub",  "ticks waiting");
  safeText("statTATsub", "finish − arrival");
  safeText("statPFsub",  "hits: " + m.page_hits + " (" + m.hit_rate + "%)");
  safeText("statTPsub",  "proc / tick");
}

// ═════════════════════════════════════════════════════════════════════════════
//  PROCESS TABLE
// ═════════════════════════════════════════════════════════════════════════════
function renderProcessTable(processes, activePid = null) {
  if (!processes) return;
  safeText("procCount", processes.length + " processes");
  const dot = {
    running:    "dot-running",
    ready:      "dot-ready",
    waiting:    "dot-waiting",
    terminated: "dot-terminated",
    new:        "dot-new",
  };
  safeHTML("processTableBody", processes.map(p => {
    const c  = pc(p.pid);
    const hl = p.pid === activePid
      ? `box-shadow:inset 3px 0 0 ${c.border};background:${c.bg}22;` : "";
    return `<tr style="${hl}transition:background .3s">
      <td><span style="background:${c.bg};color:${c.fg};padding:1px 7px;border-radius:3px;font-size:11px">${p.pid}</span></td>
      <td style="font-weight:500">${p.name}</td>
      <td><span class="state-cell"><span class="dot ${dot[p.state] || "dot-terminated"}"></span>${p.state}</span></td>
      <td>${p.priority}</td><td>${p.burst_time}</td><td>${p.remaining_time}</td>
      <td>${p.arrival_time}</td><td>${p.finish_time ?? "—"}</td>
      <td>${p.waiting_time}</td><td>${p.turnaround_time}</td>
    </tr>`;
  }).join(""));
}

// ═════════════════════════════════════════════════════════════════════════════
//  METRICS
// ═════════════════════════════════════════════════════════════════════════════
function renderMetrics(data) {
  const m   = data.metrics;
  const cpu = Math.min(parseFloat(m.cpu_utilization), 100);

  safeHTML("metricsContent", `
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Scheduler</td><td style="color:var(--accent-lt)">${data.scheduler}</td></tr>
        <tr><td>Avg Turnaround</td><td style="color:var(--accent-lt)">${m.avg_turnaround}t</td></tr>
        <tr><td>Avg Waiting</td><td style="color:var(--accent-lt)">${m.avg_waiting}t</td></tr>
        <tr><td>CPU Utilization</td><td style="color:var(--green)">${cpu.toFixed(1)}%</td></tr>
        <tr><td>Page Faults</td><td style="color:var(--amber)">${m.page_faults}</td></tr>
        <tr><td>Page Hits</td><td style="color:var(--green)">${m.page_hits}</td></tr>
        <tr><td>Hit Rate</td><td style="color:var(--green)">${m.hit_rate}%</td></tr>
        <tr><td>Throughput</td><td style="color:var(--blue)">${m.throughput}/tick</td></tr>
        <tr><td>Total Ticks</td><td>${m.total_ticks}</td></tr>
      </tbody>
    </table>`);

  const mcCtx = $("metricsChart");
  if (mcCtx) {
    if (charts.metricsChart) { charts.metricsChart.destroy(); delete charts.metricsChart; }
    charts.metricsChart = new Chart(mcCtx.getContext("2d"), {
      type: "bar",
      data: {
        labels:   data.processes.map(p => p.name),
        datasets: [
          { label: "Turnaround", data: data.processes.map(p => p.turnaround_time), backgroundColor: "#4c1d95", borderRadius: 4 },
          { label: "Waiting",    data: data.processes.map(p => p.waiting_time),    backgroundColor: "#0F6E56", borderRadius: 4 },
        ],
      },
      options: chartOpts(),
    });
  }

  const bcCtx = $("burstChart");
  if (bcCtx) {
    if (charts.burstChart) { charts.burstChart.destroy(); delete charts.burstChart; }
    charts.burstChart = new Chart(bcCtx.getContext("2d"), {
      type: "bar",
      data: {
        labels:   data.processes.map(p => p.name),
        datasets: [
          { label: "CPU Burst", data: data.processes.map(p => p.burst_time),    backgroundColor: "#185FA5", borderRadius: 4 },
          { label: "Waiting",   data: data.processes.map(p => p.waiting_time),  backgroundColor: "#854F0B", borderRadius: 4 },
        ],
      },
      options: chartOpts(),
    });
  }
}

function renderTimeline(data) {
  if (!data.processes.length) return;
  const ctx = $("timelineChart");
  if (!ctx) return;
  if (charts.timelineChart) { charts.timelineChart.destroy(); delete charts.timelineChart; }
  charts.timelineChart = new Chart(ctx.getContext("2d"), {
    type: "bar",
    data: {
      labels:   data.processes.map(p => p.name),
      datasets: [
        { label: "Arrival", data: data.processes.map(p => p.arrival_time), backgroundColor: "transparent" },
        { label: "Waiting", data: data.processes.map(p => p.waiting_time), backgroundColor: "#854F0B", borderRadius: 2 },
        { label: "Burst",   data: data.processes.map(p => p.burst_time),   backgroundColor: "#185FA5", borderRadius: 2 },
      ],
    },
    options: {
      ...chartOpts(),
      indexAxis: "y",
      scales: {
        x: { stacked: true, ticks: { color: "#6b7280" }, grid: { color: "#1e2235" } },
        y: { stacked: true, ticks: { color: "#6b7280" }, grid: { color: "#1e2235" } },
      },
    },
  });
}

function chartOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "#94a3b8", font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: "#6b7280" }, grid: { color: "#1e2235" } },
      y: { ticks: { color: "#6b7280" }, grid: { color: "#1e2235" } },
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  SYNC DEMOS
// ═════════════════════════════════════════════════════════════════════════════
async function runMutexDemo() {
  const log = $("mutexLog");
  if (!log) return;
  log.innerHTML = `<span class="muted">Running…</span>`;
  try {
    const res  = await fetch("/api/sync/mutex_demo", { method: "POST" });
    const data = await res.json();
    log.innerHTML = "";
    (data.log || []).forEach((e, i) => {
      setTimeout(() => {
        const cls = e.action === "acquire" && e.success  ? "log-acquired"
                  : e.action === "acquire" && !e.success ? "log-blocked"
                  : e.action === "release"               ? "log-released"
                  : "log-transferred";
        const q   = e.queue && e.queue.length ? `  queue:[${e.queue}]` : "";
        const div = document.createElement("div");
        div.className = cls;
        div.textContent = e.message + q;
        div.style.cssText = "opacity:0;transform:translateX(-8px);transition:all .3s ease";
        log.appendChild(div);
        requestAnimationFrame(() => { div.style.opacity = "1"; div.style.transform = "translateX(0)"; });
      }, i * 700);
    });
  } catch (e) {
    log.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
  }
}

async function runPCDemo() {
  const log = $("pcLog");
  if (!log) return;
  log.innerHTML = `<span class="muted">Running…</span>`;
  try {
    const res  = await fetch("/api/sync/producer_consumer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buffer_size: 3, producers: 3, consumers: 3 }),
    });
    const data = await res.json();
    log.innerHTML = "";
    (data.log || []).forEach((e, i) => {
      setTimeout(() => {
        const cls = e.role === "producer" ? "log-producer" : "log-consumer";
        const buf = e.buffer.length ? `[${e.buffer.join(", ")}]` : "[]";
        const div = document.createElement("div");
        div.className = cls;
        div.textContent = `[PID ${e.pid}] ${e.action} → buffer:${buf}  empty:${e.empty}  full:${e.full}`;
        div.style.cssText = "opacity:0;transform:translateX(-8px);transition:all .3s ease";
        log.appendChild(div);
        requestAnimationFrame(() => { div.style.opacity = "1"; div.style.transform = "translateX(0)"; });
        if (i === data.log.length - 1) {
          safeHTML("semTableBody", [
            { name: "empty", count: e.empty, initial: 3, queue: [] },
            { name: "full",  count: e.full,  initial: 0, queue: [] },
          ].map(s =>
            `<tr><td>${s.name}</td><td style="color:var(--accent-lt)">${s.count}</td>
                 <td>${s.initial}</td><td>${s.queue.length ? s.queue.join(", ") : "empty"}</td></tr>`
          ).join(""));
        }
      }, i * 600);
    });
  } catch (e) {
    log.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  ADDRESS TRANSLATION
// ═════════════════════════════════════════════════════════════════════════════
function translateAddr() {
  const pid    = parseInt(($("addrPID")  || {}).value) || 1;
  const page   = parseInt(($("addrPage") || {}).value) || 0;
  const offset = parseInt(($("addrOff")  || {}).value) || 0;
  const el     = $("addrResult");
  if (!el) return;
  if (!lastResult) {
    el.innerHTML = `<span class="muted">Run a simulation first</span>`;
    return;
  }
  const frame = lastResult.frames.find(f => f.pid === pid && f.page === page);
  if (frame) {
    const phys = frame.frame * 4 + offset;
    el.innerHTML =
      `<span style="color:var(--muted)">Virtual → </span>
       <span style="color:var(--accent-lt)">PID ${pid} | Page ${page} | Offset ${offset}</span>
       <span style="color:var(--muted)">  ──►  Physical → </span>
       <span style="color:var(--green)">Frame ${frame.frame} | Address ${phys} KB</span>`;
  } else {
    el.innerHTML =
      `<span style="color:var(--amber)">⚠ Page ${page} of PID ${pid} not in RAM — page fault would occur</span>`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMPARE
// ═════════════════════════════════════════════════════════════════════════════
async function runComparison() {
  const btn = $("cmpBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Running…"; }

  const workloadSel   = $("workloadSel");
  const pagePolicySel = $("pagePolicySel");
  const quantumInput  = $("quantumInput");
  const framesInput   = $("framesInput");

  const payload = {
    workload:    workloadSel   ? workloadSel.value   : "mixed",
    page_policy: pagePolicySel ? pagePolicySel.value : "lru",
    quantum:     parseInt(quantumInput ? quantumInput.value : "2")  || 2,
    frames:      parseInt(framesInput  ? framesInput.value  : "16") || 16,
  };

  try {
    const res  = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    safeHTML("compareTable", `<div class="table-wrap"><table>
      <thead><tr><th>Scheduler</th><th>Avg WT</th><th>Avg TAT</th><th>CPU %</th><th>Page Faults</th><th>Throughput</th></tr></thead>
      <tbody>${(data.results || []).map(r => `<tr>
        <td style="color:var(--accent-lt);font-weight:500">${r.scheduler}</td>
        <td>${r.metrics.avg_waiting}t</td><td>${r.metrics.avg_turnaround}t</td>
        <td style="color:var(--green)">${Math.min(parseFloat(r.metrics.cpu_utilization), 100).toFixed(1)}%</td>
        <td style="color:var(--amber)">${r.metrics.page_faults}</td><td>${r.metrics.throughput}</td>
      </tr>`).join("")}</tbody></table></div>`);

    const ctx = $("compareChart");
    if (ctx) {
      if (charts.compareChart) { charts.compareChart.destroy(); delete charts.compareChart; }
      charts.compareChart = new Chart(ctx.getContext("2d"), {
        type: "bar",
        data: {
          labels: (data.results || []).map(r => r.scheduler),
          datasets: [
            { label: "Avg Waiting",    data: (data.results || []).map(r => r.metrics.avg_waiting),    backgroundColor: "#4c1d95", borderRadius: 4 },
            { label: "Avg Turnaround", data: (data.results || []).map(r => r.metrics.avg_turnaround), backgroundColor: "#0F6E56", borderRadius: 4 },
            { label: "CPU Util %",     data: (data.results || []).map(r => Math.min(parseFloat(r.metrics.cpu_utilization), 100)), backgroundColor: "#185FA5", borderRadius: 4 },
          ],
        },
        options: chartOpts(),
      });
    }
  } catch (e) {
    safeHTML("compareTable", `<p style="color:var(--red);padding:20px">${e.message}</p>`);
  }
  if (btn) { btn.disabled = false; btn.textContent = "▶ Run All Schedulers"; }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PAGE REPLACEMENT TRACE
// ═════════════════════════════════════════════════════════════════════════════
async function runMemTrace() {
  const framesEl = $("traceFrames");
  const policyEl = $("tracePolicy");
  const refsEl   = $("traceRefs");

  const frames = parseInt(framesEl ? framesEl.value : "4") || 4;
  const policy = policyEl ? policyEl.value : "lru";
  const refs   = (refsEl ? refsEl.value : "")
    .split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));

  const container = $("memTraceResult");
  if (!container) return;

  try {
    const res  = await fetch("/api/memory/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames, policy, page_refs: refs }),
    });
    const data = await res.json();

    let html = `<div style="overflow-x:auto"><table class="trace-table">
      <thead><tr><th>Step</th><th>Ref</th><th>Result</th>
      ${Array.from({ length: frames }, (_, i) => `<th>F${i}</th>`).join("")}</tr></thead><tbody>`;

    (data.trace || []).forEach((row, i) => {
      html += `<tr class="trace-row" data-idx="${i}" style="opacity:0;transform:translateY(6px);transition:all .2s ease">
        <td>${i + 1}</td><td style="font-weight:500;color:var(--text)">${row.page}</td>
        <td class="${row.fault ? "trace-fault" : "trace-hit"}">${row.fault ? "FAULT ⚡" : "HIT ✓"}</td>`;
      for (let f = 0; f < frames; f++) {
        const pg = row.frames[f];
        if (pg != null) {
          const c = pc(pg + 1);
          html += `<td><span style="display:inline-block;width:26px;height:20px;line-height:20px;text-align:center;border-radius:3px;font-size:10px;background:${c.bg};color:${c.fg}">${pg}</span></td>`;
        } else {
          html += `<td><span style="display:inline-block;width:26px;height:20px;line-height:20px;text-align:center;border-radius:3px;font-size:10px;background:var(--bg);color:var(--muted2)">—</span></td>`;
        }
      }
      html += `</tr>`;
    });

    html += `</tbody></table></div>
      <div style="margin-top:10px;font-size:12px;color:var(--muted)">
        Faults:<span style="color:var(--amber);margin-left:4px">${data.page_faults}</span>
        &nbsp;|&nbsp; Hit rate:<span style="color:var(--green);margin-left:4px">${data.hit_rate}%</span>
        &nbsp;|&nbsp; Policy:<span style="color:var(--accent-lt);margin-left:4px">${policy.toUpperCase()}</span>
      </div>`;

    container.innerHTML = html;
    container.querySelectorAll(".trace-row").forEach((row, i) => {
      setTimeout(() => { row.style.opacity = "1"; row.style.transform = "translateY(0)"; }, i * 80);
    });
  } catch (e) {
    container.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TICK-BY-TICK VIEWER
// ═════════════════════════════════════════════════════════════════════════════
function tickStep(d) {
  if (!lastResult?.tick_log) return;
  tickIndex = Math.max(0, Math.min(lastResult.tick_log.length - 1, tickIndex + d));
  const slider = $("tickSlider");
  if (slider) slider.value = tickIndex;
  renderTickDetail(tickIndex);
}

function goToTick(val) { tickIndex = parseInt(val); renderTickDetail(tickIndex); }

function renderTickDetail(idx) {
  if (!lastResult?.tick_log) return;
  const log = lastResult.tick_log[idx];
  if (!log) return;

  safeText("tickDisplay", `t = ${log.tick}`);

  const running = log.running_pid
    ? `<span style="background:${pc(log.running_pid).bg};color:${pc(log.running_pid).fg};padding:2px 10px;border-radius:4px;font-weight:500">${log.running_name}</span>`
    : `<span style="color:var(--muted);font-style:italic">idle</span>`;

  const rq = (log.ready_queue || []).length
    ? (log.ready_queue || []).map(pid => {
        const p = lastResult.processes.find(x => x.pid === pid);
        return pill(pid, p ? p.name : "P" + pid);
      }).join(" ")
    : `<span class="muted">empty</span>`;

  const ioq = (log.io_queue || []).length
    ? (log.io_queue || []).map(([pid, ft]) => `PID ${pid}→t=${ft}`).join(", ")
    : `<span class="muted">none</span>`;

  const occ    = (log.frames || []).filter(f => f.pid !== null).length;
  const events = (log.events || []).length
    ? (log.events || []).map(e => `<div class="tick-event">▸ ${e}</div>`).join("")
    : `<div class="muted" style="font-size:11px">no events this tick</div>`;

  safeHTML("tickDetail", `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">RUNNING</div>${running}</div>
      <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">READY QUEUE</div>${rq}</div>
      <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">I/O QUEUE</div><span style="font-size:11px;color:var(--amber)">${ioq}</span></div>
      <div><div style="font-size:10px;color:var(--muted);margin-bottom:4px">MEMORY</div>
           <span style="font-size:11px">
             <span style="color:var(--green)">${occ} used</span> /
             <span style="color:var(--muted)">${(log.frames || []).length - occ} free</span>
           </span></div>
    </div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:6px">EVENTS</div>${events}
    <div style="margin-top:10px">
      <div style="font-size:10px;color:var(--muted);margin-bottom:6px">FRAME SNAPSHOT</div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:3px">
        ${(log.frames || []).map(f => {
          if (f.pid !== null) {
            const c = pc(f.pid);
            return `<div style="height:26px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:500;background:${c.bg};color:${c.fg};border:1px solid ${c.border}" title="Frame ${f.frame}: PID ${f.pid} Pg ${f.page}">P${f.pid}·${f.page}</div>`;
          }
          return `<div style="height:26px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;background:var(--bg);color:var(--muted2);border:1px solid var(--border)" title="Frame ${f.frame}: FREE">FREE</div>`;
        }).join("")}
      </div>
    </div>`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  onSchedulerChange();
  showPanel("process");
});