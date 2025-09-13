/* Morse SOS Flashlight by Fabaro (mukemen.ai)
   - Torch via MediaStreamTrack.applyConstraints({advanced:[{torch:true}]}) when supported
   - Fallback: screen flash + WebAudio beep
   - WPM: unit = 1200 / WPM (ms)
*/
const $ = (sel) => document.querySelector(sel);
const logEl = $("#log");
const torchCapEl = $("#torchCap");
const wlCapEl = $("#wlCap");
const screenOverlay = $("#screenOverlay");
const wpmRange = $("#wpm");
const wpmVal = $("#wpmVal");

let mediaStream = null;
let videoTrack = null;
let torchAvailable = "unknown";
let wakeLock = null;
let running = false;
let stopFlag = false;
let audioCtx = null;
let oscillator = null;
let deferredPrompt = null;

// Morse map
const MORSE = {
  "A": ".-","B": "-...","C": "-.-.","D": "-..","E": ".",
  "F": "..-.","G": "--.","H": "....","I": "..","J": ".---",
  "K": "-.-","L": ".-..","M": "--","N": "-.","O": "---",
  "P": ".--.","Q": "--.-","R": ".-.","S": "...","T": "-",
  "U": "..-","V": "...-","W": ".--","X": "-..-","Y": "-.--",
  "Z": "--..",
  "0": "-----","1": ".----","2": "..---","3": "...--","4": "....-",
  "5": ".....","6": "-....","7": "--...","8": "---..","9": "----."
};

function log(msg){
  const time = new Date().toLocaleTimeString();
  logEl.textContent = `[${time}] ${msg}\n` + logEl.textContent;
}

function unitMs(){
  const wpm = parseInt(wpmRange.value, 10);
  wpmVal.textContent = `${wpm} WPM`;
  return 1200 / wpm;
}

// Torch helpers
async function ensureStream(){
  if (mediaStream) return;
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });
    const tracks = mediaStream.getVideoTracks();
    videoTrack = tracks[0];
    const caps = videoTrack.getCapabilities?.() || {};
    if ("torch" in caps){
      torchAvailable = caps.torch ? "available" : "unavailable";
    }else{
      torchAvailable = "unsupported";
    }
    torchCapEl.textContent = torchAvailable;
  }catch(err){
    log(`Gagal membuka kamera: ${err.message}`);
    torchAvailable = "denied";
    torchCapEl.textContent = torchAvailable;
  }
}
async function setTorch(on){
  if (!videoTrack) return;
  try{
    await videoTrack.applyConstraints({ advanced: [{ torch: !!on }] });
  }catch(err){
    // Some devices error if torch is off while not recording; ignore softly
  }
}

// Screen flash helpers
function screenOn(on){
  screenOverlay.style.display = on ? "block" : "none";
}

