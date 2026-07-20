# Last Trick Standing

A real-time multiplayer browser game based on the described house rules.

## Included

- Room creation and five-character room codes
- Nickname-based player joining
- Each player sees only their own hand
- Server-authoritative dealing and play validation
- Follow-suit enforcement
- Trump suit and turned-card display
- Trick winner calculation and next-leader handling
- Seven-card opening round, then decreasing hand sizes
- Round-one Doggie Life
- Elimination for zero tricks after later rounds
- Most-tricks round winner chooses the next trump suit
- Automatic high-card cut when most tricks are tied
- One-card final showdown

## Run locally

1. Install Node.js 18 or newer.
2. In this folder run:

   npm install
   npm start

3. Open `http://localhost:3000`.
4. Other players on the same network can use your computer's local IP address, for example `http://192.168.1.20:3000`.

## Notes

This MVP uses room nicknames rather than permanent accounts. Rooms are stored in memory and reset when the server restarts. For public deployment, add HTTPS, persistent storage, reconnection tokens, account authentication, and a production host such as Render, Railway, Fly.io, or a VPS.
