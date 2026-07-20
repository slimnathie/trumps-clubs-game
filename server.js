const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const rooms = new Map();
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = [
  { rank: '2', value: 2 }, { rank: '3', value: 3 }, { rank: '4', value: 4 },
  { rank: '5', value: 5 }, { rank: '6', value: 6 }, { rank: '7', value: 7 },
  { rank: '8', value: 8 }, { rank: '9', value: 9 }, { rank: '10', value: 10 },
  { rank: 'J', value: 11 }, { rank: 'Q', value: 12 }, { rank: 'K', value: 13 },
  { rank: 'A', value: 14 }
];

function makeDeck() {
  return SUITS.flatMap(suit => RANKS.map(({ rank, value }) => ({
    id: `${rank}-${suit}-${crypto.randomUUID().slice(0, 8)}`, rank, value, suit
  })));
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function publicState(room, socketId) {
  const me = room.players.find(p => p.socketId === socketId);
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    cardsPerPlayer: room.cardsPerPlayer,
    dealerIndex: room.dealerIndex,
    currentPlayerId: room.players[room.currentPlayerIndex]?.id || null,
    leaderId: room.players[room.leaderIndex]?.id || null,
    trumpSuit: room.trumpSuit,
    turnedCard: room.turnedCard,
    trick: room.trick.map(t => ({ playerId: t.playerId, card: t.card })),
    message: room.message,
    previousRoundWinnerId: room.previousRoundWinnerId,
    winnerId: room.winnerId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      active: p.active,
      eliminated: p.eliminated,
      doggieLifeUsed: p.doggieLifeUsed,
      doggieLifeGranted: p.doggieLifeGranted,
      tricks: p.tricks,
      handCount: p.hand.length,
      isHost: p.socketId === room.hostId
    })),
    me: me ? {
      id: me.id,
      name: me.name,
      hand: me.hand,
      active: me.active,
      eliminated: me.eliminated,
      tricks: me.tricks,
      doggieLifeUsed: me.doggieLifeUsed,
      doggieLifeGranted: me.doggieLifeGranted
    } : null
  };
}
function emitState(room) {
  room.players.forEach(p => {
    if (p.socketId) io.to(p.socketId).emit('state', publicState(room, p.socketId));
  });
}
function activePlayers(room) { return room.players.filter(p => p.active && !p.eliminated); }
function nextActiveIndex(room, fromIndex) {
  for (let step = 1; step <= room.players.length; step++) {
    const idx = (fromIndex + step) % room.players.length;
    if (room.players[idx].active && !room.players[idx].eliminated) return idx;
  }
  return -1;
}
function isPlayable(hand, card, ledSuit) {
  if (!ledSuit) return true;
  const hasSuit = hand.some(c => c.suit === ledSuit);
  return !hasSuit || card.suit === ledSuit;
}
function trickWinner(room) {
  const ledSuit = room.trick[0].card.suit;
  const trumpCards = room.trick.filter(t => t.card.suit === room.trumpSuit);
  const contenders = trumpCards.length ? trumpCards : room.trick.filter(t => t.card.suit === ledSuit);
  return contenders.reduce((best, item) => item.card.value > best.card.value ? item : best);
}
function beginRound(room) {
  const active = activePlayers(room);
  if (active.length <= 1) {
    room.phase = 'gameOver';
    room.winnerId = active[0]?.id || null;
    room.message = active[0] ? `${active[0].name} wins the game!` : 'No winner.';
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
  emitState(room);
}
function determineRoundWinner(room) {
  const active = activePlayers(room);
  const max = Math.max(...active.map(p => p.tricks));
  const tied = active.filter(p => p.tricks === max);
  if (tied.length === 1) return { winner: tied[0], cut: null };
  const cutDeck = shuffle(makeDeck());
  const cuts = tied.map(p => ({ player: p, card: cutDeck.pop() }));
  let highest = Math.max(...cuts.map(c => c.card.value));
  let finalists = cuts.filter(c => c.card.value === highest);
  while (finalists.length > 1) {
    finalists = finalists.map(c => ({ player: c.player, card: cutDeck.pop() }));
    highest = Math.max(...finalists.map(c => c.card.value));
    finalists = finalists.filter(c => c.card.value === highest);
  }
  return { winner: finalists[0].player, cut: cuts.map(c => ({ playerId: c.player.id, card: c.card })) };
}
function endRound(room) {
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
  if (survivors.length <= 1) {
    room.phase = 'gameOver';
    room.winnerId = survivors[0]?.id || result.winner.id;
    room.message += ` ${room.players.find(p => p.id === room.winnerId)?.name} wins the game!`;
    emitState(room);
    return;
  }
  room.phase = 'roundEnd';
  room.dealerIndex = nextActiveIndex(room, room.dealerIndex);
  emitState(room);
}

io.on('connection', socket => {
  const reply = (cb, payload) => { if (typeof cb === 'function') cb(payload); };
  socket.on('createRoom', ({ name }, cb) => {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return reply(cb, { error: 'Enter a player name.' });
    let roomCode; do roomCode = code(); while (rooms.has(roomCode));
    const player = { id: crypto.randomUUID(), socketId: socket.id, name, connected: true, active: true, eliminated: false, doggieLifeUsed: false, doggieLifeGranted: false, tricks: 0, hand: [] };
    const room = { code: roomCode, hostId: socket.id, players: [player], phase: 'lobby', round: 0, cardsPerPlayer: 0, dealerIndex: 0, currentPlayerIndex: 0, leaderIndex: 0, trumpSuit: null, turnedCard: null, trick: [], message: 'Waiting for players.', previousRoundWinnerId: null, winnerId: null };
    rooms.set(roomCode, room); socket.join(roomCode); socket.data.roomCode = roomCode; socket.data.playerId = player.id;
    reply(cb, { ok: true, code: roomCode }); emitState(room);
  });
  socket.on('joinRoom', ({ name, code: roomCode }, cb) => {
    name = String(name || '').trim().slice(0, 20); roomCode = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return reply(cb, { error: 'Room not found.' });
    if (room.phase !== 'lobby') return reply(cb, { error: 'Game already started.' });
    if (!name) return reply(cb, { error: 'Enter a player name.' });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return reply(cb, { error: 'That name is already in use.' });
    const player = { id: crypto.randomUUID(), socketId: socket.id, name, connected: true, active: true, eliminated: false, doggieLifeUsed: false, doggieLifeGranted: false, tricks: 0, hand: [] };
    room.players.push(player); socket.join(roomCode); socket.data.roomCode = roomCode; socket.data.playerId = player.id;
    reply(cb, { ok: true }); emitState(room);
  });
  socket.on('startGame', cb => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return reply(cb, { error: 'Only the host can start.' });
    if (room.players.length < 2) return reply(cb, { error: 'At least 2 players are required.' });
    room.round = 1; room.dealerIndex = 0; room.players.forEach(p => { p.active = true; p.eliminated = false; }); beginRound(room); reply(cb, { ok: true });
  });
  socket.on('chooseTrump', ({ suit }, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || room.phase !== 'chooseTrump' || room.players[room.currentPlayerIndex]?.id !== player?.id) return reply(cb, { error: 'You cannot choose trump now.' });
    if (!SUITS.includes(suit)) return reply(cb, { error: 'Invalid suit.' });
    room.trumpSuit = suit; room.phase = 'playing'; room.leaderIndex = nextActiveIndex(room, room.dealerIndex); room.currentPlayerIndex = room.leaderIndex; room.message = `${player.name} chose ${suit}. ${room.players[room.currentPlayerIndex].name} leads.`; emitState(room); reply(cb, { ok: true });
  });
  socket.on('playCard', ({ cardId }, cb) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || room.phase !== 'playing' || room.players[room.currentPlayerIndex]?.id !== player?.id) return reply(cb, { error: 'It is not your turn.' });
    const idx = player.hand.findIndex(c => c.id === cardId); if (idx < 0) return reply(cb, { error: 'Card not found.' });
    const card = player.hand[idx]; const ledSuit = room.trick[0]?.card.suit || null;
    if (!isPlayable(player.hand, card, ledSuit)) return reply(cb, { error: `You must follow ${ledSuit}.` });
    player.hand.splice(idx, 1); room.trick.push({ playerId: player.id, card });
    const count = activePlayers(room).length;
    if (room.trick.length < count) {
      room.currentPlayerIndex = nextActiveIndex(room, room.currentPlayerIndex);
      room.message = `${room.players[room.currentPlayerIndex].name}'s turn.`;
      emitState(room); reply(cb, { ok: true }); return;
    }
    const win = trickWinner(room); const winnerIndex = room.players.findIndex(p => p.id === win.playerId); room.players[winnerIndex].tricks += 1; room.tricksPlayed += 1;
    room.message = `${room.players[winnerIndex].name} won the trick with ${win.card.rank} of ${win.card.suit}.`;
    room.leaderIndex = winnerIndex; room.currentPlayerIndex = winnerIndex;
    emitState(room);
    setTimeout(() => {
      if (!rooms.has(room.code)) return;
      room.trick = [];
      if (room.tricksPlayed >= room.cardsPerPlayer) endRound(room);
      else { room.message = `${room.players[room.currentPlayerIndex].name} leads the next trick.`; emitState(room); }
    }, 1400);
    reply(cb, { ok: true });
  });
  socket.on('nextRound', cb => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'roundEnd') return reply(cb, { error: 'Only the host can continue.' });
    room.round += 1; room.players.forEach(p => { p.doggieLifeGranted = false; }); beginRound(room); reply(cb, { ok: true });
  });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const p = room.players.find(x => x.id === socket.data.playerId); if (p) { p.connected = false; p.socketId = null; }
    if (room.hostId === socket.id) { const next = room.players.find(x => x.connected); room.hostId = next?.socketId || null; }
    emitState(room);
  });
});

server.listen(PORT, () => console.log(`Game running at http://localhost:${PORT}`));
