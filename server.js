const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 20000, pingInterval: 10000 });
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

const rooms = new Map();
const onlineFriends = new Map();
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const TURN_MS = 30000;
const RANKS = [
  ['2',2],['3',3],['4',4],['5',5],['6',6],['7',7],['8',8],['9',9],['10',10],
  ['J',11],['Q',12],['K',13],['A',14]
].map(([rank,value]) => ({ rank, value }));

const reply = (cb, payload) => { if (typeof cb === 'function') cb(payload); };
const cleanName = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 20);
const cleanCode = value => String(value || '').trim().toUpperCase();
const roomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};
const makeDeck = () => SUITS.flatMap(suit => RANKS.map(({ rank, value }) => ({
  id: `${rank}-${suit}-${crypto.randomUUID().slice(0, 8)}`, rank, value, suit
})));
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
const activePlayers = room => room.players.filter(p => p.active && !p.eliminated);
function nextActiveIndex(room, fromIndex) {
  for (let step = 1; step <= room.players.length; step++) {
    const idx = (fromIndex + step) % room.players.length;
    const p = room.players[idx];
    if (p.active && !p.eliminated) return idx;
  }
  return -1;
}
function playable(hand, card, ledSuit) {
  if (!ledSuit) return true;
  return !hand.some(c => c.suit === ledSuit) || card.suit === ledSuit;
}
function trickWinner(room) {
  const ledSuit = room.trick[0].card.suit;
  const trumps = room.trick.filter(t => t.card.suit === room.trumpSuit);
  const contenders = trumps.length ? trumps : room.trick.filter(t => t.card.suit === ledSuit);
  return contenders.reduce((best, item) => item.card.value > best.card.value ? item : best);
}
function lobbySummary(room) {
  return {
    code: room.code,
    name: room.name,
    hostName: room.players[0]?.name || 'Host',
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    isPublic: room.isPublic
  };
}
function publicRooms() {
  return [...rooms.values()]
    .filter(r => r.isPublic && r.phase === 'lobby')
    .map(lobbySummary)
    .sort((a,b) => b.playerCount - a.playerCount);
}
function broadcastPublicRooms() { io.emit('publicRooms', publicRooms()); }
function friendPresencePayload() {
  return [...onlineFriends.entries()].map(([friendCode, value]) => ({
    friendCode, name: value.name, roomCode: value.roomCode || null
  }));
}
function broadcastPresence() { io.emit('friendPresence', friendPresencePayload()); }
function addChat(room, player, text, system = false) {
  const message = {
    id: crypto.randomUUID(),
    playerId: player?.id || null,
    name: system ? 'Game' : player.name,
    text: String(text || '').trim().slice(0, 240),
    system,
    at: Date.now()
  };
  if (!message.text) return;
  room.chat.push(message);
  room.chat = room.chat.slice(-80);
}
function stateFor(room, socketId) {
  const me = room.players.find(p => p.socketId === socketId);
  return {
    code: room.code,
    roomName: room.name,
    isPublic: room.isPublic,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    cardsPerPlayer: room.cardsPerPlayer,
    dealerIndex: room.dealerIndex,
    currentPlayerId: room.players[room.currentPlayerIndex]?.id || null,
    leaderId: room.players[room.leaderIndex]?.id || null,
    trumpSuit: room.trumpSuit,
    turnedCard: room.turnedCard,
    trick: room.trick,
    message: room.message,
    previousRoundWinnerId: room.previousRoundWinnerId,
    winnerId: room.winnerId,
    turnDeadline: room.turnDeadline || null,
    chat: room.chat,
    players: room.players.map(p => ({
      id: p.id, name: p.name, friendCode: p.friendCode, connected: p.connected,
      active: p.active, eliminated: p.eliminated, doggieLifeUsed: p.doggieLifeUsed,
      doggieLifeGranted: p.doggieLifeGranted, tricks: p.tricks, handCount: p.hand.length,
      isHost: p.socketId === room.hostId
    })),
    me: me ? {
      id: me.id, name: me.name, friendCode: me.friendCode, reconnectToken: me.reconnectToken,
      hand: me.hand, active: me.active, eliminated: me.eliminated, tricks: me.tricks,
      doggieLifeUsed: me.doggieLifeUsed, doggieLifeGranted: me.doggieLifeGranted
    } : null
  };
}
function emitState(room) {
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, p.socketId)); });
}
function setPresence(player, roomCodeValue = null) {
  if (!player?.friendCode) return;
  onlineFriends.set(player.friendCode, { socketId: player.socketId, name: player.name, roomCode: roomCodeValue });
  broadcastPresence();
}
function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = null;
}
function setTurnTimer(room) {
  clearTurnTimer(room);
  if (!['playing', 'chooseTrump'].includes(room.phase)) return;
  const expectedPlayerId = room.players[room.currentPlayerIndex]?.id;
  if (!expectedPlayerId) return;
  room.turnDeadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    const player = room.players[room.currentPlayerIndex];
    if (!player || player.id !== expectedPlayerId) return;
    if (room.phase === 'chooseTrump') {
      const suitCounts = SUITS.map(suit => ({ suit, count: player.hand.filter(c => c.suit === suit).length }));
      const max = Math.max(...suitCounts.map(x => x.count));
      const choices = suitCounts.filter(x => x.count === max);
      chooseTrumpForPlayer(room, player, choices[Math.floor(Math.random() * choices.length)].suit, true);
    } else if (room.phase === 'playing') {
      const ledSuit = room.trick[0]?.card.suit || null;
      const legal = player.hand.filter(card => playable(player.hand, card, ledSuit));
      const card = legal[Math.floor(Math.random() * legal.length)];
      if (card) playCardForPlayer(room, player, card.id, true);
    }
  }, TURN_MS + 50);
}
function finishTrickIfReady(room) {
  if (room.trick.length < activePlayers(room).length) return false;
  clearTurnTimer(room);
  const win = trickWinner(room);
  const winnerIndex = room.players.findIndex(p => p.id === win.playerId);
  room.players[winnerIndex].tricks += 1;
  room.tricksPlayed += 1;
  room.message = `${room.players[winnerIndex].name} won the trick with ${win.card.rank} of ${win.card.suit}.`;
  room.leaderIndex = winnerIndex;
  room.currentPlayerIndex = winnerIndex;
  room.phase = 'resolvingTrick';
  emitState(room);
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    room.trick = [];
    if (room.tricksPlayed >= room.cardsPerPlayer) endRound(room);
    else {
      room.phase = 'playing';
      room.message = `${room.players[room.currentPlayerIndex].name} leads the next trick.`;
      setTurnTimer(room);
      emitState(room);
    }
  }, 1350);
  return true;
}
function chooseTrumpForPlayer(room, player, suit, automatic = false) {
  if (!SUITS.includes(suit)) return { error: 'Invalid suit.' };
  clearTurnTimer(room);
  room.trumpSuit = suit;
  room.phase = 'playing';
  room.leaderIndex = nextActiveIndex(room, room.dealerIndex);
  room.currentPlayerIndex = room.leaderIndex;
  room.message = `${player.name} ${automatic ? 'automatically ' : ''}chose ${suit}. ${room.players[room.currentPlayerIndex].name} leads.`;
  addChat(room, null, `${player.name} ${automatic ? 'automatically ' : ''}chose ${suit} as trump.`, true);
  setTurnTimer(room);
  emitState(room);
  return { ok: true };
}
function playCardForPlayer(room, player, cardId, automatic = false) {
  const idx = player.hand.findIndex(c => c.id === cardId);
  if (idx < 0) return { error: 'Card not found.' };
  const card = player.hand[idx];
  const ledSuit = room.trick[0]?.card.suit || null;
  if (!playable(player.hand, card, ledSuit)) return { error: `You must follow ${ledSuit}.` };
  clearTurnTimer(room);
  player.hand.splice(idx, 1);
  room.trick.push({ playerId: player.id, card });
  if (automatic) addChat(room, null, `${player.name}'s timer expired, so a legal card was played automatically.`, true);
  if (finishTrickIfReady(room)) return { ok: true };
  room.currentPlayerIndex = nextActiveIndex(room, room.currentPlayerIndex);
  room.message = `${room.players[room.currentPlayerIndex].name}'s turn.`;
  setTurnTimer(room);
  emitState(room);
  return { ok: true };
}
function forfeitPlayer(room, player) {
  if (!player.active || player.eliminated) return;
  const wasCurrent = room.players[room.currentPlayerIndex]?.id === player.id;
  player.active = false;
  player.eliminated = true;
  player.hand = [];
  addChat(room, null, `${player.name} forfeited the game.`, true);
  const survivors = activePlayers(room);
  if (survivors.length <= 1) {
    clearTurnTimer(room);
    room.phase = 'gameOver';
    room.winnerId = survivors[0]?.id || null;
    room.message = survivors[0] ? `${survivors[0].name} wins the game!` : 'Game ended with no winner.';
    addChat(room, null, room.message, true);
    emitState(room);
    return;
  }
  if (room.phase === 'chooseTrump' && wasCurrent) {
    room.currentPlayerIndex = nextActiveIndex(room, room.currentPlayerIndex);
    room.message = `${room.players[room.currentPlayerIndex].name} must choose the trump suit.`;
    setTurnTimer(room);
  } else if (room.phase === 'playing') {
    if (!finishTrickIfReady(room) && wasCurrent) {
      room.currentPlayerIndex = nextActiveIndex(room, room.currentPlayerIndex);
      room.message = `${room.players[room.currentPlayerIndex].name}'s turn.`;
      setTurnTimer(room);
    }
  }
  emitState(room);
}
function beginRound(room) {
  const active = activePlayers(room);
  if (active.length <= 1) {
    clearTurnTimer(room);
    room.phase = 'gameOver';
    room.winnerId = active[0]?.id || null;
    room.message = active[0] ? `${active[0].name} wins the game!` : 'No winner.';
    addChat(room, null, room.message, true);
    emitState(room);
    return;
  }
  room.cardsPerPlayer = Math.max(1, 8 - room.round);
  room.deck = shuffle(makeDeck());
  room.trick = [];
  room.tricksPlayed = 0;
  room.players.forEach(p => { p.hand = []; p.tricks = 0; });
  for (let n = 0; n < room.cardsPerPlayer; n++) {
    room.players.forEach(p => { if (p.active && !p.eliminated) p.hand.push(room.deck.pop()); });
  }
  room.turnedCard = null;
  if (room.round === 1) {
    room.turnedCard = room.deck.pop();
    room.trumpSuit = room.turnedCard.suit;
    room.phase = 'playing';
    room.leaderIndex = nextActiveIndex(room, room.dealerIndex);
    room.currentPlayerIndex = room.leaderIndex;
    room.message = `${room.players[room.currentPlayerIndex].name} leads. ${room.trumpSuit} are trump.`;
  } else {
    room.trumpSuit = null;
    room.phase = 'chooseTrump';
    room.currentPlayerIndex = room.players.findIndex(p => p.id === room.previousRoundWinnerId);
    if (room.currentPlayerIndex < 0 || !room.players[room.currentPlayerIndex].active) {
      room.currentPlayerIndex = nextActiveIndex(room, room.dealerIndex);
    }
    room.message = `${room.players[room.currentPlayerIndex].name} must choose the trump suit.`;
  }
  addChat(room, null, `Round ${room.round} begins with ${room.cardsPerPlayer} card${room.cardsPerPlayer === 1 ? '' : 's'} each.`, true);
  setTurnTimer(room);
  emitState(room);
}
function determineRoundWinner(room) {
  const active = activePlayers(room);
  const max = Math.max(...active.map(p => p.tricks));
  const tied = active.filter(p => p.tricks === max);
  if (tied.length === 1) return { winner: tied[0], cut: null };
  const deck = shuffle(makeDeck());
  let finalists = tied.map(player => ({ player, card: deck.pop() }));
  const firstCut = finalists.map(c => ({ playerId: c.player.id, card: c.card }));
  while (finalists.length > 1) {
    const highest = Math.max(...finalists.map(c => c.card.value));
    finalists = finalists.filter(c => c.card.value === highest);
    if (finalists.length > 1) finalists = finalists.map(c => ({ player: c.player, card: deck.pop() }));
  }
  return { winner: finalists[0].player, cut: firstCut };
}
function endRound(room) {
  clearTurnTimer(room);
  const result = determineRoundWinner(room);
  room.previousRoundWinnerId = result.winner.id;
  const eliminated = [];
  room.players.forEach(p => {
    if (!p.active || p.eliminated || p.tricks > 0) return;
    if (room.round === 1 && !p.doggieLifeUsed) {
      p.doggieLifeUsed = true;
      p.doggieLifeGranted = true;
    } else {
      p.eliminated = true;
      p.active = false;
      eliminated.push(p.name);
    }
  });
  const survivors = activePlayers(room);
  const cutText = result.cut ? ` Tie cut won by ${result.winner.name}.` : '';
  room.message = `${result.winner.name} won the round with ${result.winner.tricks} trick(s).${cutText}` +
    (eliminated.length ? ` Eliminated: ${eliminated.join(', ')}.` : ' No eliminations this round.');
  addChat(room, null, room.message, true);
  if (survivors.length <= 1) {
    room.phase = 'gameOver';
    room.winnerId = survivors[0]?.id || result.winner.id;
    room.message += ` ${room.players.find(p => p.id === room.winnerId)?.name} wins the game!`;
    addChat(room, null, room.message, true);
  } else {
    room.phase = 'roundEnd';
    room.dealerIndex = nextActiveIndex(room, room.dealerIndex);
  }
  emitState(room);
}
function createPlayer(socket, name, friendCode) {
  return {
    id: crypto.randomUUID(), socketId: socket.id, reconnectToken: crypto.randomUUID(),
    name, friendCode, connected: true, active: true, eliminated: false,
    doggieLifeUsed: false, doggieLifeGranted: false, tricks: 0, hand: []
  };
}
function attach(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
  setPresence(player, room.code);
}

