// Player controller (runs on phones). One job: show one big button the player
// needs to tap right now. Kept deliberately simple - no scrolling, no menus.

const socket = io();

const els = {
  header:       document.getElementById('playerHeader'),
  joinScreen:   document.getElementById('joinScreen'),
  playScreen:   document.getElementById('playScreen'),
  nameInput:    document.getElementById('nameInput'),
  joinBtn:      document.getElementById('joinBtn'),
  joinError:    document.getElementById('joinError'),
  youName:      document.getElementById('youName'),
  statusBanner: document.getElementById('statusBanner'),
  actionArea:   document.getElementById('actionArea'),
  miniStatus:   document.getElementById('miniStatus'),
};

let me = null;        // { id, name, color }
let lastState = null;
let rowTappedThisStroke = false;
let steerVoted = null;

els.joinBtn.addEventListener('click', joinGame);
els.nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGame();
});

function joinGame() {
  const name = (els.nameInput.value || '').trim();
  socket.emit('joinPlayer', name);
}

socket.on('joinError', (msg) => { els.joinError.textContent = msg; });

socket.on('joined', (player) => {
  me = player;
  els.joinScreen.classList.add('hidden');
  els.playScreen.classList.remove('hidden');
  els.youName.textContent = player.name;
  els.youName.style.color = player.color;
  els.header.style.background = player.color;
});

// Short vibrate on feedback events (where supported).
function buzz(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
}

socket.on('fx', ({ kind }) => {
  if (kind === 'stroke') buzz(60);
  else if (kind === 'bump') buzz([80, 50, 80]);
  else if (kind === 'cheer') buzz(120);
  else if (kind === 'win') buzz([100, 60, 100, 60, 200]);
});

socket.on('state', (s) => {
  lastState = s;
  if (!me) return;

  // Show or clear the "You are X" banner.
  els.statusBanner.textContent = s.message;
  els.statusBanner.classList.remove('ok','bad');
  if (s.state === 'won') els.statusBanner.classList.add('ok');
  if (s.state === 'lost') els.statusBanner.classList.add('bad');

  // Reset our local per-round flags when the phase changes.
  if (s.state !== 'rowing') rowTappedThisStroke = false;
  if (s.state !== 'steering') steerVoted = null;

  renderAction(s);
  renderMini(s);
});

function renderAction(s) {
  els.actionArea.innerHTML = '';

  if (s.state === 'waiting') {
    const msg = document.createElement('p');
    msg.className = 'help-line';
    msg.innerHTML = `You are onboard. ${s.playerCount} of ${s.maxPlayers} sailors joined.<br>Wait for the host to press START.`;
    msg.style.fontSize = '1.3rem';
    els.actionArea.appendChild(msg);
    return;
  }

  if (s.state === 'rowing') {
    const btn = document.createElement('button');
    btn.className = 'huge-btn';
    btn.textContent = rowTappedThisStroke ? 'NICE! Wait for others...' : 'ROW!';
    btn.disabled = rowTappedThisStroke;
    if (rowTappedThisStroke) btn.classList.add('tapped');
    btn.addEventListener('click', () => {
      if (rowTappedThisStroke) return;
      rowTappedThisStroke = true;
      socket.emit('row');
      buzz(40);
      renderAction(lastState); // Re-render to show "wait" state immediately.
    });
    els.actionArea.appendChild(btn);
    return;
  }

  if (s.state === 'steering') {
    const wrap = document.createElement('div');
    wrap.className = 'two-buttons';

    const left = makeSteerBtn('left',  '\u2B05\uFE0F');
    const right = makeSteerBtn('right', '\u27A1\uFE0F');
    wrap.appendChild(left);
    wrap.appendChild(right);
    els.actionArea.appendChild(wrap);
    return;
  }

  if (s.state === 'won' || s.state === 'lost') {
    const msg = document.createElement('p');
    msg.className = 'help-line';
    msg.style.fontSize = '1.4rem';
    msg.textContent = s.state === 'won'
      ? 'You made it! Great teamwork.'
      : 'Better luck next time. The host can start a new trip.';
    els.actionArea.appendChild(msg);
  }
}

function makeSteerBtn(direction, label) {
  const btn = document.createElement('button');
  btn.className = 'huge-btn ' + direction;
  btn.textContent = label;
  const locked = (steerVoted !== null);
  if (locked) {
    btn.disabled = true;
    if (steerVoted === direction) btn.classList.add('tapped');
  }
  btn.addEventListener('click', () => {
    if (steerVoted !== null) return;
    steerVoted = direction;
    socket.emit('steer', direction);
    buzz(40);
    renderAction(lastState);
  });
  return btn;
}

function renderMini(s) {
  if (s.state === 'rowing') {
    els.miniStatus.textContent = `Rowing: ${s.rowingProgress}/${s.rowingNeeded} sailors ready`;
  } else if (s.state === 'steering' && s.obstacle) {
    const counts = s.obstacle.voteCounts;
    els.miniStatus.textContent = `Left: ${counts.left}  Right: ${counts.right}  (need ${s.obstacle.voteNeeded}) — check the big screen!`;
  } else {
    els.miniStatus.textContent = '';
  }
}
