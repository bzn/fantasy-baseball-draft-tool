# fantasy-baseball-draft

Fantasy Baseball draft assistant with FanGraphs projections and Yahoo integration. Supports Roto 5x5 and H2H 6x6 leagues.

## Features

- 📊 **FanGraphs Integration** - Import Fantasy Dashboard projections for hitters and pitchers
- 🎯 **Yahoo Position Eligibility** - Sync position data from your Yahoo Fantasy league
- 🧮 **Z-Score Calculations** - Statistical rankings across all scoring categories
- 💰 **Dollar Value Projections** - Auction draft pricing (H2H 6x6 leagues)
- 📝 **Draft Tracking** - Real-time draft log with pick-by-pick analysis
- ⚾ **Two-Way Player Support** - Proper handling of players like Shohei Ohtani (separate hitter/pitcher entities)
- 🔄 **Multiple League Formats**:
  - **Roto 5x5**: R, HR, RBI, SB, AVG | W, SV, K, ERA, WHIP (Snake Draft)
  - **H2H 6x6**: R, HR, RBI, SB, AVG, OPS | W, K, ERA, WHIP, QS, NSVH (Auction Draft)

## Quick Start

### Requirements

- PHP 7.0+ (XAMPP, MAMP, or any PHP server)
- Modern web browser

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/fantasy-baseball-draft.git
   ```

2. **Move to your web server directory**
   ```bash
   # For XAMPP
   mv fantasy-baseball-draft /xampp/htdocs/

   # For MAMP
   mv fantasy-baseball-draft /Applications/MAMP/htdocs/
   ```

3. **Start your PHP server**
   - XAMPP: Start Apache from the control panel
   - MAMP: Start servers
   - PHP CLI: `php -S localhost:8000` in the project directory

4. **Access the application**
   ```
   http://localhost/fantasy-baseball-draft/
   ```

## How to Use

### Step 1: Import FanGraphs Projections

1. Go to [FanGraphs Fantasy Dashboard](https://www.fangraphs.com/fantasy-dashboard)
2. Export data for both hitters and pitchers
3. Navigate to the **Projections** tab in the app
4. Paste the data and click "Parse FanGraphs Data"

### Step 2: Import Yahoo Position Data

1. Go to your Yahoo Fantasy Baseball league
2. Copy the player list (with positions)
3. Navigate to the **Yahoo** tab
4. Paste the data and click "Parse Yahoo Data"
5. Click **Merge** to combine FanGraphs projections with Yahoo positions

### Step 3: Start Drafting

- **For Roto 5x5 Snake Draft**: Use the "Roto 5x5" and "Roto Draft" tabs
- **For H2H 6x6 Auction Draft**: Use the "H2H 6x6" and "H2H Draft" tabs

Rankings are automatically calculated based on Z-scores. Dollar values are computed for auction leagues.

## Data Flow

```
FanGraphs Fantasy Dashboard
    ↓
[Projections Tab] → hitters.csv + pitchers.csv
    ↓
Yahoo Fantasy League
    ↓
[Yahoo Tab] → positions.csv
    ↓
[Merge] → merged.csv
    ↓
[Rankings & Draft Tabs] → Z-Scores & Dollar Values
```

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend**: PHP 7+
- **Data Storage**: CSV files
- **No build step** - Pure HTML/CSS/JS application

## Project Structure

```
fantasy-baseball-draft/
├── index.html          # Main application
├── js/
│   ├── app.js          # Main controller
│   ├── parser.js       # FanGraphs parser
│   ├── yahooParser.js  # Yahoo parser
│   ├── calculator.js   # Z-Score & dollar value
│   └── draftManager.js # Draft state management
├── api/
│   ├── save.php        # Save CSV files
│   └── load.php        # Load CSV files
├── data/
│   └── README.md       # Data directory info
└── css/
    └── styles.css      # Application styles
```

## Key Features Explained

### Z-Score Calculation

Z-scores normalize player values across different statistical categories, allowing fair comparison between power hitters, speed players, and pitchers with different roles.

### Two-Way Players (Ohtani Rule)

Players eligible at both hitter and pitcher positions (e.g., Shohei Ohtani) are treated as **two separate entities**:
- Hitter-Ohtani: Ranked against all batters
- Pitcher-Ohtani: Ranked against all pitchers

Drafting one does NOT remove the other from the available player pool.

### Draft Log Parsing

The draft tracking feature parses Yahoo Fantasy draft logs to automatically mark players as taken and update your team roster in real-time.

## Data Sources

This tool uses data from:
- **FanGraphs**: Player projections and statistics
- **Yahoo Fantasy Sports**: Position eligibility

**Important**: Users must comply with the respective Terms of Service:
- [FanGraphs Terms of Service](https://www.fangraphs.com/tos)
- [Yahoo Fantasy Sports Terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/fantasysports/index.html)

This software is provided for personal use only.

## Privacy

All data is stored locally in CSV files on your machine. No data is sent to external servers (except for the data sources you explicitly import from).

## Development

See [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) for the development roadmap and [SPEC.md](SPEC.md) for detailed specifications.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT License](LICENSE)

## Author

Built for fantasy baseball enthusiasts who want data-driven draft assistance.

---

**Note**: This is an unofficial tool and is not affiliated with or endorsed by FanGraphs, Yahoo, or Major League Baseball.
