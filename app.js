/*
  Probador Automotor BLE - PWA
  Mantiene Web Bluetooth GATT + notifications, voz y Wake Lock.
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
let frozen = false;
let selectedMode = 'volt';
let lastVoltage = NaN;
let lastRange = '--';

const history = [];
const MAX_POINTS = 300;

const modes = {
  volt: {
    icon: 'V', label: 'Voltímetro', title: 'Voltímetro', subtitle: 'Entrada amarilla · rango automático',
    mainLabel: 'Tensión actual', unit: 'V', vMin: 0, vMax: 16, timeMs: 12000, vScale: '2 V/div', tScale: '1 s/div'
  },
  crank: {
    icon: '↯', label: 'Arranque', title: 'Arranque', subtitle: 'Batería · caída · recuperación',
    mainLabel: 'Mínimo durante arranque', unit: 'V', vMin: 7, vMax: 16, timeMs: 5000, vScale: '1 V/div', tScale: '500 ms/div'
  },
  charge: {
    icon: '⎓', label: 'Carga', title: 'Carga alternador', subtitle: 'Motor en marcha · estabilidad de carga',
    mainLabel: 'Tensión de carga', unit: 'V', vMin: 11, vMax: 16, timeMs: 8000, vScale: '0.5 V/div', tScale: '1 s/div'
  },
  sensor: {
    icon: '0-5', label: 'Sensor', title: 'Sensor 0–5 V', subtitle: 'Sensores analógicos · posición · presión',
    mainLabel: 'Tensión sensor', unit: 'V', vMin: 0, vMax: 5, timeMs: 6000, vScale: '0.5 V/div', tScale: '500 ms/div'
  },
  pwm: {
    icon: '%', label: 'PWM', title: 'PWM / Duty', subtitle: 'Comando electrónico · ciclo útil',
    mainLabel: 'Duty', unit: '%', vMin: 0, vMax: 16, timeMs: 1000, vScale: '2 V/div', tScale: '100 ms/div'
  },
  inj: {
    icon: '▮', label: 'Inyector', title: 'Inyector', subtitle: 'Pulso · pico · duración',
    mainLabel: 'Tiempo de inyección', unit: 'ms', vMin: 0, vMax: 120, timeMs: 80, vScale: '20 V/div', tScale: '10 ms/div'
  },
  form: {
    icon: '▱', label: 'Forma', title: 'Forma de onda', subtitle: 'Captura de señal',
    mainLabel: 'Pico a pico', unit: 'V', vMin: null, vMax: null, timeMs: 5000, vScale: 'Auto V/div', tScale: '500 ms/div'
  },
  pulse: {
    icon: '#', label: 'Pulsos', title: 'Pulsos', subtitle: 'Conteo · intervalo · frecuencia',
    mainLabel: 'Pulsos contados', unit: '', vMin: 0, vMax: 16, timeMs: 3000, vScale: '2 V/div', tScale: '300 ms/div'
  }
};

const $ = (id) => document.getElementById(id);

const statusEl = $('status');
const connTextEl = $('connText');
const statusDotEl = $('statusDot');
const voltageEl = $('voltage');
const rangeEl = $('range');
const rangePillEl = $('rangePill');
const bleStateEl = $('bleState');

const connectBtn = $('connectBtn');
const voiceBtn = $('voiceBtn');
const wakeBtn = $('wakeBtn');
const freezeBtn = $('freezeBtn');
const autoBtn = $('autoBtn');

const lastRawEl = $('lastRaw');
const samplesEl = $('samples');
const connStateEl = $('connState');
const badgeEl = $('badge');

const canvas = $('chart');
const ctx = canvas.getContext('2d');

function setStatus(text, connected = false) {
  statusEl.textContent = text;
  connStateEl.textContent = connected ? 'Conectado' : text;
  connTextEl.textContent = connected ? 'Conectado' : 'Conectar';
  statusDotEl.className = connected ? 'dot on' : 'dot off';
  bleStateEl.textContent = connected ? 'activo' : 'inactivo';
  badgeEl.textContent = connected ? 'ON' : 'OFF';
  connectBtn.classList.toggle('connected', connected);
}

function formatVoltage(v) {
  if (!Number.isFinite(v)) return '--.--';
  if (Math.abs(v) < 10) return v.toFixed(2);
  if (Math.abs(v) < 100) return v.toFixed(1);
  return v.toFixed(0);
}

function formatMetric(v, unit = 'V', decimals = 2) {
  if (!Number.isFinite(v)) return '--';
  return `${v.toFixed(decimals)} ${unit}`;
}

function buildModes() {
  const box = $('modes');
  box.innerHTML = '';

  Object.entries(modes).forEach(([key, mode]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode';
    button.dataset.mode = key;
    button.innerHTML = `<span class="ico">${mode.icon}</span><span>${mode.label}</span>`;
    button.addEventListener('click', () => setMode(key));
    box.appendChild(button);
  });
}

function setMode(modeKey) {
  selectedMode = modeKey;
  frozen = false;
  freezeBtn.textContent = 'CONGELAR';
  freezeBtn.classList.remove('on');
  updateModeUi();
  updateReadout();
  drawChart();
}

function updateModeUi() {
  const mode = modes[selectedMode];
  $('modeTitle').textContent = mode.title;
  $('subTitle').textContent = mode.subtitle;
  $('mainLabel').textContent = mode.mainLabel;
  $('mainUnit').textContent = mode.unit;
  $('vScale').textContent = mode.vScale;
  $('tScale').textContent = mode.tScale;

  document.querySelectorAll('.mode').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === selectedMode);
  });
}

async function connect() {
  try {
    if (!('bluetooth' in navigator)) {
      setStatus('Web Bluetooth no disponible');
      alert('Usar Chrome en Android o Chrome/Edge en PC.');
      return;
    }

    setStatus('Buscando equipo...');

    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Volt_Taller' }],
      optionalServices: [SERVICE_UUID]
    });

    device.addEventListener('gattserverdisconnected', onDisconnected);

    await connectKnownDevice();
  } catch (err) {
    console.error(err);
    setStatus('Conexión cancelada');
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

    setStatus(device.name || 'Conectado', true);
  } catch (err) {
    console.error(err);
    setStatus('No se pudo conectar');
  } finally {
    reconnecting = false;
  }
}

function onDisconnected() {
  setStatus('Sin señal. Reintentando...');

  characteristic = null;
  server = null;

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

  setStatus('Sin señal');
}

function onData(event) {
  const text = new TextDecoder().decode(event.target.value).trim();
  lastRawEl.textContent = text;

  const packet = parsePacket(text);
  if (!packet || !Number.isFinite(packet.voltage)) return;

  sampleCount++;
  samplesEl.textContent = String(sampleCount);

  lastVoltage = packet.voltage;
  lastRange = packet.range || lastRange || '--';
  rangeEl.textContent = 'RANGO ' + lastRange;
  rangePillEl.textContent = 'Rango ' + lastRange;

  if (!frozen) {
    pushPoint(lastVoltage);
    updateReadout();
    drawChart();
  }

  speakIfNeeded(lastVoltage);
}

function parsePacket(text) {
  // Formato actual: "12.34,50V" o "12.34,50".
  // También acepta JSON futuro con {v, range}.
  try {
    if (text.startsWith('{')) {
      const obj = JSON.parse(text);
      const voltage = Number.parseFloat(obj.v ?? obj.voltage);
      return { voltage, range: obj.range || obj.rango || '--' };
    }
  } catch (err) {
    console.warn('Paquete JSON inválido', err);
  }

  const parts = text.split(',').map(p => p.trim());
  const voltage = Number.parseFloat(parts[0]);
  const range = parts[1] || '--';
  return { voltage, range };
}

function pushPoint(v) {
  history.push({ t: Date.now(), v });

  while (history.length > MAX_POINTS) {
    history.shift();
  }
}

function currentStats() {
  const mode = modes[selectedMode];
  const now = Date.now();
  const points = history.filter(p => now - p.t <= mode.timeMs);
  const list = points.length ? points : history;
  const values = list.map(p => p.v).filter(Number.isFinite);

  if (!values.length) {
    return { min: NaN, max: NaN, p2p: NaN, avg: NaN, points: list };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { min, max, p2p: max - min, avg, points: list };
}

function analyzePulses(points) {
  if (!points || points.length < 6) return null;

  const values = points.map(p => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const amp = max - min;

  if (amp < 0.25) return null;

  const highTh = min + amp * 0.60;
  const lowTh = min + amp * 0.40;

  let isHigh = values[0] > highTh;
  const rises = [];
  const falls = [];
  let highTime = 0;
  let lastT = points[0].t;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prevT = lastT;
    lastT = p.t;

    if (isHigh) highTime += Math.max(0, p.t - prevT);

    if (!isHigh && p.v >= highTh) {
      isHigh = true;
      rises.push(p.t);
    } else if (isHigh && p.v <= lowTh) {
      isHigh = false;
      falls.push(p.t);
    }
  }

  const durationMs = Math.max(1, points[points.length - 1].t - points[0].t);
  const duty = Math.max(0, Math.min(100, highTime * 100 / durationMs));

  let freq = NaN;
  if (rises.length >= 2) {
    const periods = [];
    for (let i = 1; i < rises.length; i++) periods.push(rises[i] - rises[i - 1]);
    const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
    if (avgPeriod > 0) freq = 1000 / avgPeriod;
  }

  let widthMs = NaN;
  if (rises.length && falls.length) {
    const widths = [];
    rises.forEach(r => {
      const f = falls.find(x => x > r);
      if (f) widths.push(f - r);
    });
    if (widths.length) widthMs = widths.reduce((a, b) => a + b, 0) / widths.length;
  }

  return { count: rises.length, duty, freq, widthMs, min, max };
}

function updateReadout() {
  const mode = modes[selectedMode];
  const stats = currentStats();
  const pulses = analyzePulses(stats.points);

  rangePillEl.textContent = lastRange && lastRange !== '--' ? 'Rango ' + lastRange : 'Rango --';

  let mainValue = lastVoltage;
  let sub = 'Esperando lectura';

  if (Number.isFinite(lastVoltage)) {
    sub = frozen ? 'Congelado' : 'Lectura activa';
  }

  if (selectedMode === 'crank') mainValue = stats.min;
  if (selectedMode === 'charge') mainValue = lastVoltage;
  if (selectedMode === 'sensor') mainValue = lastVoltage;
  if (selectedMode === 'form') mainValue = stats.p2p;
  if (selectedMode === 'pwm') mainValue = pulses ? pulses.duty : NaN;
  if (selectedMode === 'inj') mainValue = pulses ? pulses.widthMs : NaN;
  if (selectedMode === 'pulse') mainValue = pulses ? pulses.count : NaN;

  if (selectedMode === 'pulse') {
    voltageEl.textContent = Number.isFinite(mainValue) ? String(Math.round(mainValue)) : '--';
  } else if (selectedMode === 'pwm') {
    voltageEl.textContent = Number.isFinite(mainValue) ? mainValue.toFixed(1) : '--';
  } else if (selectedMode === 'inj') {
    voltageEl.textContent = Number.isFinite(mainValue) ? mainValue.toFixed(2) : '--';
  } else {
    voltageEl.textContent = formatVoltage(mainValue);
  }

  $('mainSub').textContent = sub;

  if (selectedMode === 'volt') {
    setMetrics([
      ['Mín', formatMetric(stats.min, 'V', 2)],
      ['Máx', formatMetric(stats.max, 'V', 2)],
      ['Pico', formatMetric(stats.p2p, 'V', 2)],
      ['Rango', lastRange || '--']
    ]);
  } else if (selectedMode === 'crank') {
    setMetrics([
      ['Reposo', formatMetric(stats.avg, 'V', 2)],
      ['Mínimo', formatMetric(stats.min, 'V', 2)],
      ['Máximo', formatMetric(stats.max, 'V', 2)],
      ['Tiempo', `${(mode.timeMs / 1000).toFixed(1)} s`]
    ]);
  } else if (selectedMode === 'charge') {
    setMetrics([
      ['Mín', formatMetric(stats.min, 'V', 2)],
      ['Máx', formatMetric(stats.max, 'V', 2)],
      ['Rizado', formatMetric(stats.p2p, 'V', 2)],
      ['Prom', formatMetric(stats.avg, 'V', 2)]
    ]);
  } else if (selectedMode === 'sensor') {
    setMetrics([
      ['Mín', formatMetric(stats.min, 'V', 2)],
      ['Máx', formatMetric(stats.max, 'V', 2)],
      ['Variación', formatMetric(stats.p2p, 'V', 2)],
      ['Rango', '5 V']
    ]);
  } else if (selectedMode === 'pwm') {
    setMetrics([
      ['Frecuencia', pulses && Number.isFinite(pulses.freq) ? `${pulses.freq.toFixed(1)} Hz` : '--'],
      ['Alto', pulses && Number.isFinite(pulses.widthMs) ? `${pulses.widthMs.toFixed(2)} ms` : '--'],
      ['Duty', pulses ? `${pulses.duty.toFixed(1)} %` : '--'],
      ['Nivel', formatMetric(stats.max, 'V', 1)]
    ]);
  } else if (selectedMode === 'inj') {
    setMetrics([
      ['Pico', formatMetric(stats.max, 'V', 1)],
      ['Base', formatMetric(stats.min, 'V', 1)],
      ['Tiempo', pulses && Number.isFinite(pulses.widthMs) ? `${pulses.widthMs.toFixed(2)} ms` : '--'],
      ['Pulsos', pulses ? String(pulses.count) : '--']
    ]);
  } else if (selectedMode === 'form') {
    setMetrics([
      ['Mín', formatMetric(stats.min, 'V', 2)],
      ['Máx', formatMetric(stats.max, 'V', 2)],
      ['Centro', formatMetric(stats.avg, 'V', 2)],
      ['Tiempo', `${(mode.timeMs / 1000).toFixed(1)} s`]
    ]);
  } else if (selectedMode === 'pulse') {
    setMetrics([
      ['Frecuencia', pulses && Number.isFinite(pulses.freq) ? `${pulses.freq.toFixed(1)} Hz` : '--'],
      ['Intervalo', pulses && Number.isFinite(pulses.freq) && pulses.freq > 0 ? `${(1000 / pulses.freq).toFixed(1)} ms` : '--'],
      ['Alto', formatMetric(stats.max, 'V', 1)],
      ['Bajo', formatMetric(stats.min, 'V', 1)]
    ]);
  }
}

function setMetrics(pairs) {
  pairs.forEach((pair, index) => {
    const n = index + 1;
    $(`m${n}k`).textContent = pair[0];
    $(`m${n}v`).textContent = pair[1];
  });
}

function autoScale() {
  clearChart();
}

function clearChart() {
  history.length = 0;
  sampleCount = 0;
  samplesEl.textContent = '0';
  updateReadout();
  drawChart();
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}

function chartBounds(points) {
  const mode = modes[selectedMode];
  let min = mode.vMin;
  let max = mode.vMax;

  if (min === null || max === null) {
    const values = points.map(p => p.v).filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 5 };

    min = Math.min(...values);
    max = Math.max(...values);
    const span = Math.max(0.5, max - min);
    min -= span * 0.15;
    max += span * 0.15;
  }

  if (Number.isFinite(lastVoltage) && selectedMode === 'volt') {
    if (lastVoltage > 16 && lastVoltage <= 32) { min = 0; max = 32; }
    if (lastVoltage > 32) { min = 0; max = 60; }
    if (lastVoltage <= 6) { min = 0; max = 5; }
  }

  if (max <= min) max = min + 1;
  return { min, max };
}

function drawChart() {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return;

  const mode = modes[selectedMode];
  const now = Date.now();
  const points = history.filter(p => now - p.t <= mode.timeMs);
  const data = points.length ? points : history;
  const bounds = chartBounds(data);

  drawGrid(w, h, bounds, mode.timeMs);
  drawMarkers(w, h, bounds);

  if (data.length < 2) return;

  const leftT = now - mode.timeMs;
  const xOf = (t) => {
    const clamped = Math.max(leftT, Math.min(now, t));
    return (clamped - leftT) * w / mode.timeMs;
  };

  const yOf = (v) => {
    const y = h - ((v - bounds.min) * h / (bounds.max - bounds.min));
    return Math.max(0, Math.min(h, y));
  };

  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(89,215,255,.95)';
  ctx.shadowColor = 'rgba(89,215,255,.35)';
  ctx.shadowBlur = 9;
  ctx.beginPath();

  data.forEach((p, i) => {
    const x = xOf(p.t);
    const y = yOf(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
  ctx.restore();
}

function drawGrid(w, h, bounds, timeMs) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#050b10';
  ctx.fillRect(0, 0, w, h);

  const majorX = 8;
  const majorY = 6;

  ctx.lineWidth = 1;

  for (let i = 0; i <= majorX * 5; i++) {
    const x = i * w / (majorX * 5);
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(89,215,255,.18)' : 'rgba(89,215,255,.055)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (let i = 0; i <= majorY * 5; i++) {
    const y = i * h / (majorY * 5);
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(89,215,255,.18)' : 'rgba(89,215,255,.055)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(232,241,248,.18)';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(232,241,248,.50)';
  ctx.font = '10px system-ui';
  ctx.textBaseline = 'top';

  for (let i = 0; i <= majorY; i++) {
    const value = bounds.max - (bounds.max - bounds.min) * i / majorY;
    const y = i * h / majorY;
    ctx.fillText(`${value.toFixed(value >= 10 ? 0 : 1)} V`, 7, Math.min(h - 15, y + 4));
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  for (let i = 1; i <= majorX; i++) {
    const t = (timeMs / 1000) * (majorX - i) / majorX;
    const x = i * w / majorX;
    ctx.fillText(`-${t.toFixed(t >= 10 ? 0 : 1)}s`, x - 4, h - 5);
  }
  ctx.textAlign = 'left';
}

function drawMarkers(w, h, bounds) {
  ctx.save();
  ctx.font = '10px system-ui';
  ctx.fillStyle = 'rgba(232,241,248,.58)';
  ctx.strokeStyle = 'rgba(142,231,166,.38)';
  ctx.setLineDash([5, 5]);

  const lineAt = (value, label) => {
    if (value < bounds.min || value > bounds.max) return;
    const y = h - ((value - bounds.min) * h / (bounds.max - bounds.min));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(label, 8, Math.max(5, y + 5));
  };

  if (selectedMode === 'volt') lineAt(12.6, '12.6 V');
  if (selectedMode === 'crank') {
    lineAt(12.6, '12.6 V');
    lineAt(10.0, '10.0 V');
  }
  if (selectedMode === 'charge') {
    lineAt(14.4, '14.4 V');
    lineAt(13.8, '13.8 V');
  }
  if (selectedMode === 'sensor') {
    lineAt(5.0, '5 V');
    lineAt(0.0, '0 V');
  }

  ctx.restore();
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  voiceBtn.textContent = voiceEnabled ? 'VOZ ON' : 'VOZ OFF';
  voiceBtn.classList.toggle('on', voiceEnabled);

  if (voiceEnabled) {
    speakText('Voz activada');
  } else if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
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

  msg.rate = 0.92;
  msg.pitch = 0.75;

  speechSynthesis.cancel();
  speechSynthesis.speak(msg);
}

async function requestWakeLock() {
  if (!wakeBtn) return;

  if (!('wakeLock' in navigator)) {
    wakeBtn.textContent = 'PANTALLA NO';
    alert('Este navegador no soporta mantener la pantalla encendida.');
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request('screen');

    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      wakeBtn.textContent = wakeLockEnabled ? 'PANTALLA RE' : 'PANTALLA OFF';
      wakeBtn.classList.toggle('on', wakeLockEnabled);
    });

    wakeBtn.textContent = 'PANTALLA ON';
    wakeBtn.classList.add('on');
  } catch (err) {
    console.error('No se pudo activar Wake Lock', err);
    wakeBtn.textContent = 'PANTALLA ERROR';
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
  wakeBtn.textContent = 'PANTALLA OFF';
  wakeBtn.classList.remove('on');
}

async function toggleWakeLock() {
  wakeLockEnabled = !wakeLockEnabled;

  if (wakeLockEnabled) await requestWakeLock();
  else await releaseWakeLock();
}

function toggleFreeze() {
  frozen = !frozen;
  freezeBtn.textContent = frozen ? 'SEGUIR' : 'CONGELAR';
  freezeBtn.classList.toggle('on', frozen);
  updateReadout();
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLockEnabled && document.visibilityState === 'visible' && !wakeLock) {
    await requestWakeLock();
  }
});

connectBtn.addEventListener('click', connect);
voiceBtn.addEventListener('click', toggleVoice);
wakeBtn.addEventListener('click', toggleWakeLock);
freezeBtn.addEventListener('click', toggleFreeze);
autoBtn.addEventListener('click', autoScale);

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));

buildModes();
updateModeUi();
updateReadout();
setStatus('Sin conectar');
resizeCanvas();
