# Yalla ⚽ — וידאו צ'אט לאוהדי כדורגל

אפליקציית ווב לוידאו צ'אט אקראי בין אוהדי אותה קבוצה.

## איך מריצים

```bash
npm install
npm start
```

ואז פתח בדפדפן: http://localhost:3000

**לבדיקה: פתח שני טאבים (או שני דפדפנים שונים), בחר את אותה קבוצה בשניהם, ולחץ "התחל".**

## מה יש בגרסה הזאת (v0.1)

- בחירת קבוצה מתוך מועדונים, נבחרות, ישראליות
- פילטרים: גיל, מגדר, שפה
- וידאו צ'אט אמיתי דרך WebRTC peer-to-peer (חינמי, בלי Agora/Twilio)
- מאצ'ינג לפי קבוצה - שני אנשים שבחרו את אותה קבוצה מתחברים
- כפתור Skip לעבור לאוהד הבא
- צ'אט טקסטואלי במהלך השיחה
- מצלמה/מיקרופון - הפעלה/כיבוי
- ספירת אוהדים אונליין בזמן אמת
- שמירת פרופיל ב-localStorage (אין צורך להירשם מחדש)

## מה עוד צריך (v0.2+)

- אימות גיל ופרצוף (Selfie + AI)
- Fan Test לפני כניסה
- מאצ'ינג מתקדם - שפה, אזור, גיל
- NSFW Moderation (Hive / AWS Rekognition)
- מערכת דיווחים אמיתית + ban
- שמירת חברים (Friends list) - דורש DB
- Database אמיתי (Postgres/Supabase)
- TURN server לחיבורים מאחורי NAT קשה
- אימות בעלות חולצה (Selfie verification)
- מודל פרימיום ותשלומים
- אנליטיקס

## ארכיטקטורה

```
דפדפן A  <---WebRTC---->  דפדפן B
   |                           |
   |   Socket.io (signaling)   |
   v                           v
        Node.js server
        (express + socket.io)
```

הוידאו זורם **ישירות בין הדפדפנים** (peer-to-peer). השרת שלנו מוודא רק את המאצ'ינג ומעביר את הודעות הסיגנלינג (offer/answer/ICE candidates).

זה אומר: עלות תשתית מינימלית גם בקנה מידה גדול.

## מבנה הפרויקט

```
.
├── server.js              # Node + Express + Socket.io
├── package.json
├── README.md
└── public/
    ├── index.html         # דף הנחיתה
    ├── chat.html          # מסך הצ'אט
    ├── css/style.css
    └── js/
        ├── teams.js       # רשימת הקבוצות
        ├── landing.js     # לוגיקת דף הנחיתה
        └── chat.js        # לוגיקת WebRTC
```

## Petah Tikva Streets (driving game)

A GTA-style free-roam driving game set on the real streets of Petah Tikva, at `/petah-tikva/`
(e.g. `http://localhost:3000/petah-tikva/` after `npm start`).

- Roads, buildings (with real heights where mapped), parks and trees are loaded live from
  OpenStreetMap through the Overpass API, in ~1km tiles that stream in as you drive, and are
  cached in IndexedDB.
- Taxi missions, wanted level with police chases, AI traffic and buses, day/night, minimap and full map.
- Controls: WASD / arrows, Space handbrake, H horn, C camera, N night, M map, R back to road, Esc menu.
  Touch controls on phones.
- If no Overpass server is reachable, a clearly-labelled schematic map is used instead.
