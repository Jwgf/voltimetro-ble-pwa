/*
  Probador Automotor BLE - PWA
  Mantiene Web Bluetooth GATT + notifications, voz y Wake Lock.
*/

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const VOLT_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const CMD_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

let device = null;
let server = null;
let characteristic = null;
let commandCharacteristic = null;
let reconnecting = false;
let bleSessionId = 0;
let retryReconnectToken = 0;
let userWantsBleConnection = false;
let manualBleDisconnect = false;


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

let deferredInstallPrompt = null;
let installDismissed = false;
let priorityAudioUnlocked = false;
const priorityLastPlayed = Object.create(null);
const priorityAudioElements = Object.create(null);
let lastPulseAudioCount = 0;
let priorityEventsMutedUntil = 0;

const PRIORITY_AUDIO = {
  conectado: './audio/conectado.mp3',
  desconectado: './audio/desconectado.mp3',
  capturaLista: './audio/captura_lista.mp3',
  tensionBaja: './audio/tension_baja.mp3',
  tensionAlta: './audio/tension_alta.mp3',
  cargaNormal: './audio/carga_normal.mp3',
  cargaAlta: './audio/carga_alta.mp3',
  bateriaBaja: './audio/bateria_baja.mp3',
  arranqueDetectado: './audio/arranque_detectado.mp3',
  pulsoDetectado: './audio/pulso_detectado.mp3',
  senalPresente: './audio/senal_presente.mp3',
  sinSenal: './audio/sin_senal.mp3',
  modoVoltimetro: './audio/modo_voltimetro.mp3',
  modoArranque: './audio/modo_arranque.mp3',
  modoCarga: './audio/modo_carga.mp3',
  modoSensor: './audio/modo_sensor.mp3',
  modoPwm: './audio/modo_pwm.mp3',
  modoInyector: './audio/modo_inyector.mp3',
  modoForma: './audio/modo_forma.mp3',
  modoPulsos: './audio/modo_pulsos.mp3'
};

const MODE_AUDIO = {
  volt: 'modoVoltimetro',
  crank: 'modoArranque',
  charge: 'modoCarga',
  sensor: 'modoSensor',
  pwm: 'modoPwm',
  inj: 'modoInyector',
  form: 'modoForma',
  pulse: 'modoPulsos'
};

const MODE_COMMAND = {
  volt: 'MODE BATT',
  crank: 'MODE SUPPLY',
  charge: 'MODE SUPPLY',
  sensor: 'MODE SENSOR',
  pwm: 'MODE PWM',
  inj: 'MODE INJECTOR',
  form: 'MODE PIEZO',
  pulse: 'MODE CKP'
};


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
    mainLabel: 'Tiempo de inyección', unit: 'ms', vMin: 0, vMax: 50, timeMs: 4000, vScale: '10 V/div', tScale: '500 ms/div'
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

const chartOpenArea = $('chartOpenArea');
const chartOverlay = $('chartOverlay');
const fullCanvas = $('chartFull');
const fullCtx = fullCanvas.getContext('2d');
const fullClose = $('fullClose');
const fullClose2 = $('fullClose2');
const fullFreeze = $('fullFreeze');
const fullClear = $('fullClear');

const installBox = $('installBox');
const installBtn = $('installBtn');
const installClose = $('installClose');
const installTitle = $('installTitle');
const installText = $('installText');
const installHelp = $('installHelp');
const installHelpClose = $('installHelpClose');
const installHelpOk = $('installHelpOk');

let chartFullscreen = false;

