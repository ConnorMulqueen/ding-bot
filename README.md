# ![hunters_mark](https://github.com/user-attachments/assets/dc14a029-67cd-4c27-8283-799f7ac6ae2a) Ding bot 
A Discord Bot that tracks WoW: Forever character levels via Blizzard API and sends discord messages level up (aka DINGs)

<img width="448" height="871" alt="image" src="https://github.com/user-attachments/assets/a7304735-57c2-45f9-8f3a-7fdc6a584021" />

### How characters are identified
WoW: Forever has no realms. A character is identified by **first name + last name**, which is unique across the whole region (all rulesets), so you never pass a server.

### Discord Commands
```
!track [first name] [last name]
!untrack [first name] [last name]
!check [first name] [last name]
!bulkTrack [first name] [last name], [first name] [last name], etc   (!batchTrack also works)
!listtracks
!listnames
!hardrefresh
!debugLevelUp [first name] [last name]
!help
```

Examples:
```
!track Cold Potato
!check Cold Potato
!bulkTrack Cold Potato, Warm Biscuit, Sir Loin
!untrack Cold Potato
```

- Commands are case-insensitive (`!TRACK cold potato` works). Names are displayed as "First Last".
- `!check` works for any character, tracked or not.
- If Blizzard returns 404 for a character, its Forever profile probably hasn't been populated yet. Try again later.
- The character's ruleset (Normal / PvP / RP / Hardcore) is shown when Blizzard returns it.
- The bot checks tracked characters for level-ups every 10 minutes.

### How to run

Copy `.env.example` to `.env` and fill it in:
```
BOT_TOKEN= <-- discord token
API_CLIENT_ID= <-- blizz token
API_CLIENT_SECRET= <-- blizz token
BLIZZARD_REGION=us <-- optional, defaults to us
```

And in your terminal:
```
npm install
node index.js
```

`tracked.json` is created automatically on first run and is gitignored. See `tracked.example.json` for its shape.

### Note: the Forever API is undocumented
Blizzard serves WoW: Forever through the `profile-forever-{region}`, `static-forever-{region}` and `dynamic-forever-{region}` namespaces, which are **not documented** and could change without notice. The bot calls:
```
GET https://us.api.blizzard.com/profile/wow/character/{first}-{last}?namespace=profile-forever-us&locale=en_US
```
