/*
  Proyecto Voltímetro - Visor PWA Web Bluetooth

  Importante:
  - Web Bluetooth normal trabaja conectándose a un servidor GATT.
  - El modo "leer advertising BLE crudo" no es confiable para PWA común.
  - Por eso esta prueba usa conexión GATT + notifications.
*/

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const VOLT_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

let device = null;
let server = null;
let characteristic = null;
let reconnecting = false;

let voiceEnabled = false;
let lastSpokenAt = 0;

let wakeLock = null;
let wakeLockEnabled = false;

let sampleCount = 0;

const history = [];
const MAX_POINTS = 240;

const $ = (id) => document.getElementById(id);

const statusEl = $('status');
const badgeEl = $('badge');
const voltageEl = $('voltage');
const rangeEl = $('range');

const connectBtn = $('connectBtn');
const voiceBtn = $('voiceBtn');
const wakeBtn = $('wakeBtn');
const clearBtn = $('clearBtn');

const lastRawEl = $('lastRaw');
const samplesEl = $('samples');
const connStateEl = $('connState');

const canvas = $('chart');
const ctx = canvas.getContext('2d');

function setStatus(text, connected = false) {
  statusEl.textContent = text;
  connStateEl.textContent = connected ? 'Conectado' : text;
  badgeEl.textContent = connected ? 'ON' : 'OFF';
  badgeEl.className = connected ? 'badge on' : 'badge off';
}

function formatVoltage(v) {
  if (!Number.isFinite(v)) return '--.--';
  if (v < 10) return v.toFixed(2);
  return v.toFixed(1);
}

async function connect() {
  try {
    if (!('bluetooth' in navigator)) {
      setStatus('Este navegador no soporta Web Bluetooth');
      alert('Este navegador no soporta Web Bluetooth. Usar Chrome en Android o Chrome/Edge en PC.');
      return;
    }

    setStatus('Buscando Volt_Taller_SIM...');

    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Volt_Taller' }],
      optionalServices: [SERVICE_UUID]
    });

    device.addEventListener('gattserverdisconnected', onDisconnected);

    await connectKnownDevice();
  } catch (err) {
    console.error(err);
    setStatus('Conexión cancelada o fallida');
  }
}

async function connectKnownDevice() {
  if (!device) return;

  try {
    reconnecting = true;
    setStatus('Conectando BLE...');

    server = await device.gatt.connect();

    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(VOLT_CHAR_UUID);

    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', onData);

    setStatus('Conectado a ' + (device.name || 'voltímetro'), true);
    connectBtn.textContent = 'RECONECTAR / CAMBIAR EQUIPO';
  } catch (err) {
    console.error(err);
    setStatus('No se pudo conectar');
  } finally {
    reconnecting = false;
  }
}

function onDisconnected() {
  setStatus('Se perdió la señal. Reintentando...');

  characteristic = null;
  server = null;

  // La reconexión solo puede intentar contra el mismo device autorizado.
  // Si el navegador elimina el permiso o se recarga la página,
  // habrá que tocar Conectar otra vez.
  retryReconnect();
}

async function retryReconnect() {
  if (reconnecting || !device) return;

  for (let i = 0; i < 20; i++) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (device.gatt.connected) return;

      await connectKnownDevice();

      if (device.gatt.connected) return;
    } catch (err) {
      console.warn('Reintento BLE falló', i + 1, err);
    }
  }

  setStatus('Sin señal. Tocá conectar si no vuelve solo.');
}

function onData(event) {
  const text = new TextDecoder().decode(event.target.value).trim();

  lastRawEl.textContent = text;

  const parts = text.split(',');
  const v = Number.parseFloat(parts[0]);
  const range = parts[1] || '--';

  if (!Number.isFinite(v)) return;

  sampleCount++;
  samplesEl.textContent = String(sampleCount);

  voltageEl.textContent = formatVoltage(v);
  rangeEl.textContent = 'RANGO ' + range;

  pushPoint(v);
  drawChart();

  speakIfNeeded(v);
}

function pushPoint(v) {
  history.push({ t: Date.now(), v });

  while (history.length > MAX_POINTS) {
    history.shift();
  }
}

function clearChart() {
  history.length = 0;
  drawChart();
}