function setStatus(text, connected = false) {
  statusEl.textContent = text;
  connStateEl.textContent = connected ? 'Conectado' : text;
  connTextEl.textContent = connected ? 'Desconectar' : 'Conectar';
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
  const changed = selectedMode !== modeKey;
  selectedMode = modeKey;
  frozen = false;
  freezeBtn.textContent = 'CONGELAR';
  freezeBtn.classList.remove('on');
  updateModeUi();
  updateReadout();
  drawChart();
  lastPulseAudioCount = 0;

  if (changed) {
    // Evita que un aviso de evento, por ejemplo "pulso detectado", se encime
    // con el aviso del modo recién seleccionado.
    priorityEventsMutedUntil = Date.now() + 2600;
    playPriorityAudio(MODE_AUDIO[modeKey], 2500);
  }

  sendModeCommand(modeKey);
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


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || 'Operacion BLE sin respuesta')), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function clearBleRuntimeHandles() {
  try {
    if (characteristic) {
      characteristic.removeEventListener('characteristicvaluechanged', onData);
    }
  } catch (err) {
    console.warn('No se pudo limpiar listener BLE anterior', err);
  }

  characteristic = null;
  commandCharacteristic = null;
  server = null;
}

function cancelBleReconnects() {
  retryReconnectToken++;
  reconnecting = false;
}

function disconnectGattQuietly() {
  try {
    if (device && device.gatt && device.gatt.connected) {
      device.gatt.disconnect();
    }
  } catch (err) {
    console.warn('No se pudo cerrar GATT anterior', err);
  }
}

function isBleConnected() {
  return !!(device && device.gatt && device.gatt.connected);
}

function removeDeviceDisconnectListener() {
  try {
    if (device) device.removeEventListener('gattserverdisconnected', onDisconnected);
  } catch (err) {
    console.warn('No se pudo quitar listener de desconexion BLE', err);
  }
}

function manualDisconnectBle() {
  userWantsBleConnection = false;
  manualBleDisconnect = true;
  bleSessionId++;
  cancelBleReconnects();
  removeDeviceDisconnectListener();
  disconnectGattQuietly();
  clearBleRuntimeHandles();
  device = null;
  connectBtn.disabled = false;
  setStatus('Sin conectar');
  setTimeout(() => { manualBleDisconnect = false; }, 300);
}

function prepareForManualConnect() {
  // Después de quedar mucho tiempo en segundo plano, Android/Chrome puede dejar
  // promesas BLE/reintentos en un estado viejo. Antes de abrir el selector BLE
  // limpiamos runtime y cancelamos reintentos, pero sin tocar pantalla, audios ni datos.
  bleSessionId++;
  cancelBleReconnects();
  removeDeviceDisconnectListener();
  disconnectGattQuietly();
  clearBleRuntimeHandles();
  device = null;
  connectBtn.disabled = false;
}

function normalizeBleStateAfterResume() {
  // Al volver desde pantalla apagada o desde el acceso directo, no confiamos en
  // reintentos pendientes. Si el usuario no pidio mantener la conexion, no
  // dejamos que una sesion vieja se reactive sola.
  connectBtn.disabled = false;

  if (!userWantsBleConnection) {
    if (isBleConnected()) {
      manualDisconnectBle();
    } else {
      bleSessionId++;
      cancelBleReconnects();
      clearBleRuntimeHandles();
      device = null;
      setStatus('Sin conectar');
    }
    return;
  }

  if (!device || !device.gatt || !device.gatt.connected) {
    bleSessionId++;
    cancelBleReconnects();
    clearBleRuntimeHandles();
    setStatus('Sin conectar');
    return;
  }

  setStatus(device.name || 'Conectado', true);
}

async function connect() {
  try {
    if (isBleConnected()) {
      manualDisconnectBle();
      return;
    }

    if (!('bluetooth' in navigator)) {
      setStatus('Web Bluetooth no disponible');
      alert('Usar Chrome en Android o Chrome/Edge en PC.');
      return;
    }

    userWantsBleConnection = true;
    manualBleDisconnect = false;
    prepareForManualConnect();
    userWantsBleConnection = true;
    const session = bleSessionId;

    setStatus('Buscando equipo...');

    const selectedDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Volt_Taller' }],
      optionalServices: [SERVICE_UUID]
    });

    if (session !== bleSessionId) return;

    device = selectedDevice;
    device.addEventListener('gattserverdisconnected', onDisconnected);

    await connectKnownDevice(session);
  } catch (err) {
    console.error(err);
    userWantsBleConnection = false;
    manualBleDisconnect = false;
    bleSessionId++;
    cancelBleReconnects();
    clearBleRuntimeHandles();
    device = null;
    connectBtn.disabled = false;
    setStatus('Conexión cancelada');
  }
}

