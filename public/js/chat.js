(function () {
  const ONBOARDING_KEY = 'fanchat-onboarded-v2';
  if (!localStorage.getItem(ONBOARDING_KEY)) {
    window.location.href = '/';
    return;
  }

  const profileRaw = localStorage.getItem('fanchat-profile') || localStorage.getItem('yalla-profile');
  if (!profileRaw) {
    window.location.href = '/';
    return;
  }
  const profile = JSON.parse(profileRaw);

  const myTeam = window.findTeam(profile.team) || {
    name: profile.teamName,
    color: profile.teamColor || '#94a3b8',
    initials: profile.teamInitials || '⚽',
    logoUrl: profile.teamLogo || null
  };

  document.getElementById('myTeamLogo').innerHTML = window.renderTeamLogo(myTeam, 28);
  document.getElementById('myTeamName').textContent = myTeam.name || '---';

  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');
  const searchingOverlay = document.getElementById('searchingOverlay');
  const searchingText = document.getElementById('searchingText');
  const strangerInfo = document.getElementById('strangerInfo');
  const strangerLogoEl = document.getElementById('strangerLogo');
  const strangerTeamEl = document.getElementById('strangerTeam');
  const strangerAgeEl = document.getElementById('strangerAge');
  const strangerLangEl = document.getElementById('strangerLang');
  const onlineCountEl = document.getElementById('onlineCount');
  const chatMessages = document.getElementById('chatMessages');
  const chatForm = document.getElementById('chatForm');
  const chatText = document.getElementById('chatText');

  const skipBtn = document.getElementById('skipBtn');
  const heartBtn = document.getElementById('heartBtn');
  const reportBtn = document.getElementById('reportBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const muteBtn = document.getElementById('muteBtn');
  const camBtn = document.getElementById('camBtn');

  let socket = null;
  let pc = null;
  let localStream = null;
  let partnerId = null;
  let isInitiator = false;
  let pendingCandidates = [];

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  function showSearching(text) {
    searchingOverlay.hidden = false;
    searchingOverlay.classList.add('visible');
    if (text) searchingText.textContent = text;
    strangerInfo.hidden = true;
  }
  function hideSearching() {
    searchingOverlay.classList.remove('visible');
    searchingOverlay.hidden = true;
  }
  function showStranger(p) {
    strangerInfo.hidden = false;
    const team = window.findTeam(p.team);
    strangerLogoEl.innerHTML = window.renderTeamLogo(team || { name: p.teamName, color: '#94a3b8', initials: '⚽' }, 28);
    strangerTeamEl.textContent = team ? team.name : (p.teamName || '---');
    strangerAgeEl.textContent = p.age && p.age !== 'unknown' ? p.age : '?';
    const langMap = { he: 'עברית', en: 'English', es: 'Español', ar: 'العربية', pt: 'Português', any: '?', unknown: '?' };
    strangerLangEl.textContent = langMap[p.language] || p.language || '?';
  }
  function clearChat() {
    chatMessages.innerHTML = '<div class="system-msg">💬 שולחים הודעות בזמן השיחה</div>';
  }
  function addChat(text, mine) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (mine ? 'mine' : 'theirs');
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  function addSystem(text) {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function initLocalStream() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true
      });
      localVideo.srcObject = localStream;
    } catch (err) {
      alert('צריך גישה למצלמה ומיקרופון. בדוק את ההרשאות בדפדפן.');
      console.error(err);
      window.location.href = '/';
    }
  }

  function createPC() {
    cleanupPC();
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pendingCandidates = [];

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate && partnerId) {
        socket.emit('signal', { to: partnerId, data: { type: 'ice', candidate: e.candidate } });
      }
    };

    pc.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
        console.warn('Peer connection lost');
      }
    };
  }

  function cleanupPC() {
    if (pc) {
      try { pc.close(); } catch (e) {}
      pc = null;
    }
    remoteVideo.srcObject = null;
    pendingCandidates = [];
  }

  async function startCall() {
    if (!pc) createPC();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: partnerId, data: { type: 'offer', sdp: offer } });
  }

  function connectSocket() {
    socket = io();

    socket.on('connect', () => {
      socket.emit('join', {
        team: profile.team,
        teamName: profile.teamName,
        age: profile.age,
        gender: profile.gender,
        language: profile.language
      });
    });

    socket.on('online-count', (n) => { onlineCountEl.textContent = n; });

    socket.on('waiting', () => {
      partnerId = null;
      cleanupPC();
      clearChat();
      showSearching(`מחפש אוהדי ${profile.teamName} פעילים...`);
    });

    socket.on('matched', async ({ partnerId: pid, partnerProfile, initiator }) => {
      partnerId = pid;
      isInitiator = initiator;
      showStranger(partnerProfile);
      hideSearching();
      clearChat();
      const partnerTeam = window.findTeam(partnerProfile.team);
      addSystem('🎉 התחברת! שניכם אוהדים של ' + (partnerTeam?.name || profile.teamName));
      createPC();
      if (isInitiator) {
        try { await startCall(); } catch (err) { console.error('startCall error', err); }
      }
    });

    socket.on('signal', async ({ from, data }) => {
      if (!pc || from !== partnerId) return;
      try {
        if (data.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          for (const c of pendingCandidates) {
            try { await pc.addIceCandidate(c); } catch (e) {}
          }
          pendingCandidates = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } });
        } else if (data.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          for (const c of pendingCandidates) {
            try { await pc.addIceCandidate(c); } catch (e) {}
          }
          pendingCandidates = [];
        } else if (data.type === 'ice' && data.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            try { await pc.addIceCandidate(data.candidate); } catch (e) {}
          } else {
            pendingCandidates.push(data.candidate);
          }
        }
      } catch (err) {
        console.error('signal error', err);
      }
    });

    socket.on('partner-left', () => {
      addSystem('👋 הצד השני עזב. מחפש לך אוהד חדש...');
      partnerId = null;
      cleanupPC();
      showSearching('מחפש אוהד חדש...');
    });

    socket.on('chat-message', ({ from, text }) => {
      if (from === partnerId) addChat(text, false);
    });

    socket.on('disconnect', () => {
      showSearching('מנסה להתחבר שוב...');
    });
  }

  skipBtn.addEventListener('click', () => {
    cleanupPC();
    partnerId = null;
    showSearching('מחפש אוהד הבא...');
    socket.emit('next');
  });

  leaveBtn.addEventListener('click', () => {
    if (socket) socket.disconnect();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    window.location.href = '/';
  });

  heartBtn.addEventListener('click', () => {
    if (!partnerId) return;
    heartBtn.classList.add('pulse');
    setTimeout(() => heartBtn.classList.remove('pulse'), 600);
    addSystem('❤️ שלחת לב');
  });

  reportBtn.addEventListener('click', () => {
    if (!partnerId) return;
    if (!confirm('לדווח על המשתמש הזה ולעבור הלאה?')) return;
    socket.emit('report', { partnerId });
    cleanupPC();
    partnerId = null;
    showSearching('דיווח התקבל. מחפש אוהד הבא...');
    socket.emit('next');
  });

  muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    muteBtn.textContent = track.enabled ? '🎙️' : '🔇';
    muteBtn.classList.toggle('off', !track.enabled);
  });

  camBtn.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    camBtn.classList.toggle('off', !track.enabled);
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatText.value.trim();
    if (!text || !partnerId) return;
    socket.emit('chat-message', { to: partnerId, text });
    addChat(text, true);
    chatText.value = '';
  });

  (async () => {
    showSearching('מבקש גישה למצלמה...');
    await initLocalStream();
    showSearching('מתחבר לשרת...');
    connectSocket();
  })();
})();
