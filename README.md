# Fantasy Baseball Draft Tool

Draft assistant for Yahoo Fantasy Baseball. Imports FanGraphs projections, calculates Z-scores and auction values, and tracks your draft in real-time.

Supports **Roto 5x5** (snake) and **H2H 6x6** (auction) leagues. Categories are auto-synced from Yahoo API.

## Setup

**Requirements:** PHP 7+ (XAMPP / MAMP / `php -S localhost:8000`)

1. Clone and place in your web server directory
2. Open `http://localhost/fantasy-baseball-draft-tool/`
3. (Optional) Copy `api/yahoo-config.sample.php` → `api/yahoo-config.php` and add your Yahoo API credentials

## Usage

### 1. Setup Tab

- Connect Yahoo account → select league → settings auto-sync (teams, roster, categories)
- Or manually configure league settings
- Adjust category weights (e.g. set SV to 0 to punt saves)

### 2. Projections Tab

- Paste FanGraphs [Fantasy Dashboard](https://www.fangraphs.com/fantasy-dashboard) data (hitters + pitchers)
- Auto-detect format, parse, and save

### 3. Yahoo Tab

- Sync player positions from Yahoo API, or paste manually
- Merge with FanGraphs data

### 4. Rankings Tab

- Z-score rankings with category weights applied
- Dollar values for auction drafts
- Filter by position, search by name

### 5. Draft Tab

- Paste Yahoo Live Draft → **Draft Results** tab (Ctrl+A → Ctrl+C → Ctrl+V)
- Auto-detect your team, track all picks
- **My Roster panel** — greedy position assignment shows filled/empty slots
- Smart recommendations with NEED / SCARCE / UV tags
- Positional scarcity heatmap
- Market inflation tracker (auction)

## Data Flow

```
FanGraphs projections → Projections Tab → hitters.csv / pitchers.csv
Yahoo positions        → Yahoo Tab      → positions.csv
                       → Merge          → merged.csv
                       → Calculator     → Z-scores + $ values
                       → Draft Tab      → Recommendations
```

## Project Structure

```
├── index.html            Main UI
├── js/
│   ├── app.js            Controller + UI logic
│   ├── calculator.js     Z-score & dollar value engine
│   ├── parser.js         FanGraphs parser
│   ├── yahooParser.js    Yahoo position parser
│   ├── yahooApi.js       Yahoo API integration (OAuth)
│   └── draftManager.js   Draft state (dual league)
├── api/
│   ├── auth.php          Yahoo OAuth 2.0
│   ├── yahoo.php         Yahoo API proxy
│   ├── save.php / load.php
│   └── yahoo-config.php  (not tracked, add credentials)
├── data/                 CSV storage (not tracked)
└── css/styles.css
```

## Notes

- Two-way players (Ohtani) are split into separate hitter/pitcher entries
- All data stored locally. Nothing sent to external servers.
- Not affiliated with FanGraphs, Yahoo, or MLB.

## License

MIT
