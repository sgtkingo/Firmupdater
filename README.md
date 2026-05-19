# ⚡ Web-based Firmware Updater

Web-based tool to flash ESP32 firmware for `SignalTwin` (https://github.com/sgtkingo/SignalTwinProject) via the Web Serial API. No external tools needed.

---

## 🌐 Live-page
Checkout https://sgtkingo.github.io/Firmupdater/

## ✨ Features

- **Auto-Update:** Fetches the latest GitHub release.
- **Web Flashing:** Direct flashing via Chrome/Edge (Web Serial API).
- **User-Friendly:** One-click process, live terminal, built-in troubleshooting.

---

## 🛠️ Requirements

- **Browser:** Chrome, Edge, Opera  
- **Drivers:** CP210x or CH340

---

## 🚀 Quick Start

```bash
git clone https://github.com/Xander2662/VirtualSensors_project.git
cd VirtualSensors_project
npm install && npm run dev
```

Open `http://localhost:5173`.

- **Config:** `src/App.tsx`
- **Build:** `npm run build`

---

## 📖 Usage

1. **Check:** Version is auto-detected on load.
2. **Connect:** Select COM port.
3. **Flash:** Click **"Update Firmware"**.

---

## ❓ Troubleshooting

| Issue | Solution |
|---|---|
| No Port | Install CP210x or CH340 drivers. |
| Stuck “Connecting...” | Hold the **BOOT** button, click **"Update Firmware"**, release once flashing starts. |
| Download Fail | Enable **"Use CORS Proxy"**. (not supported in latest version) |

---

## 📄 License

Open-source. See the `LICENSE` file.