io.on('connection', socket => {
  socket.emit('publicRooms', publicRooms());
  socket.emit('friendPresence', friendPresencePayload());

  socket.on('registerPresence', ({ name, friendCode }) => {
    name = cleanName(name);
    friendCode = cleanCode(friendCode).slice(0, 12);
    if (!name || !friendCode) return;
    socket.data.friendCode = friendCode;
    socket.data.displayName = name;
    onlineFriends.set(friendCode, { socketId: socket.id, name, roomCode: socket.data.roomCode || null });
    broadcastPresence();
  });

  socket.on('createRoom', ({ name, friendCode, isPublic = false, roomName = '', maxPlayers = 8 }, cb) => {
    name = cleanName(name);
    friendCode = cleanCode(friendCode).slice(0, 12);
    if (!name) return reply(cb, { error: 'Enter a player name.' });
    let code; do code = roomCode(); while (rooms.has(code));
    const player = createPlayer(socket, name, friendCode);
    const room = {
      code, name: cleanName(roomName) || `${name}'s table`, isPublic: Boolean(isPublic),
      maxPlayers: Math.min(8, Math.max(2, Number(maxPlayers) || 8)), hostId: socket.id,
      players: [player], phase: 'lobby', round: 0, cardsPerPlayer: 0, dealerIndex: 0,
      currentPlayerIndex: 0, leaderIndex: 0, trumpSuit: null, turnedCard: null,
      trick: [], message: 'Waiting for players.', previousRoundWinnerId: null,
      winnerId: null, chat: [], turnTimer: null, turnDeadline: null
    };
    addChat(room, null, `${name} created the room.`, true);
    rooms.set(code, room);
    attach(socket, room, player);
    reply(cb, { ok: true, code, reconnectToken: player.reconnectToken });
    emitState(room);
    broadcastPublicRooms();
  });

  socket.on('joinRoom', ({ name, friendCode, code }, cb) => {
    name = cleanName(name); friendCode = cleanCode(friendCode).slice(0, 12); code = cleanCode(code);
    const room = rooms.get(code);
    if (!room) return reply(cb, { error: 'Room not found.' });
    if (room.phase !== 'lobby') return reply(cb, { error: 'Game already started.' });
    if (room.players.length >= room.maxPlayers) return reply(cb, { error: 'Room is full.' });
    if (!name) return reply(cb, { error: 'Enter a player name.' });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return reply(cb, { error: 'That name is already in use.' });
    const player = createPlayer(socket, name, friendCode);
    room.players.push(player); attach(socket, room, player);
    addChat(room, null, `${name} joined the room.`, true);
    reply(cb, { ok: true, reconnectToken: player.reconnectToken });
    emitState(room); broadcastPublicRooms();
  });

  socket.on('rejoinRoom', ({ code, reconnectToken }, cb) => {
    const room = rooms.get(cleanCode(code));
    const player = room?.players.find(p => p.reconnectToken === reconnectToken);
    if (!room || !player) return reply(cb, { error: 'Unable to restore that game.' });
    attach(socket, room, player);
    addChat(room, null, `${player.name} reconnected.`, true);
    reply(cb, { ok: true }); emitState(room);
  });

  socket.on('startGame', (_payload, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return reply(cb, { error: 'Only the host can start.' });
    if (room.players.length < 2) return reply(cb, { error: 'At least 2 players are required.' });
    room.round = 1; room.dealerIndex = 0;
    room.players.forEach(p => { p.active = true; p.eliminated = false; });
    beginRound(room); reply(cb, { ok: true }); broadcastPublicRooms();
  });

  socket.on('chooseTrump', ({ suit }, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || room.phase !== 'chooseTrump' || room.players[room.currentPlayerIndex]?.id !== player?.id) return reply(cb, { error: 'You cannot choose trump now.' });
    reply(cb, chooseTrumpForPlayer(room, player, suit));
  });

  socket.on('playCard', ({ cardId }, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || room.phase !== 'playing' || room.players[room.currentPlayerIndex]?.id !== player?.id) return reply(cb, { error: 'It is not your turn.' });
    reply(cb, playCardForPlayer(room, player, cardId));
  });

  socket.on('nextRound', (_payload, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'roundEnd') return reply(cb, { error: 'Only the host can continue.' });
    room.round += 1; room.players.forEach(p => { p.doggieLifeGranted = false; });
    beginRound(room); reply(cb, { ok: true });
  });

  socket.on('chatMessage', ({ text }, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    text = String(text || '').trim();
    if (!room || !player || !text) return reply(cb, { error: 'Message not sent.' });
    addChat(room, player, text); emitState(room); reply(cb, { ok: true });
  });

  socket.on('inviteFriend', ({ friendCode, roomCode: inviteRoom }, cb) => {
    const target = onlineFriends.get(cleanCode(friendCode));
    const room = rooms.get(cleanCode(inviteRoom));
    const sender = room?.players.find(p => p.id === socket.data.playerId);
    if (!target) return reply(cb, { error: 'That friend is not online.' });
    if (!room || !sender) return reply(cb, { error: 'Room unavailable.' });
    io.to(target.socketId).emit('gameInvite', { roomCode: room.code, roomName: room.name, from: sender.name });
    reply(cb, { ok: true });
  });

  socket.on('forfeitGame', (_payload, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || !player) return reply(cb, { error: 'Game not found.' });
    if (room.phase === 'lobby') return reply(cb, { error: 'Use leave room before the game starts.' });
    forfeitPlayer(room, player);
    reply(cb, { ok: true });
  });

  socket.on('leaveRoom', (_payload, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || !player) return reply(cb, { ok: true });
    if (room.phase === 'lobby') {
      room.players = room.players.filter(p => p.id !== player.id);
      socket.leave(room.code);
      if (!room.players.length) rooms.delete(room.code);
      else if (room.hostId === socket.id) room.hostId = room.players.find(p => p.connected)?.socketId || null;
    } else {
      player.connected = false; player.socketId = null;
    }
    socket.data.roomCode = null; socket.data.playerId = null;
    setPresence({ ...player, socketId: socket.id }, null);
    if (rooms.has(room.code)) emitState(room);
    broadcastPublicRooms(); reply(cb, { ok: true });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (player) {
      player.connected = false; player.socketId = null;
      if (room.hostId === socket.id) room.hostId = room.players.find(p => p.connected)?.socketId || null;
      emitState(room);
    }
    if (socket.data.friendCode) onlineFriends.delete(socket.data.friendCode);
    broadcastPresence(); broadcastPublicRooms();
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Game running on port ${PORT}`));