async function connectKnownDevice(session = bleSessionId) {
  if (!device) return;
  if (!userWantsBleConnection) return;
  if (session !== bleSessionId) return;

  try {
    reconnecting = true;
    setStatus('Conectando BLE...');

    server = await withTimeout(device.gatt.connect(), 12000, 'Conexion BLE sin respuesta');
    if (session !== bleSessionId) return;

    const service = await withTimeout(server.getPrimaryService(SERVICE_UUID), 8000, 'Servicio BLE sin respuesta');
    if (session !== bleSessionId) return;

    characteristic = await withTimeout(service.getCharacteristic(VOLT_CHAR_UUID), 8000, 'Caracteristica de datos sin respuesta');
    if (session !== bleSessionId) return;

    try {
      commandCharacteristic = await withTimeout(service.getCharacteristic(CMD_CHAR_UUID), 5000, 'Caracteristica de comandos sin respuesta');
    } catch (cmdErr) {
      commandCharacteristic = null;
      console.warn('Característica BLE de comandos no disponible; la PWA seguirá funcionando sin control de modo.', cmdErr);
    }

    if (session !== bleSessionId) return;

    await withTimeout(characteristic.startNotifications(), 8000, 'Notificaciones BLE sin respuesta');
    characteristic.removeEventListener('characteristicvaluechanged', onData);
    characteristic.addEventListener('characteristicvaluechanged', onData);

    if (session !== bleSessionId) return;

    if (!userWantsBleConnection) return;
    setStatus(device.name || 'Conectado', true);
    playPriorityAudio('conectado', 3500);
    sendModeCommand(selectedMode);
  } catch (err) {
    console.error(err);
    if (session === bleSessionId) {
      clearBleRuntimeHandles();
      setStatus('No se pudo conectar');
    }
  } finally {
    if (session === bleSessionId) reconnecting = false;
  }
}

function onDisconnected() {
  const shouldReconnect = userWantsBleConnection && !manualBleDisconnect;

  setStatus('Sin conectar');

  if (shouldReconnect) {
    playPriorityAudio('desconectado', 3500);
  }

  clearBleRuntimeHandles();

  if (!shouldReconnect) {
    cancelBleReconnects();
    removeDeviceDisconnectListener();
    device = null;
    manualBleDisconnect = false;
    return;
  }

  // Solo reconectamos si la perdida fue inesperada y el usuario queria seguir
  // conectado. Si el usuario cancelo o desconecto manualmente, no se reconecta.
  if (document.visibilityState !== 'visible') {
    cancelBleReconnects();
    return;
  }

  retryReconnect(++retryReconnectToken, bleSessionId);
}

