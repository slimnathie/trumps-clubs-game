const socket = io();
const $ = id => document.getElementById(id);
const suits = { clubs:'♣', diamonds:'♦', hearts:'♥', spades:'♠' };
const redSuit = suit => suit === 'hearts' || suit === 'diamonds';
let state = null;
let rooms = [];
let presence = [];
let createPublic = false;
let unread = 0;
let lastChatCount = 0;
let audioEnabled = localStorage.getItem('ltsSound') !== 'off';
let timerTick = null;

const profile = {
  name: localStorage.getItem('ltsName') || '',
  friendCode: localStorage.getItem('ltsFriendCode') || makeFriendCode(),
  friends: JSON.parse(localStorage.getItem('ltsFriends') || '[]'),
  matchesWon: Number(localStorage.getItem('ltsMatchesWon') || 0)
};
localStorage.setItem('ltsFriendCode', profile.friendCode);
$('name').value = profile.name;
$('myFriendCode').textContent = profile.friendCode;
$('myMatchesWon').textContent = profile.matchesWon;
$('soundToggle').textContent = audioEnabled ? '🔊' : '🔇';

function makeFriendCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:8},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}
function saveProfile(){
  profile.name = $('name').value.trim();
  localStorage.setItem('ltsName',profile.name);
  localStorage.setItem('ltsFriends',JSON.stringify(profile.friends));
  socket.emit('registerPresence',{name:profile.name,friendCode:profile.friendCode});
}
function act(event,payload={}){return new Promise(resolve=>socket.emit(event,payload,resolve));}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2200);}
function showScreen(id){document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===id));}
function sound(kind='tap'){
  if(!audioEnabled) return;
  const ctx = sound.ctx || (sound.ctx = new (window.AudioContext||window.webkitAudioContext)());
  const osc=ctx.createOscillator(), gain=ctx.createGain();
  const map={tap:[380,.025],card:[220,.045],win:[620,.12],message:[480,.06]};
  const [freq,dur]=map[kind]||map.tap; osc.frequency.value=freq; gain.gain.setValueAtTime(.025,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+dur); osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+dur);
}
function cardEl(card,button=false){
  const el=document.createElement(button?'button':'div');
  el.className=`playing-card ${redSuit(card.suit)?'red':''}`;
  el.innerHTML=`<span>${card.rank}${suits[card.suit]}</span><span class="suit">${suits[card.suit]}</span><span class="bottom">${card.rank}${suits[card.suit]}</span>`;
  return el;
}
function currentName(){saveProfile();return profile.name;}
function commonPayload(){return {name:currentName(),friendCode:profile.friendCode,matchesWon:profile.matchesWon};}
function storeSession(code,token){localStorage.setItem('ltsSession',JSON.stringify({code,reconnectToken:token}));}
function clearSession(){localStorage.removeItem('ltsSession');}

socket.on('connect',()=>{
  saveProfile();
  const session=JSON.parse(localStorage.getItem('ltsSession')||'null');
  if(session) act('rejoinRoom',session).then(r=>{if(r?.error)clearSession();});
});
socket.on('publicRooms',r=>{rooms=r;renderPublicRooms();});
socket.on('friendPresence',p=>{presence=p;renderFriends();});
socket.on('gameInvite',invite=>{
  toast(`${invite.from} invited you to ${invite.roomName}`);
  if(confirm(`${invite.from} invited you to ${invite.roomName}. Join now?`)) joinCode(invite.roomCode);
});
socket.on('matchWon',({matchesWon})=>{ profile.matchesWon=Math.max(profile.matchesWon,Number(matchesWon)||0); localStorage.setItem('ltsMatchesWon',profile.matchesWon); $('myMatchesWon').textContent=profile.matchesWon; });
socket.on('state',s=>{
  const oldTrick=state?.trick?.length||0;
  state=s; showScreen('game');
  if(state.me?.reconnectToken) storeSession(state.code,state.me.reconnectToken);
  if((state.trick?.length||0)>oldTrick) sound('card');
  if(state.chat.length>lastChatCount){if(!$('chatDrawer').classList.contains('open')) unread+=state.chat.length-lastChatCount;sound('message');}
  lastChatCount=state.chat.length;
  renderGame();
});

