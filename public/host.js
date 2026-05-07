// Host screen logic - shows the big game view on a TV / projector / shared screen.
// Players join on their phones via the QR code.

const socket = io();

const els = {
  qr:            document.getElementById('qr'),
  joinUrl:       document.getElementById('joinUrl'),
  playerCount:   document.getElementById('playerCount'),
  playerList:    document.getElementById('playerList'),
  statusBanner:  document.getElementById('statusBanner'),
  lives:         document.getElementById('lives'),
  boat:          document.getElementById('boat'),
  obstacle:      document.getElementById('obstacle'),
  progressFill:  document.getElementById('progressFill'),
  progressPct:   document.getElementById('progressPct'),
  phasePanel:    document.getElementById('phasePanel'),
  startBtn:      document.getElementById('startBtn'),
  resetBtn:      document.getElementById('resetBtn'),
  soundBtn:      document.getElementById('soundBtn'),
};

// Build the join URL + QR.
const joinUrl = `${location.origin}/play`;
els.joinUrl.textContent = joinUrl;

fetch('/qr')
  .then(r => r.text())
  .then(svg => { els.qr.innerHTML = svg; })
  .catch(() => { els.qr.textContent = `Go to ${joinUrl}`; });

socket.emit('joinHost');

els.startBtn.addEventListener('click', () => socket.emit('start'));
els.resetBtn.addEventListener('click', () => socket.emit('reset'));

// --- Audio (ambient water + short cue beeps). All synthesized with Web Audio
// so the repo stays self-contained (no audio files). ---
let audioCtx = null;
let water = null;     // { masterGain, stopWaves } handle for the ambient loop
let soundOn = true;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { /* ignore - audio is optional */ }
  }
  return audioCtx;
}

// Start the ambient "river" sound: pink-ish noise through a lowpass filter,
// gently modulated by a slow LFO + periodic "wave" swells. It's quiet
// enough to sit under speech and other cues.
function startWaterSound() {
  const ctx = ensureAudio();
  if (!ctx || water) return;

  // 2-second noise buffer, looped. Shaped toward low/mid frequencies to
  // approximate moving water rather than hiss.
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    // Simple 1-pole lowpass to turn white noise into something more watery.
    lastOut = (lastOut + 0.04 * white) / 1.04;
    data[i] = lastOut * 3.2;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 850;
  lowpass.Q.value = 0.4;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 80;

  // Slow LFO on the filter to create a breathing, wave-like quality.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.15; // ~ one swell every 6-7 seconds
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 250;
  lfo.connect(lfoGain).connect(lowpass.frequency);

  const master = ctx.createGain();
  master.gain.value = 0.08; // quiet background

  noise.connect(highpass).connect(lowpass).connect(master).connect(ctx.destination);

  noise.start();
  lfo.start();

  // Occasional "wave crash" swells - a short amplitude bump every few seconds.
  const swell = () => {
    if (!water) return;
    const now = ctx.currentTime;
    const g = master.gain;
    const base = 0.08;
    const peak = 0.14;
    g.cancelScheduledValues(now);
    g.setValueAtTime(base, now);
    g.linearRampToValueAtTime(peak, now + 0.6);
    g.linearRampToValueAtTime(base, now + 1.8);
  };
  const swellInterval = setInterval(swell, 4500 + Math.random() * 2500);

  water = {
    masterGain: master,
    stop() {
      clearInterval(swellInterval);
      try { noise.stop(); lfo.stop(); } catch (_) {}
    },
  };
}

function setSoundOn(on) {
  soundOn = on;
  if (els.soundBtn) {
    els.soundBtn.textContent = on ? '\uD83D\uDD0A SOUND ON' : '\uD83D\uDD07 SOUND OFF';
  }
  if (on) {
    startWaterSound();
  } else if (water) {
    water.stop();
    water = null;
  }
}

// Browsers require a user gesture before audio starts. We kick off the
// ambient track on the first click anywhere on the page.
document.addEventListener('click', () => {
  ensureAudio();
  if (soundOn) startWaterSound();
}, { once: true });

if (els.soundBtn) {
  els.soundBtn.addEventListener('click', () => setSoundOn(!soundOn));
}

function beep(freq, duration = 0.15, type = 'sine', vol = 0.2) {
  if (!soundOn) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = vol;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}

