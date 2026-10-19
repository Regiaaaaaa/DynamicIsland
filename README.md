# DynamicIsland
Floating Dynamic Island for Windows. Media controls, album art, and volume in a smooth animated pill. Built with Tauri, React, and Framer Motion.

## Features
- Compact → Hover → Opens with a spring animation (Framer Motion)
- Reads data from Spotify and the browser via SMTC (title, artist, album art, playback progress)
- Play/pause, next track, and previous track controls
- Master volume slider
- System tray icon with Exit and autostart menus

## Technology Stack
Tauri v2 (Rust) · React + Vite · Tailwind CSS · Framer Motion · Lucide

## Running
npm install
npm run tauri dev

## Building
npm run tauri build
