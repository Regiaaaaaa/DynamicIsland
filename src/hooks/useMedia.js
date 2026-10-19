import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

const EMPTY = {
  hasSession: false,
  title: "",
  artist: "",
  album: "",
  isPlaying: false,
  position: 0,
  duration: 0,
};

export function useMedia() {
  const [info, setInfo] = useState(EMPTY);
  const [albumArt, setAlbumArt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let unsubs = [];

    (async () => {
      try {
        const a = await listen("media-update", (e) => setInfo(e.payload));
        const b = await listen("media-art", (e) => setAlbumArt(e.payload));
        if (cancelled) {
          a();
          b();
          return;
        }
        unsubs = [a, b];
        // Ambil art yang sudah ada sebelum listener aktif
        const art = await invoke("get_media_art");
        if (!cancelled && art) setAlbumArt(art);
      } catch (err) {
        console.warn("Bukan di Tauri / gagal listen:", err);
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((f) => f());
    };
  }, []);

  const control = useCallback(
    (action) => invoke("media_control", { action }).catch(console.error),
    []
  );

  return { media: { ...info, albumArt }, control };
}