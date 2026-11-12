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