socket.on('fx', ({ kind }) => {
  if (kind === 'stroke') beep(520, 0.12, 'sine', 0.2);
  else if (kind === 'cheer') { beep(660, 0.15); setTimeout(() => beep(880, 0.2), 120); }
  else if (kind === 'bump')  { beep(180, 0.25, 'sawtooth', 0.25); }
  else if (kind === 'win')   {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.2), i * 150));
  }
});

// Render the big game state.
socket.on('state', (s) => {
  // Player roster
  els.playerCount.textContent = s.playerCount;
  els.playerList.innerHTML = '';
  for (const p of s.players) {
    const li = document.createElement('li');
    li.textContent = p.name;
    li.style.background = p.color;
    els.playerList.appendChild(li);
  }

  // Status banner
  els.statusBanner.textContent = s.message;
  els.statusBanner.classList.remove('ok','bad');
  if (s.state === 'won') els.statusBanner.classList.add('ok');
  if (s.state === 'lost') els.statusBanner.classList.add('bad');

  // Lives
  const lifeSpans = els.lives.querySelectorAll('.life');
  lifeSpans.forEach((el, i) => {
    el.classList.toggle('lost', i >= s.lives);
  });

  // Boat position (leave 10% of right edge for the finish flags)
  const pct = Math.max(0, Math.min(100, s.boatPosition));
  els.boat.style.left = `calc(${pct * 0.82}% + 10px)`;
  els.progressFill.style.width = pct + '%';
  els.progressPct.textContent = Math.round(pct);

  // Obstacle
  if (s.obstacle) {
    els.obstacle.classList.remove('hidden');
    els.obstacle.textContent = obstacleEmoji(s.obstacle.type);
  } else {
    els.obstacle.classList.add('hidden');
    els.obstacle.textContent = '';
  }

  // Phase panel
  renderPhasePanel(s);

  // Start button only enabled in waiting/won/lost
  const canStart = (s.state === 'waiting' || s.state === 'won' || s.state === 'lost') && s.playerCount > 0;
  els.startBtn.disabled = !canStart;
  els.startBtn.textContent = (s.state === 'won' || s.state === 'lost') ? 'PLAY AGAIN' : 'START';
});

function obstacleEmoji(type) {
  switch (type) {
    case 'rock':      return '\uD83E\uDEA8'; // rock
    case 'whirlpool': return '\uD83C\uDF00'; // cyclone
    case 'log':       return '\uD83E\uDEB5'; // wood
    case 'sandbar':   return '\uD83C\uDFDD\uFE0F'; // beach
    default:          return '\u26A0\uFE0F';
  }
}

function renderPhasePanel(s) {
  const p = els.phasePanel;
  p.innerHTML = '';
  if (s.state === 'waiting') {
    p.innerHTML = '<p class="help-line">Scan the QR code on the left to join. Up to 15 sailors.</p>';
    return;
  }
  if (s.state === 'rowing') {
    p.innerHTML = `
      <div style="font-size:2rem;font-weight:800;">\uD83D\uDEA3 ROW TOGETHER!</div>
      <div class="row-progress">
        <strong>${s.rowingProgress}</strong> of <strong>${s.rowingNeeded}</strong> sailors have rowed
      </div>
      <p class="help-line">Everyone on their phone: tap the big green ROW button.</p>`;
    return;
  }
  if (s.state === 'steering' && s.obstacle) {
    const dir = s.obstacle.correctDirection;
    const arrow = dir === 'left' ? '\u2B05\uFE0F' : '\u27A1\uFE0F';
    const count = s.obstacle.voteCounts[dir];
    p.innerHTML = `
      <div style="font-size:2rem;font-weight:800;">STEER ${dir.toUpperCase()}!</div>
      <div class="arrow">${arrow}</div>
      <div class="countdown">${s.obstacle.timeLeft}s</div>
      <div class="row-progress">
        <strong>${count}</strong> of <strong>${s.obstacle.voteNeeded}</strong> sailors steering ${dir}
      </div>`;
    return;
  }
  if (s.state === 'won') {
    p.innerHTML = `
      <div style="font-size:3rem;font-weight:900;">\uD83C\uDF89 YOU WON! \uD83C\uDF89</div>
      <p class="help-line">The boat safely reached the shore. Press PLAY AGAIN for another trip.</p>`;
    return;
  }
  if (s.state === 'lost') {
    p.innerHTML = `
      <div style="font-size:2rem;font-weight:900;">The boat sank... \uD83D\uDEA4</div>
      <p class="help-line">Don't worry - press PLAY AGAIN to try once more.</p>`;
  }
}
