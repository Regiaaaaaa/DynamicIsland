import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useVolume(active) {
  const [level, setLevel] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const dragging = useRef(false);

  // Sinkron dari Windows, hanya saat panel mekar
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      if (dragging.current) return;
      try {
        const v = await invoke("get_volume");
        if (!stop && v && !dragging.current) {
          setLevel(v.level);
          setMuted(v.muted);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [active]);

  const change = useCallback((v) => {
    setLevel(v);
    invoke("set_volume", { level: v }).catch(() => {});
    if (v > 0) {
      setMuted((m) => {
        if (m) invoke("set_mute", { muted: false }).catch(() => {});
        return false;
      });
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      invoke("set_mute", { muted: !m }).catch(() => {});
      return !m;
    });
  }, []);

  const startDrag = () => (dragging.current = true);
  const endDrag = () => (dragging.current = false);

  return { level, muted, change, toggleMute, startDrag, endDrag };
}