async function retryReconnect(token = retryReconnectToken, session = bleSessionId) {
  if (reconnecting || !device || !userWantsBleConnection) return;

  for (let i = 0; i < 10; i++) {
    if (token !== retryReconnectToken || session !== bleSessionId || !userWantsBleConnection) return;
    if (document.visibilityState !== 'visible') return;

    try {
      await sleep(1000);

      if (token !== retryReconnectToken || session !== bleSessionId || !userWantsBleConnection) return;
      if (device.gatt && device.gatt.connected) return;

      await connectKnownDevice(session);

      if (device.gatt && device.gatt.connected) return;
    } catch (err) {
      console.warn('Reintento BLE falló', i + 1, err);
    }
  }

  if (token === retryReconnectToken && session === bleSessionId) {
    reconnecting = false;
    setStatus('Sin conectar');
  }
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
  handlePriorityEvents();
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

function metricTone(label) {
  const normalized = String(label || '').toLowerCase();
  if (normalized.startsWith('mín') || normalized.startsWith('min') || normalized.includes('bajo')) return 'min';
  if (normalized.startsWith('máx') || normalized.startsWith('max') || normalized.includes('alto')) return 'max';
  if (normalized.includes('pico') || normalized.includes('rizado') || normalized.includes('variación')) return 'pico';
  return '';
}

function setMetrics(pairs) {
  pairs.forEach((pair, index) => {
    const n = index + 1;
    const box = $(`m${n}k`).closest('.metric');
    box.classList.remove('min', 'max', 'pico');
    const tone = metricTone(pair[0]);
    if (tone) box.classList.add(tone);
    $(`m${n}k`).textContent = pair[0];
    $(`m${n}v`).textContent = pair[1];
  });

  updateFullMetrics();
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

function resizeOneCanvas(targetCanvas, targetCtx) {
  const dpr = window.devicePixelRatio || 1;
  const rect = targetCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width;
    targetCanvas.height = height;
  }

  targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeCanvas() {
  resizeOneCanvas(canvas, ctx);
  drawChart();

  if (chartFullscreen) {
    resizeOneCanvas(fullCanvas, fullCtx);
    drawFullChart();
  }
}

function scheduleCanvasResizeAfterResume() {
  // Parche conservador: al volver de pantalla apagada Android puede tardar
  // un poco en estabilizar el tamaño del contenedor del canvas. No cambiamos
  // la lógica de dibujo: sólo pedimos varios resize normales, como si el
  // usuario rotara o cambiara tamaño de ventana.
  requestAnimationFrame(resizeCanvas);
  [120, 350, 800, 1500].forEach(delay => {
    setTimeout(resizeCanvas, delay);
  });
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
  drawChartOn(canvas, ctx, false);
  if (chartFullscreen) drawFullChart();
}

function drawFullChart() {
  drawChartOn(fullCanvas, fullCtx, true);
}

function visibleData() {
  const mode = modes[selectedMode];
  const now = Date.now();
  const points = history.filter(p => now - p.t <= mode.timeMs);
  return { now, mode, data: points.length ? points : history };
}

function drawChartOn(targetCanvas, targetCtx, isFull = false) {
  const rect = targetCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return;

  const { now, mode, data } = visibleData();
  const bounds = chartBounds(data);

  drawGridOn(targetCtx, w, h, bounds, mode.timeMs, isFull);
  drawMinMaxMarkersOn(targetCtx, w, h, bounds);
  drawReferenceMarkersOn(targetCtx, w, h, bounds);

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

  targetCtx.save();
  targetCtx.lineWidth = isFull ? 2.8 : 2.4;
  targetCtx.strokeStyle = 'rgba(89,215,255,.95)';
  targetCtx.shadowColor = 'rgba(89,215,255,.35)';
  targetCtx.shadowBlur = isFull ? 12 : 9;
  targetCtx.beginPath();

  data.forEach((p, i) => {
    const x = xOf(p.t);
    const y = yOf(p.v);
    if (i === 0) targetCtx.moveTo(x, y);
    else targetCtx.lineTo(x, y);
  });

  targetCtx.stroke();
  targetCtx.restore();
}

function drawGridOn(targetCtx, w, h, bounds, timeMs, isFull = false) {
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.fillStyle = '#050b10';
  targetCtx.fillRect(0, 0, w, h);

  const majorX = isFull ? 10 : 8;
  const majorY = isFull ? 8 : 6;

  targetCtx.lineWidth = 1;

  for (let i = 0; i <= majorX * 5; i++) {
    const x = i * w / (majorX * 5);
    targetCtx.strokeStyle = i % 5 === 0 ? 'rgba(89,215,255,.18)' : 'rgba(89,215,255,.055)';
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x, h);
    targetCtx.stroke();
  }

  for (let i = 0; i <= majorY * 5; i++) {
    const y = i * h / (majorY * 5);
    targetCtx.strokeStyle = i % 5 === 0 ? 'rgba(89,215,255,.18)' : 'rgba(89,215,255,.055)';
    targetCtx.beginPath();
    targetCtx.moveTo(0, y);
    targetCtx.lineTo(w, y);
    targetCtx.stroke();
  }

  targetCtx.strokeStyle = 'rgba(232,241,248,.18)';
  targetCtx.beginPath();
  targetCtx.moveTo(0, h / 2);
  targetCtx.lineTo(w, h / 2);
  targetCtx.stroke();

  targetCtx.fillStyle = 'rgba(232,241,248,.50)';
  targetCtx.font = isFull ? '11px system-ui' : '10px system-ui';
  targetCtx.textBaseline = 'top';
  targetCtx.textAlign = 'left';

  for (let i = 0; i <= majorY; i++) {
    const value = bounds.max - (bounds.max - bounds.min) * i / majorY;
    const y = i * h / majorY;
    targetCtx.fillText(`${value.toFixed(value >= 10 ? 0 : 1)} V`, 7, Math.min(h - 15, y + 4));
  }

  targetCtx.textAlign = 'right';
  targetCtx.textBaseline = 'bottom';
  for (let i = 1; i <= majorX; i++) {
    const t = (timeMs / 1000) * (majorX - i) / majorX;
    const x = i * w / majorX;
    targetCtx.fillText(`-${t.toFixed(t >= 10 ? 0 : 1)}s`, x - 4, h - 5);
  }
  targetCtx.textAlign = 'left';
}

function lineY(value, h, bounds) {
  return h - ((value - bounds.min) * h / (bounds.max - bounds.min));
}

function drawHorizontalDashedLine(targetCtx, w, y, color, width = 1.3) {
  targetCtx.save();
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = width;
  targetCtx.setLineDash([6, 7]);
  targetCtx.beginPath();
  targetCtx.moveTo(0, y);
  targetCtx.lineTo(w, y);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawMinMaxMarkersOn(targetCtx, w, h, bounds) {
  const stats = currentStats();
  if (!Number.isFinite(stats.min) || !Number.isFinite(stats.max)) return;

  if (stats.max >= bounds.min && stats.max <= bounds.max) {
    drawHorizontalDashedLine(targetCtx, w, lineY(stats.max, h, bounds), 'rgba(255,107,107,.72)', 1.4);
  }

  if (stats.min >= bounds.min && stats.min <= bounds.max && Math.abs(stats.max - stats.min) > 0.02) {
    drawHorizontalDashedLine(targetCtx, w, lineY(stats.min, h, bounds), 'rgba(92,169,255,.72)', 1.4);
  }
}

function drawReferenceMarkersOn(targetCtx, w, h, bounds) {
  const values = [];

  if (selectedMode === 'volt') values.push(12.6);
  if (selectedMode === 'crank') values.push(12.6, 10.0);
  if (selectedMode === 'charge') values.push(14.4, 13.8);
  if (selectedMode === 'sensor') values.push(5.0, 0.0);

  targetCtx.save();
  targetCtx.strokeStyle = 'rgba(142,231,166,.24)';
  targetCtx.lineWidth = 1;
  targetCtx.setLineDash([3, 7]);

  values.forEach(value => {
    if (value < bounds.min || value > bounds.max) return;
    const y = lineY(value, h, bounds);
    targetCtx.beginPath();
    targetCtx.moveTo(0, y);
    targetCtx.lineTo(w, y);
    targetCtx.stroke();
  });

  targetCtx.restore();
}

function updateFullMetrics() {
  if (!$('fullMin')) return;
  const stats = currentStats();
  $('fullTitle').textContent = modes[selectedMode].title;
  $('fullSub').textContent = modes[selectedMode].subtitle;
  $('fullMin').textContent = formatMetric(stats.min, 'V', 2);
  $('fullMax').textContent = formatMetric(stats.max, 'V', 2);
  $('fullPico').textContent = formatMetric(stats.p2p, 'V', 2);
  $('fullExtraLabel').textContent = selectedMode === 'pulse' ? 'Pulsos' : 'Rango';
  $('fullExtra').textContent = selectedMode === 'pulse' ? ($('m1v').textContent || '--') : (lastRange || '--');
  fullFreeze.textContent = frozen ? 'SEGUIR' : 'CONGELAR';
  fullFreeze.classList.toggle('on', frozen);
}

function openFullChart() {
  if (chartFullscreen) return;
  chartFullscreen = true;
  chartOverlay.classList.add('active');
  chartOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('chart-open');
  updateFullMetrics();
  [30, 180].forEach(delay => {
    setTimeout(() => {
      resizeOneCanvas(fullCanvas, fullCtx);
      drawFullChart();
    }, delay);
  });
}

function closeFullChart() {
  if (!chartFullscreen) return;
  chartFullscreen = false;
  chartOverlay.classList.remove('active');
  chartOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('chart-open');
}

function handleChartAreaKey(event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openFullChart();
  }
}


function commandForMode(modeKey) {
  return MODE_COMMAND[modeKey] || null;
}

async function sendBleCommand(text) {
  if (!text || !commandCharacteristic) return false;

  try {
    const payload = new TextEncoder().encode(text.trim() + '\n');

    if (typeof commandCharacteristic.writeValueWithoutResponse === 'function') {
      await commandCharacteristic.writeValueWithoutResponse(payload);
    } else if (typeof commandCharacteristic.writeValueWithResponse === 'function') {
      await commandCharacteristic.writeValueWithResponse(payload);
    } else {
      await commandCharacteristic.writeValue(payload);
    }

    console.log('Comando BLE enviado:', text);
    return true;
  } catch (err) {
    console.warn('No se pudo enviar comando BLE:', text, err);
    return false;
  }
}

function sendModeCommand(modeKey) {
  const command = commandForMode(modeKey);
  if (!command) return;
  // Intencionalmente no esperamos la promesa: el cambio visual de pantalla no debe depender del firmware.
  sendBleCommand(command);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  voiceBtn.textContent = voiceEnabled ? 'VOZ ON' : 'VOZ OFF';
  voiceBtn.classList.toggle('on', voiceEnabled);

  if (voiceEnabled) {
    stopPriorityAudio();
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
  updateFullMetrics();
  if (frozen) playPriorityAudio('capturaLista', 2500);
}


function preloadPriorityAudio() {
  Object.entries(PRIORITY_AUDIO).forEach(([key, src]) => {
    if (!priorityAudioElements[key]) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = 1;
      priorityAudioElements[key] = audio;
    }
  });
}

function unlockPriorityAudio() {
  if (priorityAudioUnlocked) return;
  priorityAudioUnlocked = true;
  preloadPriorityAudio();
}

function stopPriorityAudio() {
  Object.values(priorityAudioElements).forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (err) {
      console.warn('No se pudo detener audio prioritario', err);
    }
  });
}

