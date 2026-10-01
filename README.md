# Reel Weights

**Mix several movie and TV searches into one list, ranked by sliders you set.**

IMDb's advanced search is powerful, but movies, TV episodes and series don't compare well in a single search: a 9.6 episode with 1,200 votes and an 8.4 movie with 900,000 votes are hard to rank side by side. Reel Weights runs a separate search for each kind of title, keeps each one at a useful size, and merges the results into one list that you rank with sliders.

> Reel Weights works with IMDb but is not affiliated with, endorsed by, or sponsored by IMDb or Amazon. IMDb is a trademark of IMDb.com, Inc.

<img width="1901" height="893" alt="Example" src="https://github.com/user-attachments/assets/9d8493f5-12ba-4654-9051-c1a4ea08e017" />

## What it does

- **One search per title type.** Movies & TV movies, TV episodes & specials, and TV series & mini series each get their own search.
- **Self-tuning searches.** Each search aims for a number of results you choose, 50 to 200 by default. After every fetch, the minimum rating and minimum vote count both move a little, so the search stays in that range as new titles come out and you watch old ones.
- **Weighted ranking.** Sliders control how much each of these matters: how recent a title is, popularity, user rating, number of ratings, and Metascore. You also get a slider for each title type, each genre, and IMDb's finer sub-genres.
- **Your own filters.** Year range, popularity rank, and countries to leave out. If you're signed in to IMDb, you can also hide titles you've watched, rated, or added to your watchlist.
- **Your own searches.** Paste any IMDb advanced-search URL and its results are merged in too.
- **Quality-of-life tools.** Hide titles you're not interested in, filter by length or genre, cap episodes per show, open trailers, and export the list to CSV.

## Install

Reel Weights isn't in an extension store yet, so you load it directly. This works in Chrome, Edge, Brave, and other Chromium browsers.

1. Download this repository: **Code → Download ZIP**, then unzip it.
2. Open `chrome://extensions`, or `edge://extensions` in Edge.
3. Turn on **Developer mode** (top right in Chrome, left sidebar in Edge).
4. Click **Load unpacked** and select the unzipped folder.
5. Pin Reel Weights from the extensions (puzzle piece) menu, then click its icon to open it.

Keep the folder where it is after installing: the browser loads the extension from it. To update, replace the files in the same folder and click the reload arrow on the extension's card. Settings are tied to the folder location, so moving it resets them.

## Using it

1. **Sign in to IMDb** in the same browser. Searching works without signing in, but "hide titles I've watched / rated / watchlist" only works when you're signed in.
2. Open Reel Weights. It fetches automatically when the page opens; turn this off with **Fetch on open** in the header.
3. Drag the sliders. The list re-ranks instantly. Each title type is ranked against its own kind, so movies are compared with movies and episodes with episodes. The type sliders then set the mix.
4. Adjust the sidebar to taste: result range, filters, countries, vote and rating starting points. If a search keeps landing outside your range, keep fetching; it narrows in over a few fetches.

### If nothing comes back

Reel Weights shows a box with a link to the exact search it ran. Open it and check:

- **A robot check page?** Complete it, come back, and fetch again.
- **Signed out?** Sign in to IMDb and fetch again.
- **No results on IMDb either?** The filters are too strict. Loosen them in the sidebar.

## How it works

Reel Weights fetches IMDb's own advanced-search pages from your browser, using your existing IMDb session. It does this in a background tab it opens and then closes. It reads the result data IMDb puts in those pages, and makes one batched request to the data service imdb.com itself uses to look up sub-genres. Sub-genres are cached so each title is only looked up once.

A typical fetch is a handful of requests, about what you'd make by clicking through a few search pages yourself.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Saves your settings, hidden titles, and the last results in your browser. |
| `scripting` | Runs the search requests inside an imdb.com tab so they use your IMDb sign-in. |
| `https://www.imdb.com/*` | Fetches IMDb search pages. |
| `https://api.graphql.imdb.com/*` | Looks up sub-genres for the titles in your results. |

## Privacy

Reel Weights has no server and collects nothing. Your settings and results stay in your browser, and the only site it talks to is IMDb. See [PRIVACY.md](PRIVACY.md).

## Limitations

- IMDb returns at most 250 results per search, so each search is capped at 250 titles.
- Reel Weights depends on how IMDb's pages and data are structured. When IMDb changes them, parts of it may break until it's updated.
- Sub-genre lookups rely on an IMDb service that isn't documented for outside use and may stop working.
- Please use it like a person would. Fetching over and over in a short time may trigger IMDb's robot checks.

## License

[MIT](LICENSE)