function renderPublicRooms(){
  const wrap=$('publicRooms');wrap.innerHTML='';
  if(!rooms.length){wrap.className='room-list empty-state';wrap.textContent='No public games yet.';return;}
  wrap.className='room-list';rooms.forEach(room=>{
    const el=document.createElement('article');el.className='room-card';
    el.innerHTML=`<div><strong>${escapeHtml(room.name)}</strong><span>${room.hostName} · ${room.playerCount}/${room.maxPlayers} players</span></div>`;
    const b=document.createElement('button');b.className='secondary';b.textContent='Join';b.onclick=()=>joinCode(room.code);el.appendChild(b);wrap.appendChild(el);
  });
}
function friendStatus(code){return presence.find(p=>p.friendCode===code);}
function renderFriends(){
  const wrap=$('friendsList');wrap.innerHTML='';
  if(!profile.friends.length){wrap.className='friend-list empty-state';wrap.textContent='Add a friend using their code.';return;}
  wrap.className='friend-list';profile.friends.forEach(friend=>{
    const online=friendStatus(friend.code);const el=document.createElement('article');el.className=`friend-card ${online?'':'offline'}`;
    el.innerHTML=`<div><strong><span class="online-dot"></span>${escapeHtml(friend.name||friend.code)}</strong><span>${online?'Online':'Offline'} · ${friend.code}</span></div>`;
    const del=document.createElement('button');del.className='ghost small';del.textContent='Remove';del.onclick=()=>{profile.friends=profile.friends.filter(f=>f.code!==friend.code);saveProfile();renderFriends();};el.appendChild(del);wrap.appendChild(el);
  });
  renderInviteFriends();
}
function renderInviteFriends(){
  const wrap=$('inviteFriendList');if(!wrap)return;wrap.innerHTML='';
  profile.friends.forEach(friend=>{
    const online=friendStatus(friend.code);const el=document.createElement('article');el.className=`friend-card ${online?'':'offline'}`;
    el.innerHTML=`<div><strong>${escapeHtml(friend.name||friend.code)}</strong><span>${online?'Online':'Offline'}</span></div>`;
    const b=document.createElement('button');b.className='secondary';b.textContent='Invite';b.disabled=!online;b.onclick=async()=>{const r=await act('inviteFriend',{friendCode:friend.code,roomCode:state.code});toast(r?.error||'Invitation sent');};el.appendChild(b);wrap.appendChild(el);
  });
  if(!profile.friends.length)wrap.innerHTML='<div class="empty-state">Add friends from the home screen first.</div>';
}
function joinCode(code){
  const name=currentName();if(!name){$('homeError').textContent='Enter your name first.';return;}
  act('joinRoom',{...commonPayload(),code}).then(r=>{if(r?.error)$('homeError').textContent=r.error;else storeSession(code,r.reconnectToken);});
}
function updateTimer(){
  if(!state?.turnDeadline || !['playing','chooseTrump'].includes(state.phase)){$('turnTimer').hidden=true;return;}
  const seconds=Math.max(0,Math.ceil((state.turnDeadline-Date.now())/1000));
  const current=state.players.find(p=>p.id===state.currentPlayerId);
  $('turnTimer').hidden=false;
  $('timerSeconds').textContent=seconds;
  $('timerPlayer').textContent=state.currentPlayerId===state.me?.id?'Your turn':`${current?.name||'Player'}'s turn`;
  $('turnTimer').style.setProperty('--timer-progress',`${Math.max(0,Math.min(100,seconds/30*100))}%`);
  $('turnTimer').classList.toggle('urgent',seconds<=10);
}
function restartTimerDisplay(){clearInterval(timerTick);updateTimer();timerTick=setInterval(updateTimer,250);}
function renderGame(){
  $('roomName').textContent=state.roomName;$('roomCode').textContent=state.code;$('bigRoomCode').textContent=state.code;
  $('lobby').hidden=state.phase!=='lobby';$('table').hidden=state.phase==='lobby';
  // The winner overlay is outside the table section, so it must be cleared
  // explicitly when a rematch returns the room to the lobby.
  if(state.phase!=='gameOver'){
    $('winnerOverlay').hidden=true;
    $('winnerOverlay').dataset.winner='';
  }
  $('chatUnread').textContent=unread?String(unread):'';renderChat();
  if(state.phase==='lobby')renderLobby();else renderTable();
  restartTimerDisplay();
}
function renderLobby(){
  $('lobbyStatus').textContent=`${state.players.length}/${state.maxPlayers} players · ${state.isPublic?'Public':'Private'}`;
  const wrap=$('lobbyPlayers');wrap.innerHTML='';state.players.forEach(p=>{
    const el=document.createElement('div');el.className='player-row';el.innerHTML=`<div class="player-avatar">${escapeHtml(p.name[0]?.toUpperCase()||'?')}</div><div><strong>${escapeHtml(p.name)}${p.id===state.me.id?' (you)':''}</strong><span>${p.isHost?'Host · ':''}${p.connected?'Ready':'Disconnected'} · ${p.matchesWon||0} match win${(p.matchesWon||0)===1?'':'s'}</span></div>`;wrap.appendChild(el);
  });
  $('start').hidden=state.hostId!==socket.id;
}
function renderTable(){
  $('roundLabel').textContent=`Round ${state.round} · ${state.cardsPerPlayer} card${state.cardsPerPlayer===1?'':'s'}`;
  $('message').textContent=state.message||'';$('trump').textContent=state.trumpSuit?`${suits[state.trumpSuit]} ${state.trumpSuit}`:'—';
  $('myTricks').textContent=state.me?.tricks||0;$('cardsLeft').textContent=state.me?.hand?.length||0;
  $('doggie').textContent=state.me?.doggieLifeGranted?'Doggie life saved you':state.me?.doggieLifeUsed?'Doggie life used':'Doggie life available';
  const opponents=$('opponents');opponents.innerHTML='';state.players.filter(p=>p.id!==state.me?.id).forEach(p=>{
    const el=document.createElement('div');el.className='opponent';
    const backs=Array.from({length:Math.min(4,p.handCount)},()=>'<i class="card-back-mini"></i>').join('');
    el.innerHTML=`<div class="mini-hand">${backs}</div><strong>${escapeHtml(p.name)}</strong><small>${p.tricks} trick${p.tricks===1?'':'s'} · ${p.matchesWon||0} match win${(p.matchesWon||0)===1?'':'s'}${p.eliminated?' · out':''}</small>`;opponents.appendChild(el);
  });
  const trick=$('trick');trick.innerHTML='';if(!state.trick.length)trick.innerHTML='<span class="placeholder">Waiting for the lead…</span>';state.trick.forEach(t=>{
    const wrap=document.createElement('div');wrap.className='played-card';wrap.appendChild(cardEl(t.card));const name=document.createElement('small');name.textContent=state.players.find(p=>p.id===t.playerId)?.name||'';wrap.appendChild(name);trick.appendChild(wrap);
  });
  $('turnedWrap').hidden=!state.turnedCard;$('turned').innerHTML='';if(state.turnedCard){const c=cardEl(state.turnedCard);c.style.width='45px';c.style.height='64px';c.style.fontSize='10px';$('turned').appendChild(c);}
  const chooser=state.phase==='chooseTrump'&&state.currentPlayerId===state.me?.id;$('chooseTrump').hidden=!chooser;const sb=$('chooseTrump').querySelector('.suit-buttons');sb.innerHTML='';if(chooser)Object.keys(suits).forEach(s=>{const b=document.createElement('button');b.textContent=suits[s];b.setAttribute('aria-label',s);b.onclick=async()=>{sound();const r=await act('chooseTrump',{suit:s});if(r?.error)toast(r.error)};sb.appendChild(b);});
  renderHand();$('nextRound').hidden=!(state.phase==='roundEnd'&&state.hostId===socket.id);
  $('forfeitGame').hidden=state.phase==='gameOver'||state.me?.eliminated;
  const winnerOverlay=$('winnerOverlay');
  if(state.phase==='gameOver'){
    const w=state.players.find(p=>p.id===state.winnerId);
    $('winnerName').textContent=w?.name||'A player';
    $('winnerWins').textContent=`${w?.matchesWon||0} match win${(w?.matchesWon||0)===1?'':'s'}`;
    $('playAgain').hidden=state.hostId!==socket.id;
    $('waitingForHost').hidden=state.hostId===socket.id;
    winnerOverlay.hidden=false;
    if(winnerOverlay.dataset.winner!==state.winnerId){winnerOverlay.dataset.winner=state.winnerId||'';sound('win');}
  }else{winnerOverlay.hidden=true;winnerOverlay.dataset.winner='';}
}
function renderHand(){
  const wrap=$('hand');wrap.innerHTML='';const isTurn=state.phase==='playing'&&state.currentPlayerId===state.me?.id;const ledSuit=state.trick[0]?.card.suit;const hasLed=ledSuit&&state.me.hand.some(c=>c.suit===ledSuit);
  state.me.hand.forEach(card=>{const ok=isTurn&&(!ledSuit||!hasLed||card.suit===ledSuit);const el=cardEl(card,true);el.disabled=!ok;el.classList.toggle('playable',ok);el.onclick=async()=>{sound('card');const r=await act('playCard',{cardId:card.id});if(r?.error)toast(r.error)};wrap.appendChild(el);});
  if(state.me.eliminated)$('handHint').textContent='You are out, but can watch and chat.';else if(state.phase==='chooseTrump'&&state.currentPlayerId===state.me.id)$('handHint').textContent='Look at your hand, then choose trump.';else if(isTurn)$('handHint').textContent=ledSuit&&hasLed?`Your turn — follow ${ledSuit}.`:'Your turn — play any card.';else $('handHint').textContent='Only you can see these cards.';
}
function renderChat(){
  const wrap=$('chatMessages');wrap.innerHTML='';state.chat.forEach(m=>{const el=document.createElement('div');el.className=`chat-message ${m.system?'system':m.playerId===state.me?.id?'mine':''}`;el.innerHTML=m.system?escapeHtml(m.text):`<b>${escapeHtml(m.name)}</b>${escapeHtml(m.text)}`;wrap.appendChild(el);});wrap.scrollTop=wrap.scrollHeight;
}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function openRules(){ $('rulesDialog').showModal(); }
$('openRulesHome').onclick=openRules;
$('openRulesGame').onclick=openRules;
$('closeRules').onclick=()=>$('rulesDialog').close();
$('rulesDialog').addEventListener('click',e=>{if(e.target===$('rulesDialog'))$('rulesDialog').close();});

