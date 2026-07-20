const socket = io();
let state = null;
const $ = id => document.getElementById(id);
const suitSymbol = { clubs:'♣', diamonds:'♦', hearts:'♥', spades:'♠' };
const red = suit => suit === 'diamonds' || suit === 'hearts';
function cardEl(card, button=false) {
  const el = document.createElement(button ? 'button' : 'div');
  el.className = `card ${red(card.suit)?'red':''}`;
  el.innerHTML = `<span>${card.rank}</span><span class="suit">${suitSymbol[card.suit]}</span><span style="text-align:right">${card.rank}</span>`;
  return el;
}
function act(event, payload={}) { return new Promise(resolve => socket.emit(event, payload, resolve)); }
$('create').onclick = async () => { const r=await act('createRoom',{name:$('name').value}); if(r.error)$('loginError').textContent=r.error; };
$('join').onclick = async () => { const r=await act('joinRoom',{name:$('name').value,code:$('code').value}); if(r.error)$('loginError').textContent=r.error; };
$('start').onclick = async () => { const r=await act('startGame'); if(r?.error) alert(r.error); };
$('nextRound').onclick = async () => { const r=await act('nextRound'); if(r?.error) alert(r.error); };

socket.on('state', s => { state=s; render(); });
function render() {
  $('login').hidden = true; $('game').hidden = false;
  $('roomCode').textContent = state.code; $('roundLabel').textContent = state.round ? `Round ${state.round} · ${state.cardsPerPlayer} card${state.cardsPerPlayer===1?'':'s'} each` : 'Lobby';
  $('trump').textContent = state.trumpSuit ? `${suitSymbol[state.trumpSuit]} ${state.trumpSuit}` : '—'; $('message').textContent = state.message || '';
  $('lobby').hidden = state.phase !== 'lobby'; $('table').hidden = state.phase === 'lobby';
  if(state.phase==='lobby') renderLobby(); else renderTable();
}
function renderLobby(){
  $('lobbyPlayers').innerHTML=''; state.players.forEach(p=>{const d=document.createElement('div');d.className='player';d.innerHTML=`<span>${p.name}</span><span>${p.isHost?'Host':''}</span>`;$('lobbyPlayers').appendChild(d)});
  $('start').hidden = state.hostId !== socket.id;
}
function renderTable(){
  $('myTricks').textContent=state.me?.tricks??0; $('cardsLeft').textContent=state.me?.hand.length??0;
  $('doggie').textContent=state.me?.doggieLifeGranted?'Used—saved this round':state.me?.doggieLifeUsed?'Used':'Available';
  $('players').innerHTML=''; state.players.forEach(p=>{const d=document.createElement('div');d.className=`player ${p.id===state.currentPlayerId?'current':''}`;d.innerHTML=`<span>${p.name}${p.id===state.me?.id?' (you)':''}</span><span class="badges"><span class="badge">${p.tricks} trick${p.tricks===1?'':'s'}</span><span class="badge">${p.handCount} cards</span>${p.eliminated?'<span class="badge">Eliminated</span>':''}${p.doggieLifeGranted?'<span class="badge">Doggie Life</span>':''}</span>`;$('players').appendChild(d)});
  $('trick').innerHTML=''; state.trick.forEach(t=>{const wrap=document.createElement('div');wrap.className='trick-item';wrap.appendChild(cardEl(t.card));const p=state.players.find(x=>x.id===t.playerId);const label=document.createElement('small');label.textContent=p?.name||'';wrap.appendChild(label);$('trick').appendChild(wrap)}); if(!state.trick.length)$('trick').textContent='No cards played yet.';
  $('turnedWrap').hidden=!state.turnedCard; $('turned').innerHTML=''; if(state.turnedCard)$('turned').appendChild(cardEl(state.turnedCard));
  const chooser=state.phase==='chooseTrump'&&state.currentPlayerId===state.me?.id; $('chooseTrump').hidden=!chooser; const sb=$('chooseTrump').querySelector('.suit-buttons'); sb.innerHTML=''; if(chooser)Object.keys(suitSymbol).forEach(s=>{const b=document.createElement('button');b.textContent=`${suitSymbol[s]} ${s}`;b.onclick=async()=>{const r=await act('chooseTrump',{suit:s});if(r?.error)alert(r.error)};sb.appendChild(b)});
  renderHand();
  $('nextRound').hidden=!(state.phase==='roundEnd'&&state.hostId===socket.id);
  if(state.phase==='gameOver'){const winner=state.players.find(p=>p.id===state.winnerId);$('handHint').innerHTML=`<span class="winner">${winner?.name||'A player'} wins!</span>`;}
}
function renderHand(){
  $('hand').innerHTML=''; const isTurn=state.phase==='playing'&&state.currentPlayerId===state.me?.id; const ledSuit=state.trick[0]?.card.suit; const hasLed=ledSuit&&state.me.hand.some(c=>c.suit===ledSuit);
  state.me.hand.forEach(card=>{const playable=isTurn&&(!ledSuit||!hasLed||card.suit===ledSuit);const el=cardEl(card,true);el.disabled=!playable;if(playable)el.classList.add('playable');el.onclick=async()=>{const r=await act('playCard',{cardId:card.id});if(r?.error)alert(r.error)};$('hand').appendChild(el)});
  if(state.me.eliminated)$('handHint').textContent='You have been eliminated, but you can watch the rest of the game.'; else if(state.phase==='chooseTrump'&&state.currentPlayerId===state.me.id)$('handHint').textContent='Choose the trump suit after looking at your hand.'; else if(isTurn)$('handHint').textContent=ledSuit&&hasLed?`Your turn. You must follow ${ledSuit}.`:'Your turn. Choose a card.'; else $('handHint').textContent='Only you can see these cards.';
}
