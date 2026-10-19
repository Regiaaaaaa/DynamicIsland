import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Music2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { useVolume } from "../hooks/useVolume";

const ISLAND = {
  compact: { width: 140, height: 36, radius: 18 },
  hover: { width: 280, height: 48, radius: 24 },
  expanded: { width: 400, height: 210, radius: 36 },
};
const WINDOW = {
  compact: { w: 180, h: 52 },
  hover: { w: 320, h: 64 },
  expanded: { w: 420, h: 230 },
};
const RANK = { compact: 0, hover: 1, expanded: 2 };
const TOP_MARGIN = 8;
const SPRING = { type: "spring", stiffness: 320, damping: 28, mass: 0.9 };
const DEFAULT_ACCENT = [52, 211, 153];

async function fitWindow(mode) {
  try {
    const { w, h } = WINDOW[mode];
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(w, h));
    const m = await currentMonitor();
    if (!m) return;
    const s = m.scaleFactor;
    const x = Math.round(m.position.x + (m.size.width - w * s) / 2);
    const y = Math.round(m.position.y + TOP_MARGIN * s);
    await win.setPosition(new PhysicalPosition(x, y));
  } catch {
    // di browser biasa: abaikan
  }
}

const fmt = (sec) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/* ---------- Warna aksen dari album art ---------- */
function useAccent(src) {
  const [color, setColor] = useState(null);
  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const S = 24;
        const cv = document.createElement("canvas");
        cv.width = cv.height = S;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const max = Math.max(R, G, B);
          const min = Math.min(R, G, B);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (max + min) / 510;
          if (lum < 0.15 || lum > 0.92) continue; // abaikan hampir hitam/putih
          const wt = sat * sat + 0.05; // utamakan warna yang kuat
          r += R * wt; g += G * wt; b += B * wt; w += wt;
        }
        if (!w) return setColor(null);
        r /= w; g /= w; b /= w;
        const m = Math.max(r, g, b);
        const k = m < 170 ? 170 / m : 1; // pastikan cukup terang di latar hitam
        setColor([r, g, b].map((v) => Math.min(255, Math.round(v * k))));
      } catch {
        setColor(null);
      }
    };
    img.onerror = () => setColor(null);
    img.src = src;
  }, [src]);
  return color;
}

/* ---------- Teks berjalan kalau kepanjangan ---------- */
function Marquee({ text, className = "" }) {
  const wrap = useRef(null);
  const inner = useRef(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (!wrap.current || !inner.current) return;
      const o = inner.current.scrollWidth - wrap.current.clientWidth;
      setOverflow(o > 2 ? Math.ceil(o) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current);
    ro.observe(inner.current);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div ref={wrap} className={`overflow-hidden whitespace-nowrap ${className}`}>
      <span
        ref={inner}
        className={`inline-block ${overflow ? "marquee-run" : ""}`}
        style={
          overflow
            ? {
                "--marquee-dist": `-${overflow}px`,
                "--marquee-dur": `${4 + overflow / 25}s`,
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}

/* ---------- Equalizer (simulasi lebih natural) ---------- */
function Equalizer({ active, color }) {
  const [v, setV] = useState([0.25, 0.25, 0.25, 0.25]);
  useEffect(() => {
    if (!active) {
      setV([0.25, 0.25, 0.25, 0.25]);
      return;
    }
    const id = setInterval(
      () => setV((p) => p.map((x) => x * 0.4 + (0.2 + Math.random() * 0.8) * 0.6)),
      130
    );
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="flex h-4 items-end gap-[3px]">
      {v.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            height: `${h * 100}%`,
            backgroundColor: color,
            transition: "height 130ms ease-out, background-color 400ms",
          }}
        />
      ))}
    </div>
  );
}

function AlbumArt({ size = 40, src }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-700"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <Music2 size={size * 0.45} className="text-white/90" />
      )}
    </div>
  );
}

const EMPTY = {
  hasSession: false,
  title: "",
  artist: "",
  isPlaying: false,
  position: 0,
  duration: 0,
  albumArt: null,
};

