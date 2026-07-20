# Last Trick Standing — Version 2

A mobile-first online multiplayer implementation of the family card game previously called Trumps/Clubs.

## Features

- Private hands and server-enforced follow-suit rules
- Public room browser and private invite-code rooms
- Device-based friend codes with online presence and game invitations
- In-game chat
- Animated cards, trick animations, mobile felt-table layout
- Optional subtle sound effects
- Reconnection to an active game after a page refresh or brief connection loss
- Doggie Life in round one, elimination rounds, tie cuts, trump selection, and one-card final

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two or more browser windows/devices.

## Deploy on Render

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

The server uses `process.env.PORT` automatically.

## Important architecture note

Rooms, chat and online presence are stored in server memory. A Render restart or redeploy clears active games. For a large public launch, move room/session state to Redis and add moderation/rate limits.

Friend lists are stored locally in each browser because this edition deliberately has no user accounts.


## Turn timer and forfeiting

Each action turn has a server-enforced 30-second countdown. If it expires, a legal card is selected automatically; during trump selection, the suit most represented in the player's hand is selected. Players can use **Forfeit game** to leave an active match cleanly.


## In-app rules

Players can open **How to play** from the home screen or tap the **?** button during a game.
