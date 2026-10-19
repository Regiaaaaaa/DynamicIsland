use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::{
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SmtcManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProps,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    },
    Storage::Streams::DataReader,
};

#[derive(Default)]
pub struct ArtCache(Mutex<Option<String>>);

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    has_session: bool,
    title: String,
    artist: String,
    album: String,
    is_playing: bool,
    position: f64,
    duration: f64,
}

const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

fn ticks_to_secs(t: i64) -> f64 {
    t as f64 / 10_000_000.0
}

fn read_state(session: &Session) -> windows::core::Result<(MediaInfo, MediaProps)> {
    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let is_playing = session.GetPlaybackInfo()?.PlaybackStatus()? == PlaybackStatus::Playing;

    let tl = session.GetTimelineProperties()?;
    let start = tl.StartTime()?.Duration;
    let end = tl.EndTime()?.Duration;
    let duration = ticks_to_secs((end - start).max(0));

    let mut pos = tl.Position()?.Duration;
    if is_playing {
        let last = tl.LastUpdatedTime()?.UniversalTime;
        if last > 0 {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| (d.as_nanos() / 100) as i64)
                .unwrap_or(0)
                + EPOCH_DIFF_TICKS;
            pos += (now - last).max(0);
        }
    }
    let mut position = ticks_to_secs(pos).max(0.0);
    if duration > 0.0 {
        position = position.min(duration);
    }

    let info = MediaInfo {
        has_session: true,
        title: props.Title()?.to_string(),
        artist: props.Artist()?.to_string(),
        album: props.AlbumTitle()?.to_string(),
        is_playing,
        position,
        duration,
    };
    Ok((info, props))
}

fn read_art(props: &MediaProps) -> Option<String> {
    let stream_ref = props.Thumbnail().ok()?;
    let stream = stream_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }
    let mime = stream.ContentType().ok()?.to_string();
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some(format!("data:{};base64,{}", mime, STANDARD.encode(buf)))
}

fn set_art(app: &AppHandle, art: Option<String>) {
    *app.state::<ArtCache>().0.lock().unwrap() = art.clone();
    let _ = app.emit("media-art", art);
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let manager = loop {
            match SmtcManager::RequestAsync().and_then(|op| op.get()) {
                Ok(m) => {
                    println!("[media] SMTC manager OK");
                    break m;
                }
                Err(e) => {
                    println!("[media] RequestAsync gagal: {e:?}");
                    thread::sleep(Duration::from_secs(2));
                }
            }
        };

        let mut last_key = String::new();
        let mut last_art_hash: u64 = 0;
        let mut art_tries = 0u8;
        let mut last_err = String::new();

        loop {
            let session = manager.GetCurrentSession().ok();
            if session.is_none() && last_err != "no-session" {
                println!("[media] belum ada session aktif");
                last_err = "no-session".into();
            }

            let state = session.as_ref().and_then(|s| match read_state(s) {
                Ok(v) => Some(v),
                Err(e) => {
                    let msg = format!("{e:?}");
                    if msg != last_err {
                        println!("[media] read_state gagal: {msg}");
                        last_err = msg;
                    }
                    None
                }
            });

            match state {
                Some((info, props)) => {
                    last_err.clear();
                    let key = format!("{}|{}|{}", info.title, info.artist, info.album);
                    if key != last_key {
                        println!("[media] lagu: {} - {}", info.title, info.artist);
                        last_key = key;
                        art_tries = 0;
                        last_art_hash = 0;
                        set_art(&app, None);
                    }
                    // Terus cek art ±15 detik, update kalau gambarnya berubah
                    // (Chrome sering kasih ikon sementara dulu)
                    if art_tries < 30 {
                        art_tries += 1;
                        if let Some(a) = read_art(&props) {
                            let mut h = DefaultHasher::new();
                            a.hash(&mut h);
                            let h = h.finish();
                            if h != last_art_hash {
                                last_art_hash = h;
                                set_art(&app, Some(a));
                            }
                        }
                    }
                    let _ = app.emit("media-update", &info);
                }
                None => {
                    if !last_key.is_empty() {
                        last_key.clear();
                        last_art_hash = 0;
                        set_art(&app, None);
                    }
                    let _ = app.emit("media-update", MediaInfo::default());
                }
            }

            thread::sleep(Duration::from_millis(500));
        }
    });
}

/// action: "playpause" | "next" | "prev"
#[tauri::command]
pub fn media_control(action: String) {
    thread::spawn(move || {
        let res = (|| -> windows::core::Result<()> {
            let manager = SmtcManager::RequestAsync()?.get()?;
            let session = manager.GetCurrentSession()?;
            match action.as_str() {
                "playpause" => {
                    session.TryTogglePlayPauseAsync()?.get()?;
                }
                "next" => {
                    session.TrySkipNextAsync()?.get()?;
                }
                "prev" => {
                    session.TrySkipPreviousAsync()?.get()?;
                }
                _ => {}
            }
            Ok(())
        })();
        if let Err(e) = res {
            println!("[media] control gagal: {e:?}");
        }
    });
}

#[tauri::command]
pub fn get_media_art(cache: State<ArtCache>) -> Option<String> {
    cache.0.lock().unwrap().clone()
}
/// Geser posisi lagu (detik)
#[tauri::command]
pub fn media_seek(seconds: f64) {
    thread::spawn(move || {
        let res = (|| -> windows::core::Result<()> {
            let manager = SmtcManager::RequestAsync()?.get()?;
            let session = manager.GetCurrentSession()?;
            let ticks = (seconds.max(0.0) * 10_000_000.0) as i64;
            session.TryChangePlaybackPositionAsync(ticks)?.get()?;
            Ok(())
        })();
        if let Err(e) = res {
            println!("[media] seek gagal: {e:?}");
        }
    });
}