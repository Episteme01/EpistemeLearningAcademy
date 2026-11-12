# Islamic portal (/islamic)

Public, no login. Every religious text and recording is fetched live from a named provider; none is typed into this repo except the adhkar and Tajweed outline listed below.

| Section | Source | Notes |
|---|---|---|
| Qur'an (114 surahs, 30 juz', search, bookmarks) | AlQuran Cloud `quran-uthmani` + `en.sahih` | Search is on the English translation. Bookmarks live in the browser (localStorage). |
| Listen | MP3Quran.net `/api/v3/reciters` | Count is shown live. Audio URL = `<moshaf.server>/<001>.mp3`. Controls: play/pause, seek, previous/next, repeat, volume, error message. |
| Prayer times | AlAdhan `/v1/timings` | Ilorin default; 6 places; 6 methods; countdown uses Africa/Lagos clock. |
| Hadith | hadith-api (jsDelivr) – Forty Hadith of an-Nawawi, one per day | Grading shown only if the source gives it. |
| Adhkar | In `lib.ts` (with source + count). Qur'anic items fetched live | Have a teacher review the wording once. |
| Tajweed | Outline in `lib.ts` + lessons added in Website admin > Islamic content | |
| Calendar | Browser ICU Umm al-Qura | Moon-sighting caveat shown. |

CMS: Website admin > **Islamic content** (collection `islamicContent`, public read only when `status == published`). Republish `firebase/firestore.rules`.

## Not verified from the build sandbox
The sandbox could not reach the provider APIs, so the response shapes above are coded from the providers' published documentation and parsed defensively but **not tested against live responses**. Open `/islamic` after deploy and check each tab. If the MP3Quran list has fewer than 50 reciters, the page says so; add a second provider adapter in `api.ts` if that ever happens.

## Update 2 — dashboard, khutbah, videos, background audio, scripts, sharing, reminders
- **Home tab:** live clock and Gregorian/Hijri date (Africa/Lagos), next prayer, verse of the day (AlQuran Cloud, one ayah per calendar day), hadith of the day, picture slider, news, latest khutbah and video. Pictures, news, khutbahs and videos come from Website admin > Islamic content (sections: news, khutbah, video, gallery, social).
- **Khutbah:** Arabic text and translation (show both / Arabic / translation), audio (direct audio link, plays in the site player) and optional YouTube video.
- **Videos:** YouTube links, embedded with youtube-nocookie.
- **Background audio:** one audio element above the router (`player.tsx`) so recitation continues across pages; Media Session API gives lock-screen controls; a surah ending starts the next surah in that reciter's list; bar at the bottom of every page. It stops if the browser tab/app is closed, and when someone navigates to the portal (/app).
- **Qur'an reader:** by surah / juz' / Madani page (604); Arabic-only mushaf-style flow or Arabic + translation cards; scripts Uthmani, Simple (AlQuran Cloud), Tajweed colour-coded and Indo-Pak (Quran.com v4 `/quran/verses/{script}`); text size; bookmarks.
- **Sharing:** `ShareButton` (phone share sheet, else WhatsApp/Telegram/Facebook/X/Email/copy) on blog posts, verses, hadith, adhkar, khutbahs, news and social posts. Links point to the site page; GitHub Pages cannot generate per-post link previews (SPA), so previews show the site's default card.
- **/community:** public page of social posts added by editors (platform, link, optional picture or YouTube embed).
- **Reminders (any visitor, no login):** prayer times (with lead time), Qur'an, daily hadith, daily dua, new blog post. Stored in the browser. They fire while the site/installed app is open (background tab included). **They cannot wake a fully closed browser.** True closed-app push for anonymous visitors would need the `notify` function extended with a public subscription list; not built.

Not verified here: the Quran.com response shapes (tajweed class names, `text_indopak`), all provider calls, the lock-screen controls and notification behaviour on real phones (iOS only works for sites added to Home Screen).