async function playPriorityAudio(key, minGapMs = 5000) {
  if (!key || voiceEnabled) return;
  unlockPriorityAudio();

  const src = PRIORITY_AUDIO[key];
  if (!src) return;

  const now = Date.now();
  if (priorityLastPlayed[key] && now - priorityLastPlayed[key] < minGapMs) return;
  priorityLastPlayed[key] = now;

  try {
    stopPriorityAudio();
    const audio = priorityAudioElements[key] || new Audio(src);
    priorityAudioElements[key] = audio;
    audio.currentTime = 0;
    await audio.play();
  } catch (err) {
    // El navegador puede bloquear audio hasta que haya una acción del usuario.
    console.warn('Audio prioritario bloqueado o no disponible:', key, err);
  }
}

function handlePriorityEvents() {
  if (voiceEnabled || !Number.isFinite(lastVoltage)) return;
  if (Date.now() < priorityEventsMutedUntil) return;

  const stats = currentStats();
  const pulses = analyzePulses(stats.points);

  if (selectedMode === 'crank' && Number.isFinite(stats.min) && stats.min < 10.0) {
    playPriorityAudio('bateriaBaja', 15000);
  }

  if (selectedMode === 'charge') {
    if (lastVoltage > 15.0) {
      playPriorityAudio('cargaAlta', 15000);
    } else if (lastVoltage >= 13.3 && lastVoltage <= 14.8) {
      playPriorityAudio('cargaNormal', 30000);
    }
  }

  if (['pwm', 'inj', 'pulse'].includes(selectedMode) && pulses && pulses.count > lastPulseAudioCount) {
    playPriorityAudio('pulsoDetectado', 5000);
  }

  if (pulses) lastPulseAudioCount = pulses.count;
}

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

