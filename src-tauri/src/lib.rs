mod media;
mod volume;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, PhysicalPosition,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(media::ArtCache::default())
        .invoke_handler(tauri::generate_handler![
            media::media_control,
            media::get_media_art,
            media::media_seek,
            volume::get_volume,
            volume::set_volume,
            volume::set_mute
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("window 'main' tidak ditemukan");

            // Posisi awal: tengah atas
            if let Some(monitor) = window.primary_monitor()? {
                let m_pos = monitor.position();
                let m_size = monitor.size();
                let w_size = window.outer_size()?;
                let scale = monitor.scale_factor();
                let x = m_pos.x + (m_size.width as i32 - w_size.width as i32) / 2;
                let y = m_pos.y + (8.0 * scale) as i32;
                window.set_position(PhysicalPosition::new(x, y))?;
            }

            // ---------- Tray menu ----------
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItem::with_id(
                app,
                "autostart",
                "Jalankan saat Windows menyala",
                true,
                autostart_on,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&autostart_item, &sep, &quit_item])?;

            let autostart_item_c = autostart_item.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Dynamic Island")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "autostart" => {
                        let al = app.autolaunch();
                        let enabled = al.is_enabled().unwrap_or(false);
                        let _ = if enabled { al.disable() } else { al.enable() };
                        let now = al.is_enabled().unwrap_or(false);
                        let _ = autostart_item_c.set_checked(now);
                    }
                    _ => {}
                })
                .build(app)?;

            // Mulai baca media Windows
            media::start(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("gagal menjalankan aplikasi Tauri");
}