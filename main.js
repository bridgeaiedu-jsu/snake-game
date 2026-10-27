const CANVAS_SIZE = 400;
const GRID = 20;                    // 20x20 격자
const CELL = CANVAS_SIZE / GRID;    // 한 칸 크기 (20px)
const LEVEL_SCORE = 50;             // 레벨업에 필요한 점수 간격
const SPEED_STEP = 10;              // 레벨업마다 줄어드는 이동 간격 (ms)
const MIN_TICK = 20;                // 이동 간격 최소값 (ms)
const STORAGE_KEY = 'snake-high-score';

// 화면 요소
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const levelEl = document.getElementById('level');
const difficultyEl = document.getElementById('difficulty');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const pauseBtn = document.getElementById('pause-btn');
const soundBtn = document.getElementById('sound-btn');

// 게임 상태
let snake;
let direction;      // 현재 이동 방향
let nextDirection;  // 다음 틱에 적용할 방향 (빠른 연타로 역방향 이동 방지)
let food;
let score;
let level;
let highScore = loadHighScore();
let timerId = null;
let playing = false;  // 게임 진행 중 여부 (일시정지 포함)
let paused = false;   // 일시정지 여부

// ---------- 소리 (Web Audio API로 효과음 직접 생성) ----------
let audioCtx = null;
let soundOn = true;

// 사용자 클릭 이후에 오디오 컨텍스트 생성 (브라우저 자동재생 정책)
function ensureAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

// 음 하나 재생: 주파수, 길이(초), 파형, 시작 지연(초), 음량, 끝 주파수(선택)
function playTone(freq, duration, type, delay, volume, endFreq) {
  if (!soundOn || !audioCtx) return;

  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);

  // 클릭 잡음을 막기 위해 짧게 페이드 인/아웃
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// 효과음 모음
const sounds = {
  start() {
    playTone(440, 0.1, 'triangle', 0, 0.2);
    playTone(660, 0.18, 'triangle', 0.1, 0.2);
  },
  levelUp() {
    playTone(523, 0.09, 'triangle', 0, 0.2);
    playTone(659, 0.09, 'triangle', 0.09, 0.2);
    playTone(784, 0.16, 'triangle', 0.18, 0.2);
  },
  eat() {
    playTone(660, 0.08, 'square', 0, 0.12);
    playTone(990, 0.12, 'square', 0.07, 0.12);
  },
  gameOver() {
    playTone(330, 0.25, 'sawtooth', 0, 0.18, 200);
    playTone(220, 0.25, 'sawtooth', 0.22, 0.18, 120);
    playTone(130, 0.5, 'sawtooth', 0.44, 0.18, 55);
  },
};

// 소리 켜기 / 끄기 버튼 표시 갱신
function updateSoundButton() {
  soundBtn.textContent = soundOn ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
}

// ---------- 최고 점수 ----------
function loadHighScore() {
  try {
    return parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function saveHighScore() {
  try {
    localStorage.setItem(STORAGE_KEY, String(highScore));
  } catch (e) {
    // 저장 불가 시 무시
  }
}

// 점수 표시 갱신
function updateScores() {
  scoreEl.textContent = score;
  levelEl.textContent = level;
  highScoreEl.textContent = highScore;
}

// 현재 이동 간격(ms): 선택한 난이도에서 레벨마다 SPEED_STEP씩 줄어듦
function getTickMs() {
  const base = parseInt(difficultyEl.value, 10);
  return Math.max(MIN_TICK, base - (level - 1) * SPEED_STEP);
}

// ---------- 게임 로직 ----------
// 먹이를 뱀이 없는 빈 칸에 배치 (빈 칸이 없으면 false)
function placeFood() {
  const free = [];
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return false;
  food = free[Math.floor(Math.random() * free.length)];
  return true;
}

// 게임 초기화
function resetGame() {
  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ];
  direction = { x: 1, y: 0 };
  nextDirection = direction;
  score = 0;
  level = 1;
  placeFood();
  updateScores();
}

// 게임 시작
function startGame() {
  ensureAudio();
  clearInterval(timerId);
  resetGame();
  startBtn.hidden = true;
  restartBtn.hidden = true;

  playing = true;
  paused = false;
  difficultyEl.disabled = true; // 게임 중에는 난이도 변경 불가
  pauseBtn.textContent = '일시정지';
  pauseBtn.hidden = false;

  sounds.start();
  draw();
  timerId = setInterval(tick, getTickMs());
}

// 일시정지 / 재개
function togglePause() {
  if (!playing) return;

  paused = !paused;
  if (paused) {
    clearInterval(timerId);
    timerId = null;
    pauseBtn.textContent = '재개';
    draw();
    drawPaused();
  } else {
    pauseBtn.textContent = '일시정지';
    timerId = setInterval(tick, getTickMs());
    draw();
  }
}

// 게임 오버
function gameOver() {
  clearInterval(timerId);
  timerId = null;
  playing = false;
  paused = false;
  difficultyEl.disabled = false;
  pauseBtn.hidden = true;
  sounds.gameOver();

  if (score > highScore) {
    highScore = score;
    saveHighScore();
    updateScores();
  }

  draw();
  drawGameOver();
  restartBtn.hidden = false;
}

// 한 틱: 뱀 이동 및 충돌 검사
function tick() {
  direction = nextDirection;
  const head = {
    x: snake[0].x + direction.x,
    y: snake[0].y + direction.y,
  };

  // 벽 충돌
  if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
    gameOver();
    return;
  }

  const ate = head.x === food.x && head.y === food.y;

  // 자기 몸 충돌 (먹이를 먹지 않으면 꼬리는 이번에 빠지므로 제외)
  const body = ate ? snake : snake.slice(0, -1);
  if (body.some((s) => s.x === head.x && s.y === head.y)) {
    gameOver();
    return;
  }

  snake.unshift(head);

  if (ate) {
    score += 10;
    if (score > highScore) {
      highScore = score;
      saveHighScore();
    }
    updateScores();
    sounds.eat();
    if (!placeFood()) {
      // 판이 가득 찬 경우 종료
      draw();
      gameOver();
      return;
    }

    // 레벨업: 50점마다 레벨이 오르고 이동 간격이 줄어듦
    const newLevel = Math.floor(score / LEVEL_SCORE) + 1;
    if (newLevel > level) {
      level = newLevel;
      updateScores();
      sounds.levelUp();
      clearInterval(timerId);
      timerId = setInterval(tick, getTickMs());
    }
  } else {
    snake.pop();
  }

  draw();
}