function showInstallBox({ title = 'Instalar acceso directo', text = 'Abrí el instrumento desde el ícono del celular.' } = {}) {
  if (!installBox || installDismissed || isStandalonePwa()) return;
  installTitle.textContent = title;
  installText.textContent = text;
  installBox.classList.remove('hidden');
}

function hideInstallBox() {
  if (installBox) installBox.classList.add('hidden');
}

function openInstallHelp() {
  if (!installHelp) return;
  installHelp.classList.add('active');
  installHelp.setAttribute('aria-hidden', 'false');
}

function closeInstallHelp() {
  if (!installHelp) return;
  installHelp.classList.remove('active');
  installHelp.setAttribute('aria-hidden', 'true');
}

async function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch (err) {
      console.warn('Instalación PWA sin respuesta final', err);
    }
    deferredInstallPrompt = null;
    hideInstallBox();
    return;
  }

  if (isIOSDevice()) openInstallHelp();
}

function setupInstallPrompt() {
  if (isStandalonePwa()) {
    hideInstallBox();
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallBox();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallBox();
  });

  if (isIOSDevice()) {
    setTimeout(() => showInstallBox({
      title: 'Instalar en iPhone',
      text: 'Safari: Compartir → Agregar a pantalla de inicio.'
    }), 900);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    scheduleCanvasResizeAfterResume();
    normalizeBleStateAfterResume();
  } else {
    cancelBleReconnects();
  }

  if (wakeLockEnabled && document.visibilityState === 'visible' && !wakeLock) {
    await requestWakeLock();
  }
});

