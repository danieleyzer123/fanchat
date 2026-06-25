# 🚀 דיפלוי FANCHAT לאוויר

מדריך השקה לאוויר ב-3 דרכים, מהקלה לקשה.

## 🟢 דרך 1 (הכי קלה): Render.com - חינם

Render הוא השירות הכי פשוט שתומך ב-WebSocket (קריטי לוידאו צ'אט).

### שלב א: צור חשבון GitHub (אם אין)
1. לך ל-https://github.com/signup
2. צור חשבון חינמי
3. צור Repository חדש בשם `fanchat` (Public)

### שלב ב: דחוף את הקוד ל-GitHub
פתח PowerShell בתיקייה של הפרויקט והקלד:
```powershell
git init
git add .
git commit -m "Initial commit - FANCHAT v0.2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/fanchat.git
git push -u origin main
```
(החלף את `YOUR_USERNAME` בשם המשתמש שלך)

### שלב ג: דיפלוי ב-Render
1. לך ל-https://render.com ופתח חשבון חינמי (אפשר עם GitHub login)
2. לחץ **New +** → **Web Service**
3. חבר את ה-GitHub repo שלך (`fanchat`)
4. Render יזהה אוטומטית את הקובץ `render.yaml` ויגדיר הכל
5. לחץ **Create Web Service**
6. תוך 2-3 דקות תקבל URL כמו: `https://fanchat-xxx.onrender.com`

**⚠️ חשוב:** ב-tier החינמי השרת "נרדם" אחרי 15 דק' של חוסר פעילות, ולוקח ~30 שניות להתעורר. לא קריטי ל-MVP. שדרוג לתוכנית בתשלום ($7/חודש) מבטל את זה.

---

## 🟡 דרך 2: Railway.app - $5 קרדיט חינם

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

ה-CLI מעלה אוטומטית. ב-Dashboard של Railway, לך ל-Settings → Generate Domain.

---

## 🔵 דרך 3: Fly.io - tier חינמי

```bash
# התקנת fly CLI - PowerShell
iwr https://fly.io/install.ps1 -useb | iex

fly auth signup   # או fly auth login
fly launch        # יוצר fly.toml אוטומטית
fly deploy
```

---

## 🌐 דומיין מותאם אישית

בכל אחת מהפלטפורמות תוכל לחבר דומיין (למשל fanchat.app):
1. קנה דומיין ב-Namecheap / GoDaddy / Cloudflare ($10-15 לשנה)
2. בפלטפורמה: Settings → Custom Domain → הוסף את הדומיין
3. הוסף CNAME record בספק הדומיין שלך

---

## 🔒 הערות לפרודקשן

1. **HTTPS חובה** - WebRTC לא עובד ב-HTTP בלי localhost. כל הפלטפורמות נותנות HTTPS אוטומטית. ✅
2. **TURN Server** - השרת הנוכחי משתמש רק ב-STUN (Google חינמי). אוהדים מאחורי NAT קשה (תאגידי/חברות נוקדות) לא יתחברו. להוסיף TURN בעתיד דרך **Twilio Network Traversal** או **Coturn**.
3. **DB אמיתי** - כרגע הכל ב-memory. בעלייה למאות משתמשים תצטרך **Supabase** או **PostgreSQL** (Render נותן בחינם).
4. **Moderation** - להוסיף Hive Moderation / AWS Rekognition לזיהוי תוכן NSFW אוטומטי.

---

## ✅ צ'קליסט לפני השקה

- [ ] בדקתי עם 2 דפדפנים מקומית - **עובד**
- [ ] הקוד ב-GitHub
- [ ] השרת רץ בענן ומחזיר 200 על הדומיין
- [ ] בדקתי וידאו צ'אט אמיתי דרך הדומיין (מ-2 מכשירים שונים)
- [ ] עוברים את אונבורדינג ה-3 שלבים
- [ ] Skip עובד
- [ ] לוגואים נטענים
