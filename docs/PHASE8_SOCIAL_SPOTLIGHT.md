# Social Spotlight ("From the ELA Community")

Public: homepage section (up to 4 posts, "View all") and `/spotlight` (alias `/community`): filters, 12 per page, shareable `?post=<id>` links.
Admin: Website admin → **Social Spotlight** (CMS publishers: create, edit, delete, draft/publish, feature, order, publication date).

## Collection `socialPosts`
| Field | Notes |
|---|---|
| `type` | `image` \| `video` \| `text` (required) |
| `title` | 2–140 chars (required, also enforced in rules) |
| `caption` | ≤ 300 chars |
| `body` | rich text, sanitised on display (`sanitizeHtml`); required for text posts |
| `imageUrl`, `thumbnailUrl` | https links (Cloudinary via the CMS image field, or any https image) |
| `videoUrl` | validated against an allowlist (below) |
| `status` | `draft` \| `published` |
| `featured`, `order`, `publishedAt` | display control; future `publishedAt` hides the post in the app |

Rules: read if `status == 'published'` or staff; write only CMS publishers. **No new index** (equality filter on `status` only; sorting is done in the browser).

## Video safety / performance
* Only YouTube (youtube-nocookie), Vimeo, Google Drive `/preview` and direct https `.mp4/.webm` links are accepted (`src/lib/spotlight.ts`, tested). Anything else is rejected when saving and never rendered.
* Nothing loads until the visitor taps play; the player is removed when the viewer closes or the visitor moves to another post. Iframes are sandboxed. A 12-second "taking long" notice offers "Open on YouTube/Vimeo". Direct files use `<video preload="none">` with an error fallback.
* The viewer: next/previous buttons, swipe up/down, arrow keys, Esc, focus on close button, scroll lock, no animation when the visitor prefers reduced motion.
* Posts are read once and cached for 5 minutes; the homepage hides the section if there are no posts or the read fails.

## Known limits
* A future publication date hides the post in the website only; the document itself is still readable by anyone who queries Firestore directly. Keep unpublished material as **Draft**.
* Vimeo/Drive videos have no automatic thumbnail: add a custom thumbnail.
* Whether a given private/unlisted video plays depends on the provider's own sharing settings.
* The old `social` items in "Islamic content" are no longer shown on `/community` (it now shows Spotlight posts).

## Update: any video link, categories (Nov 2026)
- **Video links:** any `https://` link is accepted. YouTube, Vimeo, Google Drive, Dailymotion, Facebook, Instagram, TikTok, Streamable and Loom are embedded from their own player; direct `.mp4/.webm/.ogv/.m4v/.mov` files play in the page; **every other site shows a "Watch on <site>" button that opens it in a new tab** (unknown sites are deliberately never framed). Plain `http://` links, links with a username/password and `javascript:`/`data:` are refused. Some sites (private Facebook/Instagram posts, TikTok on some phones) refuse to be embedded; the viewer then offers the open-on-site link.
- **Categories:** School Events, Academics & Learning, Student Life, Sports & Arts, Islamic & Character, Parents & Community, Announcements, Other (`SPOTLIGHT_CATEGORIES` in `src/lib/spotlight.ts` — edit that list to rename or add). Posts saved before this update have no category and appear as "Other"; nothing in the database is rewritten. The /spotlight page shows category chips (only those in use) on top of the Photos/Videos/Articles filter.

## Update: Islamic portal
- **Video categories:** Qur'an, Stories (Seerah), Admonitions (Khutbah), Videos for Kids, Other Videos (`category` on `islamicContent` items of section "Video"). Existing videos have no category, so they remain visible under **All** and **Other Videos** and no stored data is touched; open each in Website admin → Islamic content and pick a category to move it.
- **Dashboard pictures:** tapping a picture opens a full-screen preview (next/previous, Esc to close) with a Download button; each thumbnail also has a download icon. Download fetches the picture and saves it; if the image host blocks that, Cloudinary links use `fl_attachment`, otherwise the picture opens in a new tab to save manually.
