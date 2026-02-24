# Fantasy Baseball Draft Tool

Draft assistant for Yahoo Fantasy Baseball. Fetches FanGraphs projections, calculates Z-scores and auction values, and tracks your draft in real-time.

Supports any Yahoo league format — categories, roster composition, and draft type are auto-synced from Yahoo API.

## Setup

**Requirements:** PHP 7+ with cURL extension (XAMPP / MAMP / `php -S localhost:8000`)

1. Clone and place in your web server directory
2. Open `http://localhost/fantasy-baseball-draft-tool/`
3. Copy `api/yahoo-config.sample.php` → `api/yahoo-config.php`
4. Create a Yahoo app at [developer.yahoo.com/apps](https://developer.yahoo.com/apps/):
   - Application Type: **Installed Application**
   - Redirect URI: `https://localhost/fantasy-baseball-draft-tool/api/callback.php`
   - API Permissions: **Fantasy Sports** (Read)
5. Paste your Client ID and Client Secret into `api/yahoo-config.php`

## Usage

### 1. Setup Tab

- Connect Yahoo account → select league → settings auto-sync (teams, roster, categories, draft type)
- Fetch FanGraphs projections (THE BAT X, Steamer, ZiPS, ATC)
- Adjust category weights (e.g. set SV to 0 to punt saves)

### 2. Yahoo Tab

- Sync player positions from Yahoo API
- Merge with FanGraphs projections → generates Z-scores and dollar values

### 3. Rankings Tab

- Z-score rankings with category weights applied
- Dollar values for auction drafts
- Filter by position, search by name

### 4. Draft Tab

- Paste Yahoo Live Draft log (Draft Results tab: Ctrl+A → Ctrl+C → Ctrl+V)
- Auto-detect your team name and track all picks
- **My Roster** panel — position-by-position view of your team with greedy slot assignment
- Smart recommendations with **NEED** (roster gap) / **SCARCE** (market drying up) / **UV** (undervalued) tags
- Positional scarcity heatmap
- Market inflation tracker (auction mode)

## Data Flow

```
FanGraphs API  → Setup Tab    → hitters.csv / pitchers.csv
Yahoo API      → Yahoo Tab    → positions.csv
                → Merge       → merged.csv
                → Calculator  → Z-scores + $ values
                → Draft Tab   → Recommendations
```

## Project Structure

```
├── index.html            Main UI (single page)
├── js/
│   ├── app.js            Controller + UI logic
│   ├── calculator.js     Z-score & dollar value engine
│   ├── parser.js         FanGraphs projection parser
│   ├── yahooParser.js    Yahoo position parser
│   ├── yahooApi.js       Yahoo OAuth 2.0 + API integration
│   └── draftManager.js   Draft state management
├── api/
│   ├── auth.php          Yahoo OAuth 2.0 flow
│   ├── callback.php      OAuth callback handler
│   ├── yahoo.php         Yahoo API proxy
│   ├── fangraphs.php     FanGraphs projection fetcher
│   ├── save.php / load.php  CSV persistence
│   └── yahoo-config.php  Credentials (not tracked)
├── data/                 CSV + token storage (not tracked)
└── css/style.css
```

## Notes

- Two-way players (Ohtani) are tracked as separate hitter/pitcher entries
- All data stored locally on your server. Nothing sent to third-party services beyond Yahoo/FanGraphs APIs.
- Not affiliated with FanGraphs, Yahoo, or MLB.

## License

MIT
