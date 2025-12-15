

# ![hunters_mark](https://github.com/user-attachments/assets/dc14a029-67cd-4c27-8283-799f7ac6ae2a) Ding bot 
A Discord Bot that sends messages on Classic WoW character level up on tracked characters via polling Blizzard's official API

<img width="448" height="871" alt="image" src="https://github.com/user-attachments/assets/a7304735-57c2-45f9-8f3a-7fdc6a584021" />

### Discord Commands
```
!track [character name] [server name]
!check [character name]
!bulkTrack [character name] [server name], [character name] [server name], [character name] [server name], etc
!listtracks
!hardrefresh
```

### How to run

create a ".env" file with your bot token
```
BOT_TOKEN= <-- discord token
API_CLIENT_ID= <-- blizz token
API_CLIENT_SECRET= <-- blizz token
```

And in your terminal:
```
npm install
node index.js
```
