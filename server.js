const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const users = new Map();
const waitingQueues = new Map();

function profileOf(user) {
  return {
    team: user.team,
    teamName: user.teamName,
    age: user.age,
    gender: user.gender,
    language: user.language,
    country: user.country
  };
}

function removeFromAllQueues(socketId) {
  for (const queue of waitingQueues.values()) {
    const idx = queue.indexOf(socketId);
    if (idx !== -1) queue.splice(idx, 1);
  }
}

function addToQueue(socketId) {
  const user = users.get(socketId);
  if (!user) return;
  if (!waitingQueues.has(user.team)) {
    waitingQueues.set(user.team, []);
  }
  const queue = waitingQueues.get(user.team);
  if (!queue.includes(socketId)) queue.push(socketId);
}

function broadcastCount() {
  io.emit('online-count', users.size);
}

function tryMatch(socketId) {
  const user = users.get(socketId);
  if (!user || user.partnerId) return;

  const queue = waitingQueues.get(user.team) || [];
  let partnerId = null;
  while (queue.length > 0) {
    const candidateId = queue.shift();
    if (candidateId === socketId) continue;
    const candidate = users.get(candidateId);
    if (candidate && !candidate.partnerId) {
      partnerId = candidateId;
      break;
    }
  }

  if (partnerId) {
    const partner = users.get(partnerId);
    user.partnerId = partnerId;
    partner.partnerId = socketId;

    io.to(socketId).emit('matched', {
      partnerId,
      partnerProfile: profileOf(partner),
      initiator: true
    });
    io.to(partnerId).emit('matched', {
      partnerId: socketId,
      partnerProfile: profileOf(user),
      initiator: false
    });

    console.log(`Matched ${socketId.slice(0, 6)} <-> ${partnerId.slice(0, 6)} (team: ${user.teamName})`);
  } else {
    addToQueue(socketId);
    io.to(socketId).emit('waiting');
  }
}

function leaveCurrentPair(socketId, requeuePartner = true) {
  const user = users.get(socketId);
  if (!user || !user.partnerId) return;
  const partnerId = user.partnerId;
  const partner = users.get(partnerId);
  user.partnerId = null;
  if (partner) {
    partner.partnerId = null;
    io.to(partnerId).emit('partner-left');
    if (requeuePartner) {
      tryMatch(partnerId);
    }
  }
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id.slice(0, 6));

  socket.on('join', (profile) => {
    if (!profile || !profile.team) {
      socket.emit('error-msg', 'Missing team');
      return;
    }
    users.set(socket.id, {
      team: profile.team,
      teamName: profile.teamName || profile.team,
      age: profile.age || 'unknown',
      gender: profile.gender || 'unknown',
      language: profile.language || 'unknown',
      country: profile.country || 'unknown',
      partnerId: null
    });
    broadcastCount();
    tryMatch(socket.id);
  });

  socket.on('signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('next', () => {
    leaveCurrentPair(socket.id, true);
    tryMatch(socket.id);
  });

  socket.on('chat-message', ({ to, text }) => {
    if (!to || !text) return;
    io.to(to).emit('chat-message', { from: socket.id, text: String(text).slice(0, 500) });
  });

  socket.on('report', ({ partnerId }) => {
    if (!partnerId) return;
    const reported = users.get(partnerId);
    if (reported) {
      reported.reports = (reported.reports || 0) + 1;
      console.log(`Report against ${partnerId.slice(0, 6)} (total: ${reported.reports})`);
      if (reported.reports >= 3) {
        console.log(`User ${partnerId.slice(0, 6)} reached 3 reports - disconnecting`);
        io.to(partnerId).emit('banned');
        io.sockets.sockets.get(partnerId)?.disconnect(true);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id.slice(0, 6));
    leaveCurrentPair(socket.id, true);
    removeFromAllQueues(socket.id);
    users.delete(socket.id);
    broadcastCount();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🟢 FANCHAT server running`);
  console.log(`👉 Open http://localhost:${PORT} in your browser`);
  console.log(`👉 Open it in 2 tabs to test the matching\n`);
});