$('name').addEventListener('change',saveProfile);
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.tab-pane').forEach(x=>x.classList.toggle('active',x.id===tab.dataset.tab));});
$('copyFriendCode').onclick=async()=>{await navigator.clipboard?.writeText(profile.friendCode);toast('Friend code copied');};
$('refreshRooms').onclick=()=>socket.emit('registerPresence',{name:currentName(),friendCode:profile.friendCode});
$('openCreatePublic').onclick=()=>{createPublic=true;$('createTitle').textContent='Create public game';$('createDialog').showModal();};
$('openCreatePrivate').onclick=()=>{createPublic=false;$('createTitle').textContent='Create private game';$('createDialog').showModal();};
$('confirmCreate').onclick=async e=>{e.preventDefault();const r=await act('createRoom',{...commonPayload(),isPublic:createPublic,roomName:$('newRoomName').value,maxPlayers:$('maxPlayers').value});if(r?.error){$('homeError').textContent=r.error;return;}$('createDialog').close();storeSession(r.code,r.reconnectToken);};
$('joinPrivate').onclick=()=>joinCode($('joinCode').value);
$('addFriend').onclick=()=>{const code=$('friendCodeInput').value.trim().toUpperCase();if(!code||code===profile.friendCode)return toast('Enter a different friend code');if(!profile.friends.some(f=>f.code===code))profile.friends.push({code,name:presence.find(p=>p.friendCode===code)?.name||code});$('friendCodeInput').value='';saveProfile();renderFriends();};
$('start').onclick=async()=>{const r=await act('startGame');if(r?.error)toast(r.error);};
$('nextRound').onclick=async()=>{const r=await act('nextRound');if(r?.error)toast(r.error);};
async function leaveToHome(){await act('leaveRoom');clearSession();state=null;clearInterval(timerTick);showScreen('home');}
$('leaveRoom').onclick=async()=>{if(state?.phase&&state.phase!=='lobby'&&state.phase!=='gameOver'){$('forfeitDialog').showModal();return;}await leaveToHome();};
$('forfeitGame').onclick=()=>$('forfeitDialog').showModal();
$('confirmForfeit').onclick=async e=>{e.preventDefault();const r=await act('forfeitGame');if(r?.error){toast(r.error);return;}$('forfeitDialog').close();clearSession();state=null;clearInterval(timerTick);showScreen('home');toast('Game forfeited');};