function drawChart() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#242424';
  ctx.lineWidth = 1;

  for (let i = 1; i < 5; i++) {
    const y = (h * i) / 5;

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (history.length < 2) return;

  const vals = history.map(p => p.v);

  let min = Math.min(...vals);
  let max = Math.max(...vals);

  if (max < 6) {
    min = 0;
    max = 5.5;
  } else if (max < 18) {
    min = 8;
    max = 16;
  } else if (max < 30) {
    min = 0;
    max = 30;
  } else {
    min = 0;
    max = 50;
  }

  const pad = 18;

  const xOf = (i) => {
    return pad + (w - pad * 2) * i / (MAX_POINTS - 1);
  };

  const yOf = (v) => {
    const y = h - pad - (h - pad * 2) * (v - min) / (max - min);
    return Math.max(pad, Math.min(h - pad, y));
  };

  ctx.strokeStyle = '#38ff7d';
  ctx.lineWidth = 3;
  ctx.beginPath();

  history.forEach((p, i) => {
    const x = xOf(Math.max(0, MAX_POINTS - history.length + i));
    const y = yOf(p.v);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  ctx.fillStyle = '#a9a9a9';
  ctx.font = '22px system-ui';
  ctx.fillText(max.toFixed(1) + ' V', 14, 30);
  ctx.fillText(min.toFixed(1) + ' V', 14, h - 12);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  voiceBtn.textContent = voiceEnabled ? 'VOZ: ON' : 'VOZ: OFF';

  if (voiceEnabled) {
    speakText('Voz activada');
  } else {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
  }
}

function speakIfNeeded(v) {
  if (!voiceEnabled) return;

  const now = Date.now();

  if (now - lastSpokenAt < 3000) return;

  lastSpokenAt = now;

  const value = v.toFixed(1).replace('.', ',');
  speakText(`${value} voltios`);
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;

  const msg = new SpeechSynthesisUtterance(text);

  const voices = speechSynthesis.getVoices();

  const preferredVoice =
    voices.find(v => v.lang === 'es-US') ||
    voices.find(v => v.lang && v.lang.startsWith('es')) ||
    null;

  if (preferredVoice) {
    msg.voice = preferredVoice;
    msg.lang = preferredVoice.lang;
  } else {
    msg.lang = 'es-US';
  }

  // Ajuste elegido en la prueba:
  // es-US, un poco más lenta y más grave.
  msg.rate = 0.92;
  msg.pitch = 0.75;

  speechSynthesis.cancel();
  speechSynthesis.speak(msg);
}

async function requestWakeLock() {
  if (!wakeBtn) return;

  if (!('wakeLock' in navigator)) {
    wakeBtn.textContent = 'PANTALLA: NO SOPORTADO';
    alert('Este navegador no soporta mantener la pantalla encendida.');
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request('screen');

    wakeLock.addEventListener('release', () => {
      wakeLock = null;

      if (wakeLockEnabled) {
        wakeBtn.textContent = 'PANTALLA: REINTENTAR';
      } else {
        wakeBtn.textContent = 'PANTALLA: OFF';
      }
    });

    wakeBtn.textContent = 'PANTALLA: ON';
  } catch (err) {
    console.error('No se pudo activar Wake Lock', err);
    wakeBtn.textContent = 'PANTALLA: ERROR';
  }
}

async function releaseWakeLock() {
  wakeLockEnabled = false;

  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch (err) {
      console.warn('Error liberando Wake Lock', err);
    }
  }

  wakeLock = null;

  if (wakeBtn) {
    wakeBtn.textContent = 'PANTALLA: OFF';
  }
}

async function toggleWakeLock() {
  wakeLockEnabled = !wakeLockEnabled;

  if (wakeLockEnabled) {
    await requestWakeLock();
  } else {
    await releaseWakeLock();
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLockEnabled && document.visibilityState === 'visible' && !wakeLock) {
    await requestWakeLock();
  }
});

connectBtn.addEventListener('click', connect);
voiceBtn.addEventListener('click', toggleVoice);

if (wakeBtn) {
  wakeBtn.addEventListener('click', toggleWakeLock);
}

clearBtn.addEventListener('click', clearChart);