// ---------- 그래픽 ----------
// 모서리가 둥근 사각형 경로
function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 두 색(RGB 배열) 사이를 t(0~1)만큼 섞기
function mixColor(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// 배경: 어두운 바탕 + 체스판 무늬
function drawBoard() {
  const bg = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  bg.addColorStop(0, '#1b1838');
  bg.addColorStop(1, '#14122b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

// 먹이: 빛나는 구슬
function drawFood() {
  const cx = food.x * CELL + CELL / 2;
  const cy = food.y * CELL + CELL / 2;
  const r = CELL / 2 - 3;

  ctx.save();
  ctx.shadowColor = 'rgba(255, 93, 115, 0.9)';
  ctx.shadowBlur = 16;

  const grad = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r);
  grad.addColorStop(0, '#ffc2cb');
  grad.addColorStop(0.45, '#ff5d73');
  grad.addColorStop(1, '#c2243e');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 뱀: 머리에서 꼬리로 갈수록 색이 어두워지는 둥근 마디
function drawSnake() {
  const headColor = [167, 139, 250];
  const tailColor = [79, 95, 209];
  const pad = 1.5;

  ctx.save();
  ctx.shadowColor = 'rgba(124, 108, 240, 0.55)';
  ctx.shadowBlur = 10;

  // 꼬리부터 그려서 머리가 가장 위에 오도록
  for (let i = snake.length - 1; i >= 0; i--) {
    const s = snake[i];
    const t = snake.length > 1 ? i / (snake.length - 1) : 0;
    ctx.fillStyle = mixColor(headColor, tailColor, t);
    roundedRect(s.x * CELL + pad, s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 6);
    ctx.fill();
  }
  ctx.restore();

  drawEyes();
}

// 눈: 진행 방향 쪽에 두 개
function drawEyes() {
  const head = snake[0];
  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;
  const fx = direction.x * 4;      // 앞쪽 이동량
  const fy = direction.y * 4;
  const px = -direction.y * 4;     // 옆쪽(수직) 이동량
  const py = direction.x * 4;

  [-1, 1].forEach((side) => {
    const ex = cx + fx + px * side;
    const ey = cy + fy + py * side;

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1b1838';
    ctx.beginPath();
    ctx.arc(ex + direction.x, ey + direction.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

// 전체 화면 그리기
function draw() {
  drawBoard();
  drawFood();
  drawSnake();
}

// 게임 오버 화면
function drawGameOver() {
  ctx.fillStyle = 'rgba(12, 10, 32, 0.75)';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 38px "Malgun Gothic", sans-serif';
  ctx.fillText('게임 오버', CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 8);

  ctx.fillStyle = '#b4b9f5';
  ctx.font = '18px "Malgun Gothic", sans-serif';
  ctx.fillText(`점수 ${score}`, CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 28);
}

// 일시정지 화면
function drawPaused() {
  ctx.fillStyle = 'rgba(12, 10, 32, 0.6)';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 34px "Malgun Gothic", sans-serif';
  ctx.fillText('일시정지', CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 10);
}

// ---------- 입력 ----------
document.addEventListener('keydown', (e) => {
  const dirs = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
  };
  const next = dirs[e.key];
  if (!next) return;

  e.preventDefault(); // 방향키로 페이지가 스크롤되지 않도록

  if (!playing || paused) return; // 게임 중이 아니거나 일시정지 중이면 무시

  // 현재 방향의 반대 방향으로는 바로 꺾을 수 없음
  if (next.x === -direction.x && next.y === -direction.y) return;
  nextDirection = next;
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', togglePause);

soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  updateSoundButton();
  if (soundOn) {
    ensureAudio();
    playTone(660, 0.1, 'triangle', 0, 0.15); // 켰을 때 확인음
  }
});

// 첫 화면: 초기 상태를 그려 둠
resetGame();
draw();
updateSoundButton();