// Beep helpers
function beep(on){
  if (on){
    if (!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 800; // Hz
    oscillator.connect(gain).connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    oscillator.start();
  }else{
    try{ oscillator && oscillator.stop(); }catch{}
    oscillator = null;
  }
}

async function requestWakeLock(){
  if ("wakeLock" in navigator){
    try{
      wakeLock = await navigator.wakeLock.request("screen");
      wlCapEl.textContent = "on";
      wakeLock.addEventListener?.("release", () => { wlCapEl.textContent = "off"; });
    }catch(e){
      wlCapEl.textContent = "failed";
    }
  }else{
    wlCapEl.textContent = "unsupported";
  }
}
async function releaseWakeLock(){
  try{ await wakeLock?.release(); }catch{}
  wlCapEl.textContent = "off";
  wakeLock = null;
}

function textToMorse(text){
  return text.toUpperCase().split("").map(ch => {
    if (ch === " ") return " ";
    return MORSE[ch] || "";
  }).join(" ");
}

// Build schedule: array of {on:boolean, ms:number}
function scheduleFromMorse(morse, unit){
  const seq = [];
  const words = morse.split("   "); // We'll craft spaces deliberately
  // Actually, we will parse by characters and spaces: use direct parsing
  // Rules: dot=1, dash=3; gap between symbols=1 off; letter gap=3 off; word gap=7 off
  // We'll scan characters and insert proper gaps.
  const tokens = []; // each token is ".", "-", " " word gap, "|" letter gap marker
  // Build tokens by walking morse string made by textToMorse (letters separated by single space)
  const parts = morse.split(" ");
  for (let i=0;i<parts.length;i++){
    const p = parts[i];
    if (p === "") continue;
    if (p === "/"){ // not used, but keep
      tokens.push(" ");
      continue;
    }
    if (p === " "){
      tokens.push(" ");
      continue;
    }
    if (/^[.-]+$/.test(p)){
      // push symbols with letter separators
      for (let j=0;j<p.length;j++){
        tokens.push(p[j]); // . or -
        if (j < p.length - 1) tokens.push("|"); // symbol gap
      }
      // after a letter, lookahead: if next part is not empty and not word, then letter gap
      if (i < parts.length -1 && parts[i+1] !== "") tokens.push("||"); // letter gap after a letter
    }else if (p === ""){
      tokens.push(" ");
    }
  }
  // Now translate tokens to schedule
  for (let i=0;i<tokens.length;i++){
    const t = tokens[i];
    if (t === "."){
      seq.push({on:true, ms: 1*unit});
      // symbol gap (handled by tokens "|" -> 1 off)
    }else if (t === "-"){
      seq.push({on:true, ms: 3*unit});
    }else if (t === "|"){
      seq.push({on:false, ms: 1*unit});
    }else if (t === "||"){
      seq.push({on:false, ms: 3*unit});
    }else if (t === " "){
      seq.push({on:false, ms: 7*unit});
    }
  }
  return seq;
}

function buildScheduleFromText(text){
  // Convert spaces to explicit word gaps by double space in morse
  const morse = textToMorse(text).replace(/ {2,}/g, " ").replace(/  /g, " ");
  // The morse from textToMorse separates letters with one space and words with one extra space (we'll handle word gap on literal spaces in text)
  // We'll rebuild with custom parsing: treat original text spaces as word gaps.
  const rebuilt = text.toUpperCase().split("").map(ch => {
    if (ch === " ") return " ";
    return MORSE[ch] || "";
  }).join(" ");
  const unit = unitMs();
  return scheduleFromMorse(rebuilt, unit);
}

async function playScheduleOnce(schedule, opts){
  const {useTorch, useScreen, useBeep} = opts;
  for (const step of schedule){
    if (stopFlag) break;
    if (step.on){
      if (useTorch && videoTrack && torchAvailable === "available") await setTorch(true);
      if (useScreen) screenOn(true);
      if (useBeep) beep(true);
      navigator.vibrate?.([Math.min(step.ms, 50)]); // short haptic tick
    }else{
      if (useTorch && videoTrack && torchAvailable === "available") await setTorch(false);
      if (useScreen) screenOn(false);
      if (useBeep) beep(false);
    }
    await new Promise(r => setTimeout(r, step.ms));
  }
  // ensure off
  if (useTorch && videoTrack && torchAvailable === "available") await setTorch(false);
  if (useScreen) screenOn(false);
  if (useBeep) beep(false);
}

async function startMorse(text){
  if (running) return;
  stopFlag = false;
  running = true;
  $("#btnFlash").disabled = true;
  $("#btnSOS").disabled = true;

  await requestWakeLock();

  const useTorch = $("#useTorch").checked;
  const useScreen = $("#useScreen").checked;
  const useBeep = $("#useBeep").checked;
  const loop = $("#useLoop").checked;

  if (useTorch){
    await ensureStream();
    log(`Torch capability: ${torchAvailable}`);
    if (torchAvailable !== "available"){
      log("Torch tidak tersedia. Akan gunakan kedipan layar + bunyi bip jika diaktifkan.");
    }
  }

  const schedule = buildScheduleFromText(text);
  log(`Mulai mem-flash: "${text}" @ ${wpmRange.value} WPM (${schedule.length} langkah)`);

  do{
    if (stopFlag) break;
    await playScheduleOnce(schedule, {useTorch, useScreen, useBeep});
  } while(loop && !stopFlag);

  await releaseWakeLock();
  $("#btnFlash").disabled = false;
  $("#btnSOS").disabled = false;
  running = false;
  log("Selesai.");
}

function stopMorse(){
  stopFlag = true;
}

$("#btnFlash").addEventListener("click", async () => {
  const text = $("#text").value.trim().replace(/\s+/g, " ");
  if (!text){ log("Teks kosong."); return; }
  startMorse(text);
});
$("#btnSOS").addEventListener("click", () => startMorse("SOS"));
$("#btnStop").addEventListener("click", stopMorse);
$("#wpm").addEventListener("input", () => unitMs());
$("#useTorch").addEventListener("change", () => {
  if ($("#useTorch").checked){
    ensureStream();
  }
});
$("#btnTestTorch").addEventListener("click", async () => {
  await ensureStream();
  if (torchAvailable === "available"){
    log("Menyalakan torch 300ms…");
    await setTorch(true);
    setTimeout(() => setTorch(false), 300);
  }else{
    log(`Torch tidak tersedia: ${torchAvailable}`);
  }
});
$("#btnLocation").addEventListener("click", () => {
  const el = $("#geo");
  if (!("geolocation" in navigator)){ el.textContent = "Geolokasi tidak didukung."; return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const {latitude, longitude, accuracy} = pos.coords;
      el.innerHTML = `Lokasi: <b>${latitude.toFixed(6)}, ${longitude.toFixed(6)}</b> (±${Math.round(accuracy)} m)`;
    },
    err => {
      el.textContent = "Gagal mendapatkan lokasi: " + err.message;
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
});

// Install prompt
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#installPWA").style.display = "inline";
});
$("#installPWA").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  log("Install PWA: " + outcome);
  deferredPrompt = null;
});

// Register SW
if ("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(() => log("Service Worker terdaftar."));
  });
}

// Initialize UI
unitMs();
log("Siap. Gunakan tombol KIRIM SOS atau FLASH MORSE.");