$('playAgain').onclick=async()=>{const r=await act('playAgain');if(r?.error)toast(r.error);};
$('winnerLeave').onclick=leaveToHome;
$('shareRoom').onclick=async()=>{const text=`Join my Last Trick Standing game. Room code: ${state.code}`;if(navigator.share)await navigator.share({title:'Game invite',text,url:location.origin});else{await navigator.clipboard?.writeText(`${text} ${location.origin}`);toast('Invite copied');}};
$('inviteFriends').onclick=()=>{renderInviteFriends();$('friendsDialog').showModal();};
$('soundToggle').onclick=()=>{audioEnabled=!audioEnabled;localStorage.setItem('ltsSound',audioEnabled?'on':'off');$('soundToggle').textContent=audioEnabled?'🔊':'🔇';sound();};
$('chatToggle').onclick=()=>{$('chatDrawer').classList.add('open');$('chatDrawer').setAttribute('aria-hidden','false');unread=0;$('chatUnread').textContent='';};
$('closeChat').onclick=()=>{$('chatDrawer').classList.remove('open');$('chatDrawer').setAttribute('aria-hidden','true');};
async function sendChat(){const text=$('chatInput').value.trim();if(!text)return;const r=await act('chatMessage',{text});if(!r?.error)$('chatInput').value='';else toast(r.error);}
$('sendChat').onclick=sendChat;$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendChat();});
renderFriends();