export default function DynamicIsland({
  media = EMPTY,
  onPlayPause = () => {},
  onNext = () => {},
  onPrev = () => {},
}) {
  const [mode, setMode] = useState("compact");
  const prevRank = useRef(0);
  const shrinkTimer = useRef(null);
  const leaveTimer = useRef(null);

  const vol = useVolume(mode === "expanded");

  // Seek
  const barRef = useRef(null);
  const [dragPos, setDragPos] = useState(null);
  const seekHold = useRef({ v: 0, until: 0 });

  const accentRgb = useAccent(media.albumArt) || DEFAULT_ACCENT;
  const accent = `rgb(${accentRgb.join(",")})`;
  const glow = `radial-gradient(120% 90% at 0% 0%, rgba(${accentRgb.join(",")},0.30), transparent 65%)`;

  const isPlaying = media.isPlaying;
  const title = media.title || "Tidak ada media";
  const artist = media.hasSession ? media.artist : "Putar lagu di Spotify / browser";
  const volPct = vol.muted ? 0 : vol.level * 100;

  const holding = Date.now() < seekHold.current.until;
  const displayPos =
    dragPos !== null ? dragPos : holding ? seekHold.current.v : media.position;
  const progress =
    media.duration > 0 ? Math.min(100, (displayPos / media.duration) * 100) : 0;

  const ratioFromEvent = (e) => {
    const r = barRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const onSeekDown = (e) => {
    if (media.duration <= 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragPos(ratioFromEvent(e) * media.duration);
  };
  const onSeekMove = (e) => {
    if (dragPos === null) return;
    setDragPos(ratioFromEvent(e) * media.duration);
  };
  const onSeekUp = (e) => {
    if (dragPos === null) return;
    e.stopPropagation();
    const target = ratioFromEvent(e) * media.duration;
    seekHold.current = { v: target, until: Date.now() + 1500 };
    setDragPos(null);
    invoke("media_seek", { seconds: target }).catch(console.error);
  };

  useEffect(() => {
    clearTimeout(shrinkTimer.current);
    const growing = RANK[mode] > prevRank.current;
    prevRank.current = RANK[mode];

    if (growing) {
      fitWindow(mode);
    } else {
      shrinkTimer.current = setTimeout(() => fitWindow(mode), 380);
    }
    return () => clearTimeout(shrinkTimer.current);
  }, [mode]);

  const handleEnter = () => {
    clearTimeout(leaveTimer.current);
    setMode((m) => (m === "compact" ? "hover" : m));
  };

  const handleLeave = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setMode("compact"), 500);
  };

  const handleClick = () => {
    setMode((m) => (m === "expanded" ? "hover" : "expanded"));
  };

  const island = ISLAND[mode];

  return (
    <div
      className="flex h-full w-full items-start justify-center"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Tanpa box-shadow: shadow terpotong batas window = kotak abu samar */}
      <motion.div
        onClick={handleClick}
        initial={false}
        animate={{
          width: island.width,
          height: island.height,
          borderRadius: island.radius,
        }}
        transition={SPRING}
        className="relative cursor-pointer overflow-hidden bg-black text-white ring-1 ring-white/10"
      >
        {/* Glow warna dari album art */}
        <motion.div
          key={accent}
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: glow }}
          initial={{ opacity: 0 }}
          animate={{ opacity: mode === "expanded" ? 1 : mode === "hover" ? 0.6 : 0 }}
          transition={{ duration: 0.6 }}
        />

        <AnimatePresence mode="popLayout" initial={false}>
          {/* COMPACT */}
          {mode === "compact" && (
            <motion.div
              key="compact"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 flex h-[36px] w-[140px] items-center justify-between px-3"
            >
              <span
                className="h-2 w-2 rounded-full transition-colors"
                style={{ backgroundColor: isPlaying ? accent : "#525252" }}
              />
              <Equalizer active={isPlaying} color={accent} />
            </motion.div>
          )}

          {/* HOVER */}
          {mode === "hover" && (
            <motion.div
              key="hover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 flex h-[48px] w-[280px] items-center gap-3 px-3"
            >
              <AlbumArt size={32} src={media.albumArt} />
              <div className="min-w-0 flex-1 leading-tight">
                <Marquee text={title} className="text-[13px] font-semibold" />
                <Marquee text={artist} className="text-[11px] text-neutral-400" />
              </div>
              <Equalizer active={isPlaying} color={accent} />
            </motion.div>
          )}

          {/* EXPANDED */}
          {mode === "expanded" && (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, delay: 0.08 }}
              className="relative z-10 flex h-[210px] w-[400px] flex-col justify-between p-5"
            >
              <div className="flex items-center gap-4">
                <AlbumArt size={64} src={media.albumArt} />
                <div className="min-w-0 flex-1">
                  <Marquee text={title} className="text-base font-semibold" />
                  <Marquee text={artist} className="text-sm text-neutral-400" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Equalizer active={isPlaying} color={accent} />
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    {!media.hasSession ? "Idle" : isPlaying ? "Playing" : "Paused"}
                  </span>
                </div>
              </div>

              {/* Progress bar (bisa diklik / digeser) */}
              <div>
                <div
                  ref={barRef}
                  className="flex h-4 cursor-pointer touch-none items-center"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={onSeekDown}
                  onPointerMove={onSeekMove}
                  onPointerUp={onSeekUp}
                >
                  <div className="relative h-1 w-full rounded-full bg-white/15">
                    <div
                      className={`h-full rounded-full ${
                        dragPos === null ? "transition-[width] duration-500 ease-linear" : ""
                      }`}
                      style={{ width: `${progress}%`, backgroundColor: accent }}
                    />
                    <div
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ left: `${progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-[10px] text-neutral-400">
                  <span>{fmt(displayPos)}</span>
                  <span>{fmt(media.duration)}</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-6">
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrev();
                  }}
                  className="text-neutral-300 hover:text-white"
                >
                  <SkipBack size={22} fill="currentColor" />
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayPause();
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black"
                >
                  {isPlaying ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill="currentColor" className="ml-0.5" />
                  )}
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNext();
                  }}
                  className="text-neutral-300 hover:text-white"
                >
                  <SkipForward size={22} fill="currentColor" />
                </motion.button>
              </div>

              {/* Volume */}
              <div
                className="flex items-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={vol.toggleMute}
                  className="text-neutral-300 hover:text-white"
                >
                  {vol.muted || vol.level === 0 ? (
                    <VolumeX size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </button>
                <input
                  type="range"  
                  min={0}
                  max={100}
                  value={Math.round(volPct)}
                  onPointerDown={vol.startDrag}
                  onPointerUp={vol.endDrag}
                  onChange={(e) => vol.change(Number(e.target.value) / 100)}
                  className="volume-slider h-1 w-full cursor-pointer appearance-none rounded-full"
                  style={{
                    background: `linear-gradient(to right, #fff ${volPct}%, rgba(255,255,255,0.15) ${volPct}%)`,
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}