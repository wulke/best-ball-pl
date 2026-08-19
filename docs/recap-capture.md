# Capturing your recap (bookmarklet)

The cheat sheet is a **static page** — it runs entirely in your browser and never talks
to Underdog. Underdog's recap lives behind a login on `app.underdogsports.com`, and a
static site can't fetch it (login + CORS), so *you* capture the recap on Underdog's page
and hand it to the sheet. That capture is one click with the bookmarklet below.

## Install

1. Show your bookmarks bar (Chrome: `Cmd+Shift+B`).
2. Drag this link onto the bar (or right-click → *Copy Link Address* → paste it into a
   bookmark's URL field):

```
<a href="javascript:(function () {var url = /\/draft\/[0-9a-f-]{36}/i.test(location.href) ? location.href : '';var BLOCK = /^(P|DIV|BUTTON|LI|TR|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|TABLE|BR|TITLE)$/;var parts = [];function walk(node) {if (node.nodeType === 3) { parts.push(node.textContent); return; }if (node.nodeType === 11) { for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]); return; }if (node.nodeType !== 1) return;var tag = node.tagName;if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;if (tag === 'TEMPLATE' && node.content) { walk(node.content); return; }if (BLOCK.test(tag)) parts.push('\n');for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);if (BLOCK.test(tag) && tag !== 'BR') parts.push('\n');}walk(document.documentElement);var text = parts.join('').split('\n').map(function (s) { return s.trim(); }).filter(Boolean).join('\n');var payload = url ? url + '\n\n' + text : text;function fallback() {var ta = document.createElement('textarea');ta.value = payload;ta.style.position = 'fixed'; ta.style.opacity = '0';document.body.appendChild(ta);ta.focus(); ta.select();try { document.execCommand('copy'); alert('Recap copied \u2014 paste it into the cheat sheet Drafts tab.'); }catch (e) { alert('Could not copy \u2014 select and copy the recap manually.'); }document.body.removeChild(ta);}if (navigator.clipboard && navigator.clipboard.writeText) {navigator.clipboard.writeText(payload).then(function () { alert('Recap copied \u2014 open the cheat sheet Drafts tab and hit Paste from clipboard (or Cmd+V).'); }, fallback);} else { fallback(); }})();">Capture Underdog recap</a>
```

Browsers won't let you *click* a `javascript:` link in a normal page — dragging it onto the
bookmarks bar (or copying the URL into a bookmark's address field) is how it installs.

## Use

1. Open your **completed recap** on `app.underdogsports.com` (logged in).
2. Click **Capture Underdog recap** in your bookmarks bar.
3. The recap text (plus the draft URL) is copied to your clipboard — an alert confirms.
4. Open the cheat sheet → **Drafts** tab → click **Paste from clipboard** (or click into
   the paste box and `Cmd+V`) → **Parse & preview**.

The bookmarklet captures the page the same way a copy would — block boundaries become
line breaks, inline elements stay glued — so the parser sees exactly what the
paste/file intake sees. Verified lossless against the first real recap's saved page.

> No `.mhtml` files needed with this flow. If you prefer saving pages, the **Load recap
> file** button in the Drafts view reads Chrome/Edge single-file `.mhtml` (⌘S → *Webpage,
> Single File*), `.html`, or `.txt` saves directly.

## Your data stays yours

Everything is **localStorage in your browser** — rooms, matches, the carry card, drafted
marks. Nothing is uploaded anywhere; there is no server to upload to. Each person who
opens the GitHub Pages URL gets their own isolated copy of the app and their own data.

- **Export** a room → downloads `data/drafts/<date>-<slug>.json` (commit it to move it
  between machines, or just keep it local).
- **Import** reads it back.

## Why not fetch the recap automatically?

The sheet can't read `app.underdogsports.com`: the draft is behind your login and the
API doesn't allow cross-origin reads from an arbitrary static site. The bookmarklet runs
*inside* your Underdog session, which is the only place the recap is reachable.
