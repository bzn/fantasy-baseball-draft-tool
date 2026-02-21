/**
 * Fantasy Baseball Draft Tool - Yahoo API Integration Module
 * Handles Yahoo OAuth login, league selection, and API data fetching
 */

const YahooApi = {
    // State
    authenticated: false,
    configured: false,
    selectedLeague: null, // { league_key, name, scoring_type, num_teams, ... }
    leagues: [],
    _apiConfig: null, // { client_id, client_secret } from localStorage
    _currentSettings: null, // Last loaded league settings

    // Yahoo stat_id → our internal stat name mapping
    // Reference: https://developer.yahoo.com/fantasysports/guide/stat-resource.html
    STAT_ID_MAP: {
        // Hitting
        7:  'r',
        12: 'hr',
        13: 'rbi',
        16: 'sb',
        3:  'avg',
        55: 'obp',    // Note: Yahoo reuses 55 for OPS in some leagues; display_name takes priority
        56: 'slg',
        57: 'ops',
        8:  'h',
        10: 'doubles',
        11: 'triples',
        53: 'bb',       // Walks (Batter)
        42: 'k',        // Strikeouts (used for both B and P by Yahoo)
        18: 'cs',       // Caught Stealing

        // Pitching
        28: 'w',
        32: 'sv',
        48: 'k',        // Strikeouts (Pitcher) - alternate id
        26: 'era',
        27: 'whip',
        63: 'qs',       // Quality Starts
        49: 'hld',      // Holds
        50: 'ip',       // Innings Pitched
        29: 'l',        // Losses
        34: 'ip',       // Innings Pitched (alternate id)
        39: 'bb_pitch', // Walks Allowed
        33: 'cg',       // Complete Games
        37: 'er',       // Earned Runs
        35: 'ha',       // Hits Allowed
        41: 'hra',      // Home Runs Allowed
        83: 'qs',       // Quality Starts (alternate id)
        90: 'nsvh',     // Net Saves + Holds
    },

    // Display-only stat IDs - these accompany real categories but aren't scored
    // H/AB (60) accompanies AVG, IP (50) accompanies ERA/WHIP in category leagues
    DISPLAY_ONLY_STAT_IDS: new Set([60]),

    // Fallback: Yahoo display_name → internal stat name (for stats not in STAT_ID_MAP)
    STAT_NAME_MAP: {
        'R': 'r', 'HR': 'hr', 'RBI': 'rbi', 'SB': 'sb', 'AVG': 'avg', 'OPS': 'ops',
        'OBP': 'obp', 'SLG': 'slg', 'H': 'h', '2B': 'doubles', '3B': 'triples', 'BB': 'bb',
        'W': 'w', 'SV': 'sv', 'K': 'k', 'SO': 'k', 'ERA': 'era', 'WHIP': 'whip',
        'QS': 'qs', 'HLD': 'hld', 'NSVH': 'nsvh', 'NSV+H': 'nsvh', 'SV+H': 'nsvh',
        'L': 'l', 'IP': 'ip', 'CG': 'cg',
    },

    // Stats where lower is better
    INVERTED_STATS: new Set(['era', 'whip', 'l', 'er', 'ha', 'hra', 'bb_pitch']),

    /**
     * Initialize - check auth status
     */
    async init() {
        // Load API config from localStorage
        this.loadApiConfig();

        try {
            const response = await this._apiRequest('api/auth.php?action=status');
            const result = await response.json();

            if (result.success) {
                // configured = true if server has config OR user has entered credentials
                this.configured = result.configured || (this._apiConfig && this._apiConfig.client_id);
                this.authenticated = result.authenticated;

                // If token is expired but we have refresh, try refreshing
                if (result.expired && result.has_refresh) {
                    await this.refreshToken();
                }
            }
        } catch (e) {
            // API not available - check if we have localStorage config
            this.configured = !!(this._apiConfig && this._apiConfig.client_id);
        }

        // Load saved league selection and settings
        const savedLeague = localStorage.getItem('yahoo_selected_league');
        if (savedLeague) {
            try {
                this.selectedLeague = JSON.parse(savedLeague);
            } catch (e) {
                // ignore
            }
        }

        const savedSettings = localStorage.getItem('yahoo_league_settings');
        if (savedSettings) {
            try {
                this._currentSettings = JSON.parse(savedSettings);
                // Restore Calculator.LEAGUES from saved settings
                this.restoreLeagueSettings(this._currentSettings);
                // Show league section and restore the league info panel
                const leagueSection = document.getElementById('yahooLeagueSection');
                if (leagueSection) leagueSection.classList.remove('hidden');
                this.renderLeagueInfoPanel(this._currentSettings);
            } catch (e) {
                // ignore
            }
        }

        // Listen for auth callback
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'yahoo_auth_success') {
                this.authenticated = true;
                this.updateUI();
                this.fetchLeagues();
            }
        });

        this.updateUI();
    },

    /**
     * Load API config from localStorage
     */
    loadApiConfig() {
        const saved = localStorage.getItem('yahoo_api_config');
        if (saved) {
            try {
                this._apiConfig = JSON.parse(saved);
                // Fill UI fields if elements exist
                const clientIdEl = document.getElementById('yahooClientId');
                const clientSecretEl = document.getElementById('yahooClientSecret');
                if (clientIdEl && this._apiConfig.client_id) {
                    clientIdEl.value = this._apiConfig.client_id;
                }
                if (clientSecretEl && this._apiConfig.client_secret) {
                    clientSecretEl.value = this._apiConfig.client_secret;
                }
            } catch (e) {
                console.error('Failed to load API config:', e);
            }
        }
    },

    /**
     * Save API config to localStorage
     */
    saveApiConfig() {
        const clientId = document.getElementById('yahooClientId')?.value.trim();
        const clientSecret = document.getElementById('yahooClientSecret')?.value.trim();

        if (!clientId || !clientSecret) {
            const statusEl = document.getElementById('yahooConfigSaveStatus');
            if (statusEl) {
                statusEl.innerHTML = '<span style="color: #dc2626;">Please enter both Client ID and Client Secret</span>';
            }
            return false;
        }

        this._apiConfig = { client_id: clientId, client_secret: clientSecret };
        localStorage.setItem('yahoo_api_config', JSON.stringify(this._apiConfig));

        const statusEl = document.getElementById('yahooConfigSaveStatus');
        if (statusEl) {
            statusEl.innerHTML = '<span style="color: #16a34a;">✓ Saved</span>';
            setTimeout(() => statusEl.textContent = '', 2000);
        }

        // Update configured status
        this.configured = true;
        this.updateUI();
        return true;
    },

    /**
     * Create fetch request with API config attached
     */
    async _apiRequest(url, options = {}) {
        // If we have API config from localStorage, send it as headers or query params
        if (this._apiConfig && this._apiConfig.client_id) {
            const params = new URLSearchParams();
            params.append('client_id', this._apiConfig.client_id);
            params.append('client_secret', this._apiConfig.client_secret);

            // Append to existing query string
            const separator = url.includes('?') ? '&' : '?';
            url = url + separator + params.toString();
        }

        return fetch(url, options);
    },

    /**
     * Restore Calculator.LEAGUES.active from saved settings
     */
    restoreLeagueSettings(settings) {
        if (!settings) return;

        // Rebuild Calculator.LEAGUES.active from saved settings
        if (settings.hitting_categories && settings.pitching_categories) {
            Calculator.LEAGUES.active = {
                name: settings.name || 'Yahoo League',
                hitting: settings.hitting_categories,
                pitching: settings.pitching_categories,
                invertedStats: settings.inverted_stats || [],
                hittingCount: settings.hitting_categories.length,
                pitchingCount: settings.pitching_categories.length,
            };
        }

        // Restore App.leagueSettings.active
        if (typeof App !== 'undefined' && settings.num_teams) {
            App.leagueSettings.active = {
                ...App.leagueSettings.active,
                name: settings.name,
                scoringType: settings.scoring_type || null,
                draftType: settings.draft_type || null,
                teams: settings.num_teams,
                budget: settings.is_auction ? settings.salary_cap : 260,
                rosterHitters: settings.roster_hitters,
                rosterPitchers: settings.roster_pitchers,
                rosterComposition: settings.roster_positions,
            };
        }

        // Restore per-league weights from localStorage
        if (typeof App !== 'undefined' && this.selectedLeague && this.selectedLeague.league_key) {
            const savedWeights = localStorage.getItem('league_weights_' + this.selectedLeague.league_key);
            if (savedWeights) {
                try {
                    const parsed = JSON.parse(savedWeights);
                    if (parsed.categoryWeights) {
                        App.leagueSettings.active.categoryWeights = parsed.categoryWeights;
                    }
                    if (parsed.hitterPitcherSplit) {
                        App.leagueSettings.active.hitterPitcherSplit = parsed.hitterPitcherSplit;
                    }
                } catch (e) {
                    // ignore parse errors
                }
            }
        }

        // Trigger UI update in App
        if (typeof App !== 'undefined' && App.renderStep4Settings) {
            App.renderStep4Settings();
        }

        // Enable tabs
        if (typeof App !== 'undefined' && App.enableTabs) {
            App.enableTabs();
        }
    },

    /**
     * Open Yahoo login in popup window
     */
    login() {
        const width = 600;
        const height = 700;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        window.open(
            'api/auth.php?action=login',
            'YahooLogin',
            `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
        );
    },

    /**
     * Logout - clear tokens
     */
    async logout() {
        try {
            await this._apiRequest('api/auth.php?action=logout');
        } catch (e) {
            // ignore
        }
        this.authenticated = false;
        this.selectedLeague = null;
        this.leagues = [];
        this._currentSettings = null;
        localStorage.removeItem('yahoo_selected_league');
        localStorage.removeItem('yahoo_league_settings');
        this.updateUI();
    },

    /**
     * Refresh access token
     */
    async refreshToken() {
        try {
            const response = await this._apiRequest('api/auth.php?action=refresh');
            const result = await response.json();
            if (result.success) {
                this.authenticated = true;
                return true;
            }
        } catch (e) {
            // ignore
        }
        this.authenticated = false;
        return false;
    },

    /**
     * Fetch user's leagues
     */
    async fetchLeagues() {
        try {
            const response = await this._apiRequest('api/yahoo.php?action=leagues');
            const result = await response.json();

            if (result.auth_required) {
                this.authenticated = false;
                this.updateUI();
                return [];
            }

            if (result.success) {
                this.leagues = result.leagues;
                this.renderLeagueSelector();
                return result.leagues;
            }
        } catch (e) {
            console.error('Failed to fetch leagues:', e);
        }
        return [];
    },

    /**
     * Fetch league settings and apply to app
     */
    async fetchLeagueSettings(leagueKey) {
        try {
            const response = await this._apiRequest(`api/yahoo.php?action=settings&league_key=${encodeURIComponent(leagueKey)}`);
            const result = await response.json();

            if (result.auth_required) {
                this.authenticated = false;
                this.updateUI();
                return null;
            }

            if (result.success) {
                return this.parseLeagueSettings(result.settings);
            }
        } catch (e) {
            console.error('Failed to fetch league settings:', e);
        }
        return null;
    },

    /**
     * Parse Yahoo league settings into our internal format
     */
    parseLeagueSettings(yahooSettings) {
        const hittingCategories = [];
        const pitchingCategories = [];
        const invertedStats = [];

        // Map Yahoo stat categories to our internal names
        // Filter out display-only stats (H/AB accompanies AVG, IP accompanies ERA/WHIP)
        yahooSettings.stat_categories.forEach(cat => {
            // Skip display-only stats (e.g. OBP when OPS is the real category)
            if (cat.is_only_display_stat) return;
            // Skip known display-only stat IDs (e.g. H/AB accompanies AVG)
            if (this.DISPLAY_ONLY_STAT_IDS.has(cat.stat_id)) return;

            // Try display name first (authoritative), then fallback to stat_id mapping
            // Yahoo reuses some stat_ids for different stats (e.g. stat_id 55 = OBP or OPS)
            let internalName = cat.name ? this.STAT_NAME_MAP[cat.name.toUpperCase()] : null;
            if (!internalName) {
                internalName = this.STAT_ID_MAP[cat.stat_id];
            }
            if (!internalName) {
                console.warn(`Unknown Yahoo stat: id=${cat.stat_id}, name="${cat.name}" — skipped`);
                return;
            }

            // In category leagues (roto/h2h), IP is a display stat not a scoring category
            // It shows alongside ERA/WHIP but isn't independently scored
            if (internalName === 'ip') return;

            if (cat.position_type === 'B') {
                hittingCategories.push(internalName);
            } else if (cat.position_type === 'P') {
                pitchingCategories.push(internalName);
            }

            // Determine if inverted (lower is better)
            if (cat.sort_order === '0' || this.INVERTED_STATS.has(internalName)) {
                invertedStats.push(internalName);
            }
        });

        // Parse roster positions
        const rosterPositions = [];
        let rosterHitters = 0;
        let rosterPitchers = 0;
        const hitterSlots = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'Util', 'CI', 'MI', 'IF', 'DH'];
        const pitcherSlots = ['SP', 'RP', 'P'];

        yahooSettings.roster_positions.forEach(rp => {
            for (let i = 0; i < rp.count; i++) {
                rosterPositions.push(rp.position);
            }
            if (hitterSlots.includes(rp.position)) {
                rosterHitters += rp.count;
            } else if (pitcherSlots.includes(rp.position)) {
                rosterPitchers += rp.count;
            }
        });

        // Draft type: is_auction_draft is the definitive field from Yahoo
        const isAuction = !!yahooSettings.is_auction_draft;
        const draftType = isAuction ? 'auction' : 'standard';

        // Parse roster breakdown for display
        const rosterBreakdown = {};
        yahooSettings.roster_positions.forEach(rp => {
            if (rp.count > 0) {
                rosterBreakdown[rp.position] = rp.count;
            }
        });

        return {
            name: yahooSettings.name,
            scoring_type: yahooSettings.scoring_type, // "head" or "roto"
            num_teams: yahooSettings.num_teams,
            draft_type: draftType,             // "standard" or "auction"
            draft_method: yahooSettings.draft_method || 'live', // "live", "self", "autopick"
            is_auction: isAuction,
            draft_status: yahooSettings.draft_status || '',
            season: yahooSettings.season || '',
            salary_cap: isAuction ? (yahooSettings.salary_cap || 260) : 0,
            uses_faab: !!yahooSettings.uses_faab,
            hitting_categories: hittingCategories,
            pitching_categories: pitchingCategories,
            hitting_category_names: yahooSettings.stat_categories
                .filter(c => c.position_type === 'B' && !this.DISPLAY_ONLY_STAT_IDS.has(c.stat_id))
                .map(c => c.name),
            pitching_category_names: yahooSettings.stat_categories
                .filter(c => c.position_type === 'P' && c.name !== 'IP')
                .map(c => c.name),
            inverted_stats: invertedStats,
            roster_positions: rosterPositions,
            roster_breakdown: rosterBreakdown,
            roster_hitters: rosterHitters,
            roster_pitchers: rosterPitchers,
            total_roster_size: rosterPositions.length,
            raw: yahooSettings,
        };
    },

    /**
     * Select a league and load its settings
     */
    async selectLeague(leagueKey) {
        const league = this.leagues.find(l => l.league_key === leagueKey);
        if (!league) return;

        this.selectedLeague = league;
        localStorage.setItem('yahoo_selected_league', JSON.stringify(league));

        // Show loading state
        const statusEl = document.getElementById('yahooLeagueStatus');
        if (statusEl) {
            statusEl.innerHTML = `<span style="color: #0284c7;">Loading ${league.name} settings...</span>`;
        }

        // Fetch and apply league settings
        const settings = await this.fetchLeagueSettings(leagueKey);
        if (settings) {
            this.applyLeagueSettings(settings);
            if (statusEl) {
                statusEl.innerHTML = ''; // Clear simple status
            }
            this.renderLeagueInfoPanel(settings);
        } else {
            if (statusEl) {
                statusEl.innerHTML = '<span style="color: #dc2626;">Failed to load league settings</span>';
            }
        }

        this.updateUI();
    },

    /**
     * Apply Yahoo league settings to the app's calculator and settings
     */
    applyLeagueSettings(settings) {
        // Update Calculator.LEAGUES.active dynamically
        Calculator.LEAGUES.active = {
            name: settings.name,
            hitting: settings.hitting_categories,
            pitching: settings.pitching_categories,
            invertedStats: settings.inverted_stats,
            hittingCount: settings.hitting_categories.length,
            pitchingCount: settings.pitching_categories.length,
        };

        // Update App.leagueSettings.active (scoring type and draft type are independent)
        App.leagueSettings.active = {
            ...App.leagueSettings.active,
            name: settings.name,
            scoringType: settings.scoring_type,   // 'roto' or 'head'
            draftType: settings.draft_type,       // 'standard' or 'auction'
            teams: settings.num_teams,
            budget: settings.is_auction ? settings.salary_cap : 260,
            rosterHitters: settings.roster_hitters,
            rosterPitchers: settings.roster_pitchers,
            rosterComposition: settings.roster_positions,
        };

        // Save to localStorage
        localStorage.setItem('fantasy_settings', JSON.stringify(App.leagueSettings));

        // Store the parsed settings for later use
        this._currentSettings = { ...settings };

        // Save complete settings for session restoration
        localStorage.setItem('yahoo_league_settings', JSON.stringify(this._currentSettings));

        // Restore per-league weights from localStorage (or initialize to 1.0)
        const leagueKey = this.selectedLeague ? this.selectedLeague.league_key : null;
        if (leagueKey) {
            const savedWeights = localStorage.getItem('league_weights_' + leagueKey);
            if (savedWeights) {
                try {
                    const parsed = JSON.parse(savedWeights);
                    if (parsed.categoryWeights) {
                        App.leagueSettings.active.categoryWeights = parsed.categoryWeights;
                    }
                    if (parsed.hitterPitcherSplit) {
                        App.leagueSettings.active.hitterPitcherSplit = parsed.hitterPitcherSplit;
                    }
                } catch (e) {
                    // ignore parse errors
                }
            } else {
                // Fresh league: initialize all category weights to 1.0
                const allCats = [].concat(settings.hitting_categories, settings.pitching_categories);
                const freshWeights = {};
                allCats.forEach(cat => { freshWeights[cat] = 1.0; });
                App.leagueSettings.active.categoryWeights = freshWeights;
            }
            // Persist current state
            localStorage.setItem('fantasy_settings', JSON.stringify(App.leagueSettings));
        }

        // Also update Settings tab UI to reflect synced values
        this.syncSettingsTabUI(settings);

        // Recalculate if data is loaded
        if (App.currentData.merged || App.currentData.hitters || App.currentData.pitchers) {
            App.calculateValues();
        }

        // Enable tabs
        App.enableTabs();

        // Auto-sync my team name from Yahoo
        this.syncMyTeamName();
    },

    /**
     * Fetch my team name from Yahoo and set it in DraftManager
     */
    async syncMyTeamName() {
        if (!this.selectedLeague) return;

        try {
            const teams = await this.fetchTeams(this.selectedLeague.league_key);
            const myTeam = teams?.find(t => t.is_owned_by_current_login);
            if (myTeam && typeof DraftManager !== 'undefined') {
                DraftManager.setTeamName(myTeam.name);

                // Update Draft page input field if not currently focused
                const nameInput = document.getElementById('draftTeamName');
                if (nameInput && document.activeElement !== nameInput) {
                    nameInput.value = myTeam.name;
                }
            }
        } catch (e) {
            console.error('Failed to sync team name:', e);
        }
    },

    /**
     * Fetch ALL players from Yahoo API by position (handles pagination + dedup)
     * Fetches each position separately to get complete coverage beyond the ~425 ranked player limit.
     * Returns array of player objects compatible with YahooParser format.
     */
    async fetchAllPlayers(leagueKey, statusCallback) {
        // Positions to fetch - covers all hitters and pitchers
        // DH included to catch DH-only players like Ohtani (Batter)
        const positions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH', 'SP', 'RP'];
        const seenKeys = new Set(); // Dedup by player_key
        const allPlayers = [];
        let totalFetched = 0;

        for (const pos of positions) {
            let start = 0;
            const count = 25;
            let hasMore = true;

            while (hasMore) {
                if (statusCallback) {
                    statusCallback(`Loading ${pos} players (${start + 1}-${start + count})... Total so far: ${allPlayers.length}`);
                }

                try {
                    const url = `api/yahoo.php?action=players&league_key=${encodeURIComponent(leagueKey)}&start=${start}&count=${count}&position=${pos}`;
                    const response = await this._apiRequest(url);
                    const result = await response.json();

                    if (result.auth_required) {
                        this.authenticated = false;
                        this.updateUI();
                        return null;
                    }

                    if (!result.success) {
                        // Yahoo often returns 500 when requesting beyond available players
                        // Treat as "no more players for this position" rather than fatal error
                        if (start > 0) {
                            // Already got some players for this position, just stop pagination
                            hasMore = false;
                            break;
                        }
                        console.error(`Yahoo API error for ${pos}:`, result);
                        hasMore = false;
                        break;
                    }

                    if (!result.players || result.players.length === 0) {
                        hasMore = false;
                        break;
                    }

                    // Dedup and convert
                    let newCount = 0;
                    result.players.forEach(p => {
                        if (!seenKeys.has(p.player_key)) {
                            seenKeys.add(p.player_key);
                            allPlayers.push(this.convertToInternalFormat(p));
                            newCount++;
                        }
                    });

                    totalFetched += result.players.length;
                    start += count;

                    // Stop if we got fewer than requested (end of list for this position)
                    if (result.players.length < count) {
                        hasMore = false;
                    }
                } catch (e) {
                    console.error(`Error fetching ${pos} at offset ${start}:`, e);
                    hasMore = false;
                }
            }
        }

        if (statusCallback) {
            statusCallback(`Loaded ${allPlayers.length} unique players from Yahoo API (${totalFetched} total fetched)`);
        }

        return allPlayers;
    },

    /**
     * Convert Yahoo API player to internal YahooParser-compatible format
     */
    convertToInternalFormat(yahooPlayer) {
        // Filter to only baseball positions (exclude Util, BN, IL, NA, DL)
        const validPositions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH', 'SP', 'RP', 'P'];
        const positions = (yahooPlayer.positions || []).filter(p => validPositions.includes(p));

        const pitcherPositions = ['SP', 'RP', 'P'];
        const hitterPositions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'];

        const hasPitcher = positions.some(p => pitcherPositions.includes(p));
        const hasHitter = positions.some(p => hitterPositions.includes(p));

        let playerType = 'hitter';
        if (hasPitcher && hasHitter) {
            playerType = 'two-way';
        } else if (hasPitcher) {
            playerType = 'pitcher';
        }

        // Clean name: strip suffixes like "(Batter)"/"(Pitcher)" that Yahoo adds for two-way players
        const cleanName = typeof YahooParser !== 'undefined' && YahooParser.cleanPlayerName
            ? YahooParser.cleanPlayerName(yahooPlayer.name)
            : yahooPlayer.name;

        return {
            name: cleanName,
            team: yahooPlayer.team,
            positions: positions,
            playerType: playerType,
            isPitcherSP: positions.includes('SP'),
            isPitcherRP: positions.includes('RP'),
            injuryStatus: yahooPlayer.injury_status || '',
            _yahooPlayerKey: yahooPlayer.player_key, // Keep for reference
        };
    },

    /**
     * Fetch draft results from Yahoo API
     */
    async fetchDraftResults(leagueKey) {
        try {
            const response = await this._apiRequest(`api/yahoo.php?action=draftresults&league_key=${encodeURIComponent(leagueKey)}`);
            const result = await response.json();

            if (result.auth_required) {
                this.authenticated = false;
                this.updateUI();
                return null;
            }

            if (result.success) {
                return result.picks;
            }
        } catch (e) {
            console.error('Failed to fetch draft results:', e);
        }
        return null;
    },

    /**
     * Fetch league teams
     */
    async fetchTeams(leagueKey) {
        try {
            const response = await this._apiRequest(`api/yahoo.php?action=teams&league_key=${encodeURIComponent(leagueKey)}`);
            const result = await response.json();

            if (result.auth_required) {
                this.authenticated = false;
                this.updateUI();
                return null;
            }

            if (result.success) {
                return result.teams;
            }
        } catch (e) {
            console.error('Failed to fetch teams:', e);
        }
        return null;
    },

    // =================== UI Methods ===================

    /**
     * Update all Yahoo-related UI elements
     */
    updateUI() {
        const loginBtn = document.getElementById('yahooLoginBtn');
        const logoutBtn = document.getElementById('yahooLogoutBtn');
        const statusEl = document.getElementById('yahooAuthStatus');
        const leagueSection = document.getElementById('yahooLeagueSection');
        const notConfigured = document.getElementById('yahooNotConfigured');

        if (!loginBtn) return; // UI not ready

        if (!this.configured) {
            // Yahoo API not configured
            loginBtn.classList.add('hidden');
            logoutBtn.classList.add('hidden');
            if (leagueSection) leagueSection.classList.add('hidden');
            if (notConfigured) notConfigured.classList.remove('hidden');
            if (statusEl) statusEl.textContent = '';
            return;
        }

        if (notConfigured) notConfigured.classList.add('hidden');

        if (this.authenticated) {
            loginBtn.classList.add('hidden');
            logoutBtn.classList.remove('hidden');
            if (statusEl) statusEl.innerHTML = '<span style="color: #16a34a;">Connected to Yahoo</span>';
            if (leagueSection) leagueSection.classList.remove('hidden');

            // Auto-fetch leagues if not loaded
            if (this.leagues.length === 0) {
                this.fetchLeagues();
            }
        } else {
            loginBtn.classList.remove('hidden');
            logoutBtn.classList.add('hidden');
            if (statusEl) statusEl.innerHTML = '<span style="color: #64748b;">Not connected</span>';
            if (leagueSection) leagueSection.classList.add('hidden');
        }
    },

    /**
     * Render league selector dropdown
     */
    renderLeagueSelector() {
        const selector = document.getElementById('yahooLeagueSelect');
        if (!selector) return;

        selector.innerHTML = '<option value="">-- Select League --</option>';
        this.leagues.forEach(league => {
            const typeLabel = league.scoring_type === 'head' ? 'H2H' : 'Roto';
            const option = document.createElement('option');
            option.value = league.league_key;
            option.textContent = `${league.name} (${typeLabel}, ${league.num_teams} teams)`;
            if (this.selectedLeague && this.selectedLeague.league_key === league.league_key) {
                option.selected = true;
            }
            selector.appendChild(option);
        });
    },

    /**
     * Render a detailed league info panel in the Setup tab
     */
    renderLeagueInfoPanel(settings) {
        // Find or create the info panel container
        let panel = document.getElementById('yahooLeagueInfoPanel');
        if (!panel) {
            const leagueSection = document.getElementById('yahooLeagueSection');
            if (!leagueSection) return;
            panel = document.createElement('div');
            panel.id = 'yahooLeagueInfoPanel';
            leagueSection.appendChild(panel);
        }

        const typeLabel = settings.scoring_type === 'head' ? 'Head-to-Head' : 'Rotisserie';
        const hCats = settings.hitting_category_names;
        const pCats = settings.pitching_category_names;
        const catLabel = `${hCats.length}x${pCats.length}`;

        // Roster breakdown
        const hitterSlots = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'Util', 'CI', 'MI', 'IF', 'DH'];
        const pitcherSlots = ['SP', 'RP', 'P'];
        const benchSlots = ['BN', 'IL', 'IL+', 'NA', 'DL', 'DL+'];

        const rosterHitterParts = [];
        const rosterPitcherParts = [];
        const rosterBenchParts = [];

        for (const [pos, count] of Object.entries(settings.roster_breakdown)) {
            const label = count > 1 ? `${pos} x${count}` : pos;
            if (hitterSlots.includes(pos)) {
                rosterHitterParts.push(label);
            } else if (pitcherSlots.includes(pos)) {
                rosterPitcherParts.push(label);
            } else if (benchSlots.includes(pos)) {
                rosterBenchParts.push(label);
            }
        }

        // Draft info
        const draftTypeLabel = settings.is_auction ? 'Salary Cap (Auction)' : 'Standard (Sequential)';
        const draftMethodMap = { live: 'Live', self: 'Offline', autopick: 'Autopick' };
        const draftMethodLabel = draftMethodMap[settings.draft_method] || settings.draft_method;

        // League depth calculations
        const totalHitterSlots = settings.roster_hitters * settings.num_teams;
        const totalPitcherSlots = settings.roster_pitchers * settings.num_teams;
        const totalActive = (settings.roster_hitters + settings.roster_pitchers) * settings.num_teams;

        panel.innerHTML = `
            <div style="margin-top: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; color: #16a34a; font-size: 1.1rem;">${settings.name}</h4>
                    <span style="font-size: 0.85em; color: #64748b;">${settings.season} Season | ${settings.draft_status || ''}</span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                    <!-- League Type -->
                    <div style="background: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div style="font-size: 0.8em; color: #64748b; margin-bottom: 4px;">League Format</div>
                        <div style="font-weight: 600;">${typeLabel} ${catLabel}</div>
                        <div style="font-size: 0.85em; color: #475569;">${settings.num_teams} Teams</div>
                    </div>

                    <!-- Draft -->
                    <div style="background: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div style="font-size: 0.8em; color: #64748b; margin-bottom: 4px;">Draft</div>
                        <div style="font-weight: 600;">${draftTypeLabel}</div>
                        <div style="font-size: 0.85em; color: #475569;">${draftMethodLabel}${settings.is_auction ? ` | Budget: $${settings.salary_cap} | Pool: $${settings.salary_cap * settings.num_teams}` : ''}</div>
                    </div>

                    <!-- League Depth -->
                    <div style="background: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div style="font-size: 0.8em; color: #64748b; margin-bottom: 4px;">League Depth (Active Slots)</div>
                        <div style="font-weight: 600;">${totalActive} total</div>
                        <div style="font-size: 0.85em; color: #475569;">Hitters: ${totalHitterSlots} | Pitchers: ${totalPitcherSlots}</div>
                    </div>
                </div>

                <!-- Categories -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                    <div style="background: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div style="font-size: 0.8em; color: #64748b; margin-bottom: 6px;">Hitting Categories (${hCats.length})</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                            ${hCats.map(c => `<span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 500;">${c}</span>`).join('')}
                        </div>
                    </div>
                    <div style="background: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                        <div style="font-size: 0.8em; color: #64748b; margin-bottom: 6px;">Pitching Categories (${pCats.length})</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                            ${pCats.map(c => `<span style="background: #fce7f3; color: #9d174d; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 500;">${c}</span>`).join('')}
                        </div>
                    </div>
                </div>

                <!-- Roster -->
                <div style="margin-top: 12px; background: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 0.8em; color: #64748b; margin-bottom: 6px;">Roster Positions (${settings.total_roster_size} slots per team)</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px;">
                        <span style="font-size: 0.8em; color: #475569; font-weight: 600; margin-right: 4px;">Hitters:</span>
                        ${rosterHitterParts.map(p => `<span style="background: #dbeafe; color: #1e40af; padding: 1px 6px; border-radius: 3px; font-size: 0.8em;">${p}</span>`).join('')}
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px;">
                        <span style="font-size: 0.8em; color: #475569; font-weight: 600; margin-right: 4px;">Pitchers:</span>
                        ${rosterPitcherParts.map(p => `<span style="background: #fce7f3; color: #9d174d; padding: 1px 6px; border-radius: 3px; font-size: 0.8em;">${p}</span>`).join('')}
                    </div>
                    ${rosterBenchParts.length > 0 ? `
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        <span style="font-size: 0.8em; color: #475569; font-weight: 600; margin-right: 4px;">Bench:</span>
                        ${rosterBenchParts.map(p => `<span style="background: #f1f5f9; color: #475569; padding: 1px 6px; border-radius: 3px; font-size: 0.8em;">${p}</span>`).join('')}
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    /**
     * Sync Settings tab UI fields with Yahoo league data
     */
    syncSettingsTabUI(settings) {
        // Trigger Step 4 UI update in Setup tab
        if (typeof App !== 'undefined' && App.renderStep4Settings) {
            App.renderStep4Settings();
        }
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YahooApi;
}
