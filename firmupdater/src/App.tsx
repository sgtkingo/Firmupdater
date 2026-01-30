import { useState, useEffect, useRef } from "react";
import {
  Terminal,
  RefreshCw,
  Zap,
  Cpu,
  AlertCircle,
  Download,
  Play,
  AlertTriangle,
  HelpCircle,
  X,
  ExternalLink,
  FileText,
  Check,
  Cable,
  ChevronDown,
  ChevronUp,
  Star,
} from "lucide-react";

// esptool-js via npm (NO CDN)
import { ESPLoader, Transport } from "esptool-js";

// --- TypeScript Definitions for Web Serial API ---
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream;
  writable: WritableStream;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  assets: GithubAsset[];
  body: string;
}

export default function App() {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [status, setStatus] = useState<string>("Inicializace...");
  const [progress, setProgress] = useState<number>(0);
  const [logs, setLogs] = useState<string>("");
  const [latestRelease, setLatestRelease] = useState<GithubRelease | null>(null);
  
  const [portSelected, setPortSelected] = useState<boolean>(false);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [firmwareBin, setFirmwareBin] = useState<ArrayBuffer | null>(null);
  const [useProxy, setUseProxy] = useState<boolean>(true);

  // State pro nápovědu
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [activeHelpSection, setActiveHelpSection] = useState<string | null>(null);

  const [loadingUpdate, setLoadingUpdate] = useState<boolean>(true);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const portRef = useRef<SerialPort | null>(null);
  const keepReadingRef = useRef<boolean>(false);
  
  // Ref pro zabránění dvojímu spuštění v React Strict Mode
  const initialized = useRef(false);

  const REPO_OWNER = "sgtkingo";
  const REPO_NAME = "SignalTwinProject";
  const BAUD_RATE = 115200;

  // --- 1. Automatická kontrola updatů po startu ---
  useEffect(() => {
    // Zámek proti dvojímu spuštění (React Strict Mode fix)
    if (!initialized.current) {
      initialized.current = true;
      checkUpdates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect: Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs((prev) => prev + `[${new Date().toLocaleTimeString()}] ${msg}\n`);
    // eslint-disable-next-line no-console
    console.log(`[AppLog] ${msg}`);
  };

  const openHelp = (section: string) => {
    setActiveHelpSection(section);
    setShowHelp(true);
  };

  const toggleHelpSection = (section: string) => {
    setActiveHelpSection((prev) => (prev === section ? null : section));
  };

  const checkUpdates = async () => {
    setLoadingUpdate(true);
    setStatus("Kontrola aktualizací...");
    addLog(`Automatická kontrola GitHub verze: ${REPO_OWNER}/${REPO_NAME}...`);
    setLatestRelease(null);
    setFirmwareBin(null);

    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
      );
      if (!response.ok) throw new Error(`GitHub API Error: ${response.statusText}`);

      const data: GithubRelease = await response.json();
      setLatestRelease(data);
      addLog(`Nalezena verze: ${data.tag_name}`);

      const binAsset = data.assets.find((asset) => asset.name.endsWith("ino.bin"));
      if (binAsset) {
        addLog(
          `Nalezen firmware: ${binAsset.name} (${(binAsset.size / 1024).toFixed(2)} KB)`
        );
        addLog(`Firmware URL: ${binAsset.browser_download_url}`);
        await downloadFirmware(binAsset.browser_download_url);
      } else {
        addLog("Varování: Release neobsahuje .bin soubor.");
        setStatus("Binárka nenalezena");
        openHelp("firmware");
      }
    } catch (error: any) {
      addLog(`Chyba kontroly aktualizací: ${error.message}`);
      setStatus("Chyba sítě");
      openHelp("firmware");
    } finally {
      setLoadingUpdate(false);
    }
  };

  const downloadFirmware = async (url: string) => {
    setStatus("Stahuji firmware...");
    
    // ZMĚNA: Návrat k corsproxy.io, protože ghproxy.net vracel "Failed to fetch" (CORS/Network error).
    // Problém 403 u corsproxy byl pravděpodobně způsoben dvojím voláním (fixed výše).
    const finalUrl = useProxy 
      ? `https://corsproxy.io/?${encodeURIComponent(url)}` 
      : url;
    
    addLog(`Stahuji .bin soubor... ${useProxy ? "(přes Proxy)" : ""}`);

    try {
      const response = await fetch(finalUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) throw new Error("Prázdný soubor.");

      setFirmwareBin(arrayBuffer);
      addLog(`Firmware připraven (${arrayBuffer.byteLength} bytes).`);
      setStatus("Připraveno k flashování");
    } catch (error: any) {
      addLog(`Chyba stahování: ${error.message}`);
      setStatus("Chyba stahování");
      openHelp("firmware");
    }
  };

  const connectToDevice = async () => {
    const nav = navigator as any;
    if (!nav.serial) {
      addLog("Chyba: Web Serial API není podporováno.");
      return;
    }
    try {
      const selectedPort = await nav.serial.requestPort();
      await selectedPort.open({ baudRate: BAUD_RATE });

      setPort(selectedPort);
      portRef.current = selectedPort;
      setPortSelected(true);

      addLog("Port otevřen. Monitor aktivní.");
      setStatus("Zařízení Připojeno");

      keepReadingRef.current = true;
      readSerialLoop(selectedPort);
    } catch (error: any) {
      addLog(`Chyba připojení: ${error.message}`);
      if (error.name === "NotFoundError") {
        setPortSelected(false);
        openHelp("device");
      }
    }
  };

  const readSerialLoop = async (currentPort: SerialPort) => {
    while (currentPort.readable && keepReadingRef.current) {
      try {
        const reader = currentPort.readable.getReader();
        readerRef.current = reader as any;
        while (true) {
          const { done } = await reader.read();
          if (done) break;
          if (!keepReadingRef.current) break;
        }
      } catch (error) {
        // Ignore errors
      } finally {
        if (readerRef.current) {
          try {
            readerRef.current.releaseLock();
          } catch (e) {}
          readerRef.current = null;
        }
      }
    }
  };

  const flashFirmware = async () => {
    if (!firmwareBin) return;

    setIsFlashing(true);
    setStatus("Příprava...");
    setProgress(0);
    addLog("--- START FLASHOVÁNÍ ---");

    // 0) Must have an already selected port from step #2
    const device = portRef.current;
    if (!device) {
      addLog("CHYBA: Není vybraný žádný port (nejdřív krok 2 – Připojení).");
      setStatus("Chyba nahrávání");
      setPortSelected(false);
      setIsFlashing(false);
      openHelp("device");
      return;
    }

    // 1) Stop serial monitor and release reader
    keepReadingRef.current = false;
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 100));

    // 2) Close the port to release it from monitor usage (best-effort)
    try {
      await device.close();
    } catch {}

    setPort(null);

    try {
      // 3) Create transport + loader on the SAME selected port
      const transport = new Transport(device, true);
      const loader = new ESPLoader({
        transport,
        baudrate: BAUD_RATE,
        romBaudrate: BAUD_RATE, 
        terminal: {
          clean: () => {},
          writeLine: (data: string) => addLog("[ESP]: " + String(data)),
          write: (_data: string) => {},
        },
      });


      // 4) Connect to ROM bootloader and run stub
      addLog("Připojuji k bootloaderu...");
      await loader.main();
      addLog("Bootloader připojen.");

      // 5) Prepare firmware payload
      addLog("Zapisuji firmware...");

      const fwU8 = new Uint8Array(firmwareBin);

      // Fix for: bStr.charCodeAt is not a function
      const fwBstr =
        typeof (loader as any).ui8ToBstr === "function"
          ? (loader as any).ui8ToBstr(fwU8)
          : null;

      const fileArray = fwBstr
        ? [{ data: fwBstr, address: 0x10000 }]
        : [{ data: fwU8, address: 0x10000 }];

      await (loader as any).writeFlash({
        fileArray,
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex: number, written: number, total: number) => {
          const percent = total > 0 ? Math.round((written / total) * 100) : 0;
          setProgress(percent);
          setStatus(`Nahrávám: ${percent}%`);
        },
      });

      addLog("HOTOVO! Resetujte zařízení.");
      setStatus("ÚSPĚCH");
    } catch (error: any) {
      console.error(error);
      addLog(`CHYBA: ${error?.message ?? String(error)}`);
      setStatus("Chyba nahrávání");
      openHelp("flash");
    } finally {
      setIsFlashing(false);

      // 6) Re-open the SAME port for monitoring again (best-effort)
      try {
        await device.open({ baudRate: BAUD_RATE });
        setPort(device);
        portRef.current = device;

        keepReadingRef.current = true;
        readSerialLoop(device);

        addLog("Port znovu otevřen. Monitor aktivní.");
        if (status !== "ÚSPĚCH") setStatus("Zařízení Připojeno");
      } catch {
        // If reopen fails, user can reconnect manually
        keepReadingRef.current = false;
      }
    }
  };


  // Helper pro zobrazení statusu
  const getStatusMessage = () => {
    if (isFlashing) return `Flashuju... (${progress}%)`;
    if (status === "ÚSPĚCH") return "Dokončeno!";
    if (status.includes("Chyba") || status.includes("Error")) return status;
    if (status.includes("Stahuji") || status.includes("Kontrola")) return status;
    if (!port) return "Nebylo detekováno žádné zařízení";
    return "Připraven";
  };

  // Helper pro barvu statusu
  const getStatusColor = () => {
    const msg = getStatusMessage();
    if (msg.includes("Chyba") || msg.includes("Error")) return "text-red-400";
    if (msg === "Dokončeno!" || msg === "Připraven") return "text-green-400";
    if (msg.includes("Flashuju")) return "text-blue-400";
    if (msg === "Nebylo detekováno žádné zařízení") return "text-yellow-500";
    return "text-blue-300";
  };

  const flashDisabledReason =
  !firmwareBin
    ? "Nejprve stáhni firmware (krok 1)."
    : !portSelected
    ? "Nejprve připoj zařízení v kroku č. 2."
    : isFlashing
    ? "Probíhá nahrávání."
    : "";

  const flashDisabled = !firmwareBin || !portSelected || isFlashing;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-6 font-sans relative">
      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-800 rounded-xl shadow-2xl max-w-lg w-full border border-slate-600 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-700/50 rounded-t-xl">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <HelpCircle className="text-blue-400" /> Nápověda & Řešení problémů
              </h3>
              <button
                onClick={() => setShowHelp(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-0 overflow-y-auto">
              {/* Accordion: Firmware Issue */}
              <div className="border-b border-slate-700">
                <button
                  onClick={() => toggleHelpSection("firmware")}
                  className={`w-full flex justify-between items-center p-4 text-left font-semibold ${
                    activeHelpSection === "firmware"
                      ? "bg-slate-700/50 text-white"
                      : "hover:bg-slate-700/30 text-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <RefreshCw size={18} /> Nestáhl se poslední firmware
                  </span>
                  {activeHelpSection === "firmware" ? (
                    <ChevronUp size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </button>
                {activeHelpSection === "firmware" && (
                  <div className="p-4 bg-slate-900/50 text-sm text-slate-300 space-y-2">
                    <p>Pokud aplikace nemůže načíst verzi z GitHubu:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Zkontrolujte připojení k internetu.</li>
                      <li>
                        Zkuste zaškrtnout/odškrtnout možnost <strong>"Použít CORS Proxy"</strong>
                        v sekci 1.
                      </li>
                      <li>
                        GitHub API může mít dočasný výpadek nebo limit požadavků. Zkuste to za chvíli
                        znovu.
                      </li>
                    </ul>
                  </div>
                )}
              </div>

              {/* Accordion: Device Visibility (Drivers) */}
              <div className="border-b border-slate-700">
                <button
                  onClick={() => toggleHelpSection("device")}
                  className={`w-full flex justify-between items-center p-4 text-left font-semibold ${
                    activeHelpSection === "device"
                      ? "bg-slate-700/50 text-white"
                      : "hover:bg-slate-700/30 text-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Cable size={18} /> Nevidím zařízení / COM Port
                  </span>
                  {activeHelpSection === "device" ? (
                    <ChevronUp size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </button>
                {activeHelpSection === "device" && (
                  <div className="p-4 bg-slate-900/50 text-sm text-slate-300 space-y-4">
                    <p>Pokud seznam portů zeje prázdnotou, chybí vám ovladače pro USB převodník.</p>

                    <div className="space-y-3">
                      <a
                        href="https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=overview"
                        target="_blank"
                        rel="noreferrer"
                        className="relative block border-2 border-blue-500/50 bg-blue-900/20 rounded p-3 hover:bg-blue-900/30 transition-colors group text-left"
                      >
                        <div className="absolute -top-2.5 left-2 bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow flex items-center gap-1">
                          <Star size={10} fill="white" /> DOPORUČENO
                        </div>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-blue-200 group-hover:text-blue-100 transition-colors">
                              CP210x Ovladače (Silicon Labs)
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                              Používá většina originálních ESP32 DevKit desek. Toto je nejpravděpodobnější
                              řešení.
                            </p>
                          </div>
                          <ExternalLink
                            size={18}
                            className="text-blue-500 group-hover:text-white transition-colors"
                          />
                        </div>
                      </a>

                      <a
                        href="https://www.wch-ic.com/downloads/CH341SER_EXE.html"
                        target="_blank"
                        rel="noreferrer"
                        className="block border border-slate-600 bg-slate-800/50 rounded p-3 hover:bg-slate-700/50 transition-colors group text-left"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-slate-200 group-hover:text-white transition-colors">
                              CH340 Ovladače (WCH)
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                              Používá se u levnějších klonů (Lolin, NodeMCU apod.). Pokud první nezabral,
                              zkuste tento.
                            </p>
                          </div>
                          <ExternalLink
                            size={18}
                            className="text-slate-500 group-hover:text-white transition-colors"
                          />
                        </div>
                      </a>

                      <div className="text-xs text-yellow-500/80 pt-2 border-t border-slate-700/50">
                        <strong>Tip:</strong> Zkuste také jiný USB kabel. Některé kabely jsou pouze nabíjecí
                        a nepřenáší data!
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Accordion: Flashing Failed */}
              <div className="border-b border-slate-700">
                <button
                  onClick={() => toggleHelpSection("flash")}
                  className={`w-full flex justify-between items-center p-4 text-left font-semibold ${
                    activeHelpSection === "flash"
                      ? "bg-slate-700/50 text-white"
                      : "hover:bg-slate-700/30 text-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Download size={18} /> Selhalo nahrávání (Connecting...)
                  </span>
                  {activeHelpSection === "flash" ? (
                    <ChevronUp size={18} />
                  ) : (
                    <ChevronDown size={18} />
                  )}
                </button>
                {activeHelpSection === "flash" && (
                  <div className="p-4 bg-slate-900/50 text-sm text-slate-300 space-y-2">
                    <p>
                      Pokud se proces zasekne na hlášce <code>Connecting...</code>, znamená to, že se čip
                      nepřepnul do "Download Mode".
                    </p>
                    <div className="bg-yellow-900/20 border border-yellow-700/30 p-3 rounded text-yellow-200">
                      <strong>Manuální postup:</strong>
                      <ol className="list-decimal pl-5 mt-1 space-y-1">
                        <li>Odpojte USB.</li>
                        <li>
                          Držte tlačítko <strong>BOOT</strong> na ESP32.
                        </li>
                        <li>Zapojte USB (tlačítko stále držte).</li>
                        <li>Klikněte na "Aktualizovat Firmware" v aplikaci.</li>
                        <li>Pusťte tlačítko až začne proces nahrávání.</li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-700/30 rounded-b-xl text-center">
              <button
                onClick={() => setShowHelp(false)}
                className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded font-semibold transition-colors"
              >
                Rozumím
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-4">
          <div className="flex items-center space-x-3">
            <Cpu className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">ESP32 Firmware Updater</h1>
              <p className="text-sm text-slate-400">VirtualSensors Project</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHelp(true)}
              className="text-slate-400 hover:text-white flex items-center gap-1 text-sm bg-slate-800 px-3 py-1 rounded-full border border-slate-700"
            >
              <HelpCircle size={16} /> Nápověda
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            {/* Step 1: Version Info (Auto-checked) */}
            <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-lg">
              <div className="flex justify-between items-start mb-2">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <RefreshCw size={20} className={loadingUpdate ? "animate-spin" : ""} /> 1. Verze
                  Firmwaru
                </h2>
                <div className="flex items-center gap-2">
                  {latestRelease && (
                    <a
                      href={latestRelease.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 bg-slate-700/50 px-2 py-1 rounded border border-slate-600"
                      title="Otevřít release notes na GitHubu"
                    >
                      <FileText size={12} /> Poznámky
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>

              {loadingUpdate ? (
                <div className="text-slate-400 text-sm py-4 text-center">
                  Kontroluji dostupnost nové verze...
                </div>
              ) : latestRelease ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center bg-slate-700/30 p-3 rounded border border-slate-600/50">
                    <div>
                      <div className="text-sm text-slate-400">Nejnovější verze:</div>
                      <div className="text-xl font-bold text-green-400">{latestRelease.tag_name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">
                        {new Date(latestRelease.published_at).toLocaleDateString()}
                      </div>
                      {firmwareBin ? (
                        <div className="text-xs text-green-400 flex items-center gap-1 mt-1 justify-end">
                          <Check size={12} /> Staženo
                        </div>
                      ) : (
                        <div className="text-xs text-red-400">Chyba stažení</div>
                      )}
                    </div>
                  </div>

                  <label className="text-xs text-slate-500 cursor-pointer flex items-center gap-1 mt-2">
                    <input
                      type="checkbox"
                      checked={useProxy}
                      onChange={(e) => setUseProxy(e.target.checked)}
                      className="rounded bg-slate-700 border-slate-600"
                    />
                    Použít CORS Proxy (doporučeno)
                  </label>
                </div>
              ) : (
                <div className="text-red-400 text-sm py-2">Nepodařilo se načíst informace o verzi.</div>
              )}
            </div>

            {/* Step 2: Connection */}
            <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-lg">
              <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                <Zap size={20} /> 2. Připojení
              </h2>
              <div className="text-sm text-slate-400 mb-4 space-y-2">
                <p>Připojte ESP32 k počítači USB kabelem.</p>
                <p className="text-slate-500 text-xs flex items-center gap-1">
                  <Cable size={12} /> Ujistěte se, že kabel přenáší data (nejen nabíjení).
                </p>
              </div>

              <button
                onClick={connectToDevice}
                disabled={!!portSelected || isFlashing}
                className={`w-full py-2 px-4 rounded transition-colors flex items-center justify-center gap-2 ${
                  portSelected
                    ? "bg-green-600 cursor-default"
                    : "bg-slate-600 hover:bg-slate-500 text-white"
                }`}
              >
                {portSelected ? "Zařízení připojeno" : "Vybrat zařízení (COM port)"}
              </button>

              {!port && (
                <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-400 flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-blue-400" />
                  <div>
                    Nevidíte žádný port? <br />
                    <button
                      onClick={() => openHelp("device")}
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      Zkontrolujte ovladače (Nápověda)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Step 3: Flash */}
            <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 shadow-lg relative overflow-hidden flex flex-col">
              {isFlashing && (
                <div
                  className="absolute top-0 left-0 h-1 bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              )}
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Download size={20} /> 3. Nahrát Firmware
              </h2>

              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded p-3 mb-4 text-xs text-yellow-200 flex gap-2 items-start">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <strong>Tip:</strong> Pokud se nahrávání zasekne na "Connecting...", držte tlačítko
                  <strong> BOOT</strong> na ESP32 v momentě kliknutí na tlačítko níže.
                </div>
              </div>

              <div className="flex justify-between items-center mb-4 text-sm">
                <span className="text-slate-400">Stav:</span>
                <span className={`font-mono ${getStatusColor()}`}>{getStatusMessage()}</span>
              </div>

              <span title={flashDisabled ? flashDisabledReason : ""} className="block">
                <button
                  onClick={flashFirmware}
                  disabled={flashDisabled}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 px-4 rounded font-bold transition-all shadow-lg flex items-center justify-center gap-2 mt-auto"
                >
                  {isFlashing ? "Nahrávám..." : "Náhrát firmware"} <Play size={18} fill="currentColor" />
                </button>
              </span>
            </div>
          </div>

          {/* Right Column: Terminal */}
          <div className="flex flex-col bg-black rounded-lg border border-slate-700 shadow-xl overflow-hidden h-[600px]">
            <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex justify-between items-center">
              <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
                <Terminal size={14} /> SYSTEM LOG
              </span>
              <button
                onClick={() => setLogs("")}
                className="text-xs text-slate-500 hover:text-white transition-colors"
              >
                Vymazat
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs md:text-sm space-y-1">
              <pre className="text-green-500/80 whitespace-pre-wrap break-all">
                {logs || "Čekám na akci uživatele..."}
              </pre>
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}