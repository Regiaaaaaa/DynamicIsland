use serde::Serialize;
use windows::{
    core::Result,
    Win32::{
        Media::Audio::{
            eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
    },
};

#[derive(Serialize)]
pub struct VolumeInfo {
    level: f32, // 0.0 - 1.0
    muted: bool,
}

fn endpoint() -> Result<IAudioEndpointVolume> {
    unsafe {
        // Aman dipanggil berulang. Kalau thread sudah punya mode COM lain, errornya diabaikan.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

#[tauri::command]
pub fn get_volume() -> Option<VolumeInfo> {
    let run = || -> Result<VolumeInfo> {
        let ep = endpoint()?;
        unsafe {
            Ok(VolumeInfo {
                level: ep.GetMasterVolumeLevelScalar()?,
                muted: ep.GetMute()?.as_bool(),
            })
        }
    };
    match run() {
        Ok(v) => Some(v),
        Err(e) => {
            println!("[volume] get gagal: {e:?}");
            None
        }
    }
}

#[tauri::command]
pub fn set_volume(level: f32) {
    let level = level.clamp(0.0, 1.0);
    let run = || -> Result<()> {
        let ep = endpoint()?;
        unsafe { ep.SetMasterVolumeLevelScalar(level, std::ptr::null()) }
    };
    if let Err(e) = run() {
        println!("[volume] set gagal: {e:?}");
    }
}

#[tauri::command]
pub fn set_mute(muted: bool) {
    let run = || -> Result<()> {
        let ep = endpoint()?;
        unsafe { ep.SetMute(muted, std::ptr::null()) }
    };
    if let Err(e) = run() {
        println!("[volume] mute gagal: {e:?}");
    }
}