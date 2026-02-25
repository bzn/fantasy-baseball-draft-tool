# Fantasy Baseball Draft Tool

Draft assistant for Yahoo Fantasy Baseball. Fetches FanGraphs projections, calculates Z-scores and auction values, and tracks your draft in real-time.

Supports any Yahoo league format — categories, roster composition, and draft type are auto-synced from Yahoo API.

## Quick Start

1. Clone and serve with PHP (XAMPP, MAMP, or `php -S localhost:8000`)
2. Open `http://localhost/fantasy-baseball-draft-tool/`
3. Enter your Yahoo API credentials (see [Yahoo API Setup](#yahoo-api-setup) below)
4. Connect your Yahoo account → select your league → settings auto-sync
5. Load player positions from Yahoo → fetch FanGraphs projections
6. Go to **Rankings** tab for Z-score rankings, or **Draft** tab on draft day

## Yahoo API Setup

You need a Yahoo Developer App to connect to the Yahoo Fantasy API. Two ways to provide credentials:

### Option A: Enter in UI (Recommended)

No config file needed. Enter your Client ID and Client Secret directly in the Setup tab.

### Option B: Config File

```bash
cp api/yahoo-config.sample.php api/yahoo-config.php
# Edit api/yahoo-config.php with your credentials
```

### Creating a Yahoo Developer App

1. Go to [developer.yahoo.com/apps](https://developer.yahoo.com/apps/) and sign in
2. Click **Create an App**
3. Fill in the form:
   - **Application Name**: anything (e.g. "Fantasy Draft Tool")
   - **Application Type**: choose **Installed Application**
   - **Redirect URI(s)**: enter `https://localhost/fantasy-baseball-draft-tool/api/callback.php`
   - **API Permissions**: check **Fantasy Sports** → select **Read**
4. Click **Create App**
5. Copy the **Client ID (Consumer Key)** and **Client Secret (Consumer Secret)**
6. Paste them into the Setup tab UI or `api/yahoo-config.php`

> **HTTPS Required**: Yahoo OAuth requires HTTPS redirect URIs. If you're using XAMPP on localhost, enable SSL in Apache (XAMPP comes with a self-signed cert at `xampp/apache/conf/ssl.*`). Enable `mod_ssl` in `httpd.conf` and restart Apache. Your browser will show a security warning for the self-signed cert — accept it once.

## Usage

### 1. Setup Tab

- Connect Yahoo account → select league → settings auto-sync (teams, roster, categories, draft type)
- Load player positions from Yahoo API
- Load Draft Analysis (ADP) from Yahoo API for the Undervalued tab
- Fetch FanGraphs projections (THE BAT X, Steamer, ZiPS, ATC)
- Adjust category weights (e.g. set SV to 0 to punt saves)

### 2. Rankings Tab

- Z-score rankings with category weights applied
- Dollar values for auction drafts
- Filter by position, search by name

### 3. Draft Tab

- Paste Yahoo Live Draft log (Draft Results tab: Ctrl+A → Ctrl+C → Ctrl+V)
- Auto-detect your team name and track all picks
- **My Roster** panel — position-by-position view of your team with greedy slot assignment
- Smart recommendations with **NEED** (roster gap) / **SCARCE** (market drying up) / **UV** (undervalued) tags
- Positional scarcity heatmap
- Market inflation tracker (auction mode)

### 4. Undervalued Tab

- Compares your Z-score rankings against Yahoo's Draft Analysis (ADP / average cost)
- Shows players Yahoo drafters are undervaluing relative to your projections
- Supports both standard (ADP rank) and auction (average cost) modes
- ADP data can be loaded dynamically from Yahoo API or falls back to static `data/yahoo_adp.json`

## Data Flow

```
FanGraphs API  → Setup Tab    → hitters.csv / pitchers.csv
Yahoo API      → Setup Tab    → positions.csv + Draft Analysis (ADP)
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

## FAQ

**Q: Token expired / "Please login again"**
A: Yahoo tokens expire after 1 hour. The app auto-refreshes them, but if your refresh token is also expired (after 28 days of inactivity), click Logout then Login again.

**Q: "Redirect URI mismatch" error during login**
A: Make sure the Redirect URI in your Yahoo Developer App matches exactly:
`https://localhost/fantasy-baseball-draft-tool/api/callback.php`
(including the `https://` and trailing path). If you changed the install directory, update both the Yahoo app and `api/yahoo-config.php`.

**Q: HTTPS / SSL not working on localhost**
A: Yahoo requires HTTPS for OAuth. With XAMPP:
1. Open `xampp/apache/conf/httpd.conf`, uncomment the `Include conf/extra/httpd-ssl.conf` line
2. Open `xampp/apache/conf/extra/httpd-ssl.conf`, verify paths to `server.crt` and `server.key`
3. Restart Apache
4. Visit `https://localhost` and accept the self-signed certificate warning

**Q: Can I use this without Yahoo API?**
A: Yes — you can manually import FanGraphs projections via the Projections tab and paste Yahoo positions. The Yahoo connection automates this and adds features like ADP data and draft sync.

## Notes

- Two-way players (Ohtani) are tracked as separate hitter/pitcher entries
- All data stored locally on your server. Nothing sent to third-party services beyond Yahoo/FanGraphs APIs.
- Not affiliated with FanGraphs, Yahoo, or MLB.

## License

MIT