window.addEventListener('focus', () => {
  scheduleCanvasResizeAfterResume();
  normalizeBleStateAfterResume();
});

window.addEventListener('pageshow', () => {
  scheduleCanvasResizeAfterResume();
  normalizeBleStateAfterResume();
});

document.addEventListener('pointerdown', unlockPriorityAudio, { once: true });
installBtn?.addEventListener('click', handleInstallClick);
installClose?.addEventListener('click', () => { installDismissed = true; hideInstallBox(); });
installHelpClose?.addEventListener('click', closeInstallHelp);
installHelpOk?.addEventListener('click', closeInstallHelp);
installHelp?.addEventListener('click', (event) => { if (event.target === installHelp) closeInstallHelp(); });

connectBtn.addEventListener('click', connect);
voiceBtn.addEventListener('click', toggleVoice);
wakeBtn.addEventListener('click', toggleWakeLock);
freezeBtn.addEventListener('click', toggleFreeze);
autoBtn.addEventListener('click', autoScale);
chartOpenArea.addEventListener('click', openFullChart);
chartOpenArea.addEventListener('keydown', handleChartAreaKey);
fullClose.addEventListener('click', closeFullChart);
fullClose2.addEventListener('click', closeFullChart);
fullFreeze.addEventListener('click', toggleFreeze);
fullClear.addEventListener('click', clearChart);
chartOverlay.addEventListener('click', (event) => { if (event.target === chartOverlay) closeFullChart(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeFullChart(); });

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));

preloadPriorityAudio();
setupInstallPrompt();
buildModes();
updateModeUi();
updateReadout();
setStatus('Sin conectar');
resizeCanvas();
