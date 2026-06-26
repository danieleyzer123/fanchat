(function () {
  const ONBOARDING_KEY = 'fanchat-onboarded-v2';

  /* ---------------- SAFETY ONBOARDING ---------------- */
  let pollerRunning = false;
  function startCheckboxPoller() {
    if (pollerRunning) return;
    pollerRunning = true;
    function tick() {
      const modal = document.getElementById('safetyModal');
      if (!modal || modal.hidden || modal.style.display === 'none') {
        pollerRunning = false;
        return;
      }
      const ageCheck = document.getElementById('ageConfirm');
      const ageNext = document.querySelector('[data-safety-step="1"] .safety-next');
      if (ageCheck && ageNext) ageNext.disabled = !ageCheck.checked;
      const rulesCheck = document.getElementById('rulesConfirm');
      const rulesNext = document.querySelector('[data-safety-step="2"] .safety-next');
      if (rulesCheck && rulesNext) rulesNext.disabled = !rulesCheck.checked;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function showSafety() {
    const modal = document.getElementById('safetyModal');
    modal.hidden = false;
    modal.style.display = '';
    document.body.classList.add('modal-open');
    goToStep(1);
    initSafetyHandlers();
    initFanTest();
    startCheckboxPoller();
  }
  function hideSafety() {
    const modal = document.getElementById('safetyModal');
    if (modal) {
      modal.hidden = true;
      modal.style.display = 'none';
    }
    document.body.classList.remove('modal-open');
  }
  function goToStep(n) {
    document.querySelectorAll('.safety-step').forEach(s => s.hidden = true);
    const step = document.querySelector(`[data-safety-step="${n}"]`);
    if (step) step.hidden = false;
    document.querySelectorAll('.safety-progress .dot').forEach((d, i) => {
      d.classList.toggle('active', i + 1 <= n);
    });
  }
  function initSafetyHandlers() {
    const ageCheck = document.getElementById('ageConfirm');
    const ageNext = document.querySelector('[data-safety-step="1"] .safety-next');
    function syncAge() { ageNext.disabled = !ageCheck.checked; }
    ageCheck.onchange = syncAge;
    ageCheck.oninput = syncAge;
    ageNext.onclick = function () {
      if (!ageCheck.checked) return;
      goToStep(2);
    };
    syncAge();

    const rulesCheck = document.getElementById('rulesConfirm');
    const rulesNext = document.querySelector('[data-safety-step="2"] .safety-next');
    function syncRules() { rulesNext.disabled = !rulesCheck.checked; }
    rulesCheck.onchange = syncRules;
    rulesCheck.oninput = syncRules;
    rulesNext.onclick = function () {
      if (!rulesCheck.checked) return;
      goToStep(3);
    };
    syncRules();

    document.querySelectorAll('.safety-back[data-go]').forEach(btn => {
      btn.onclick = function () { goToStep(parseInt(btn.dataset.go, 10)); };
    });
  }

  /* ---------------- FAN TEST ---------------- */
  let fanState = { current: 0, score: 0, questions: [] };
  function pickFanQuestions() {
    const pool = [...window.FAN_QUESTIONS];
    const picked = [];
    while (picked.length < 1 && pool.length > 0) {
      const i = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(i, 1)[0]);
    }
    return picked;
  }
  function initFanTest() {
    fanState = { current: 0, score: 0, questions: pickFanQuestions() };
    document.getElementById('fanTestArea').hidden = false;
    document.getElementById('fanResult').hidden = true;
    renderFanQuestion();
  }
  function renderFanQuestion() {
    const q = fanState.questions[fanState.current];
    if (!q) return showFanResult();
    document.getElementById('fanQNum').textContent = fanState.current + 1;
    document.getElementById('fanScore').textContent = fanState.score;
    document.getElementById('fanQText').textContent = q.q;
    const opts = document.getElementById('fanQOptions');
    opts.innerHTML = '';
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'q-opt';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        if (btn._answered) return;
        btn._answered = true;
        const isCorrect = idx === q.correct;
        opts.querySelectorAll('.q-opt').forEach((b, bi) => {
          b._answered = true;
          if (bi === q.correct) b.classList.add('correct');
          else if (bi === idx) b.classList.add('wrong');
          b.disabled = true;
        });
        if (isCorrect) fanState.score++;
        setTimeout(() => {
          fanState.current++;
          if (fanState.current >= fanState.questions.length) {
            showFanResult();
          } else {
            renderFanQuestion();
          }
        }, 900);
      });
      opts.appendChild(btn);
    });
  }
  function showFanResult() {
    document.getElementById('fanTestArea').hidden = true;
    const result = document.getElementById('fanResult');
    result.hidden = false;
    const passed = fanState.score >= 1;

    document.getElementById('fanResultIcon').textContent = passed ? '🏆' : '😬';
    document.getElementById('fanResultTitle').textContent = passed
      ? 'מצוין!'
      : 'אופס...';
    document.getElementById('fanResultText').textContent = passed
      ? 'אתה אוהד אמיתי. ברוך הבא ל-FANCHAT!'
      : 'התשובה לא נכונה. נסה שוב!';

    const retryBtn = document.getElementById('fanRetryBtn');
    const finishBtn = document.getElementById('fanFinishBtn');
    retryBtn.hidden = passed;
    finishBtn.hidden = !passed;
    retryBtn.style.display = passed ? 'none' : '';
    finishBtn.style.display = passed ? '' : 'none';

    retryBtn.onclick = function () { initFanTest(); };
    finishBtn.onclick = function () {
      try {
        localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ at: Date.now(), score: fanState.score }));
      } catch (e) {
        try { sessionStorage.setItem(ONBOARDING_KEY, '1'); } catch (e2) {}
      }
      hideSafety();
    };
  }

  /* ---------------- MAIN LANDING ---------------- */
  const socket = io();
  const onlineCountEl = document.getElementById('onlineCount');
  socket.on('online-count', (n) => { onlineCountEl.textContent = n; });

  const state = {
    team: null, teamName: null, teamColor: null, teamLogo: null, teamInitials: null,
    age: null, gender: null, language: 'any', cat: 'clubs'
  };

  const teamGrid = document.getElementById('teamGrid');
  const tabs = document.querySelectorAll('.tab');
  const startBtn = document.getElementById('startBtn');
  const startLabel = startBtn.querySelector('span');

  function renderTeams() {
    teamGrid.innerHTML = '';
    const list = window.TEAMS[state.cat];
    list.forEach(team => {
      const card = document.createElement('button');
      card.className = 'team-card';
      card.dataset.id = team.id;
      card.style.setProperty('--team-color', team.color);
      if (state.team === team.id) card.classList.add('selected');
      card.innerHTML = `
        <div class="team-logo-wrap">${window.renderTeamLogo(team, 64)}</div>
        <div class="team-name">${team.name}</div>
      `;
      card.addEventListener('click', () => {
        state.team = team.id;
        state.teamName = team.name;
        state.teamColor = team.color;
        state.teamLogo = team.logoUrl || null;
        state.teamInitials = team.initials || team.name.charAt(0);
        renderTeams();
        updateCTA();
      });
      teamGrid.appendChild(card);
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.cat = tab.dataset.cat;
      renderTeams();
    });
  });

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const field = chip.dataset.field;
      const value = chip.dataset.value;
      document.querySelectorAll(`.chip[data-field="${field}"]`).forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      state[field] = value;
      updateCTA();
    });
  });

  function updateCTA() {
    if (!state.team) {
      startBtn.disabled = true;
      startLabel.textContent = 'בחר קבוצה כדי להתחיל';
      startBtn.style.background = '';
    } else {
      startBtn.disabled = false;
      startLabel.textContent = `יאללה, חפש אוהד של ${state.teamName} 🚀`;
      startBtn.style.background = `linear-gradient(135deg, ${state.teamColor}, #f97316, #ec4899)`;
    }
  }

  startBtn.addEventListener('click', () => {
    if (!state.team) return;
    localStorage.setItem('fanchat-profile', JSON.stringify({
      team: state.team,
      teamName: state.teamName,
      teamColor: state.teamColor,
      teamLogo: state.teamLogo,
      teamInitials: state.teamInitials,
      age: state.age,
      gender: state.gender,
      language: state.language
    }));
    window.location.href = '/chat.html';
  });

  const saved = localStorage.getItem('fanchat-profile') || localStorage.getItem('yalla-profile');
  if (saved) {
    try {
      const p = JSON.parse(saved);
      state.team = p.team;
      state.teamName = p.teamName;
      state.teamColor = p.teamColor;
      state.teamLogo = p.teamLogo;
      state.teamInitials = p.teamInitials;
      state.age = p.age;
      state.gender = p.gender;
      state.language = p.language || 'any';

      for (const cat of Object.keys(window.TEAMS)) {
        if (window.TEAMS[cat].some(t => t.id === state.team)) {
          state.cat = cat;
          tabs.forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
          break;
        }
      }
      if (state.age) document.querySelector(`.chip[data-field="age"][data-value="${state.age}"]`)?.classList.add('selected');
      if (state.gender) document.querySelector(`.chip[data-field="gender"][data-value="${state.gender}"]`)?.classList.add('selected');
      if (state.language) document.querySelector(`.chip[data-field="language"][data-value="${state.language}"]`)?.classList.add('selected');
    } catch (e) {}
  }

  renderTeams();
  updateCTA();

  document.getElementById('resetOnboarding').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm('לאפס אונבורדינג? תצטרך לעבור את 3 השלבים שוב.')) {
      localStorage.removeItem(ONBOARDING_KEY);
      localStorage.removeItem('fanchat-profile');
      location.reload();
    }
  });

  if (!localStorage.getItem(ONBOARDING_KEY)) {
    showSafety();
  }
})();
