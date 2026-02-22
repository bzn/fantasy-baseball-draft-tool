/**
 * Fantasy Baseball Draft Tool - Main Application
 */

const App = {
    currentData: {
        hitters: null,      // Original FanGraphs hitter projections
        pitchers: null,     // Original FanGraphs pitcher projections
        merged: null,       // Merged data (FanGraphs + Yahoo positions)
        combined: [],       // Single combined player list for active league
        yahooAdp: null      // Yahoo Draft Analysis ADP/salary data
    },

    // Sort state
    sortState: {
        column: 'dollarValue',
        direction: 'desc' // 'asc' or 'desc'
    },

    // Single active league settings (scoring type and draft type are independent)
    leagueSettings: {
        active: {
            name: '',
            scoringType: null,   // 'roto' or 'head'
            draftType: null,     // 'snake' or 'auction'
            teams: 12,
            budget: 260,
            hitterPitcherSplit: '60/40',
            inningsLimit: 1350,
            rosterHitters: 12,
            rosterPitchers: 8,
            rosterComposition: ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'LF', 'CF', 'RF', 'OF', 'Util', 'SP', 'SP', 'SP', 'RP', 'RP', 'P', 'P', 'P', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IL', 'IL', 'IL', 'NA'],
            categoryWeights: {
                'r': 1.0, 'hr': 1.0, 'rbi': 1.0, 'sb': 1.0, 'avg': 1.0,
                'w': 1.0, 'sv': 1.0, 'k': 1.0, 'era': 1.0, 'whip': 1.0
            }
        }
    },

    /**
     * Initialize the application
     */
    async init() {
        this.loadSettings();
        this.bindEvents();
        if (typeof DraftManager !== 'undefined') {
            DraftManager.init();
        }
        // Initialize Yahoo API (non-blocking)
        if (typeof YahooApi !== 'undefined') {
            YahooApi.init();
        }
        await this.loadDataFromFiles();
        await this.loadYahooAdpData();
        this.updateDataInfo();
        this.updateSetupStatus();
        this.applySettingsToUI();
        this.updateDraftAssistantUI();

        // Enable tabs if we have league settings
        const savedLeague = localStorage.getItem('yahoo_league_settings');
        if (savedLeague) {
            this.enableTabs();
        }
    },

    /**
     * Bind all event listeners
     */
    bindEvents() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Parser events (Projections tab removed, but keep bindings for potential future use)
        document.getElementById('parseBtn')?.addEventListener('click', () => this.parseData());
        document.getElementById('clearBtn')?.addEventListener('click', () => this.clearParser());
        document.getElementById('saveDataBtn')?.addEventListener('click', () => this.saveData());
        document.getElementById('exportCsvBtn')?.addEventListener('click', () => this.exportCSV());

        // Rankings table events
        document.getElementById('positionFilter')?.addEventListener('change', () => this.updateRankingsTable());
        document.getElementById('searchPlayer')?.addEventListener('input', (e) => this.searchPlayers(e.target.value));
        document.getElementById('hideDrafted')?.addEventListener('change', () => this.updateRankingsTable());

        // Draft Assistant events
        document.getElementById('processDraftLogBtn')?.addEventListener('click', () => this.processDraftLog());
        document.getElementById('clearDraftLogBtn')?.addEventListener('click', () => this.clearDraftLog());
        document.getElementById('syncDraftFromApiBtn')?.addEventListener('click', () => this.syncDraftFromApi());
        document.getElementById('draftTeamName')?.addEventListener('change', (e) => {
            if (typeof DraftManager !== 'undefined') {
                DraftManager.setTeamName(e.target.value);
                this.updateDraftAssistantUI();
            }
        });
        document.getElementById('draftTeamCount')?.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (count >= 4 && count <= 30) {
                this.leagueSettings.active.teams = count;
                localStorage.setItem('fantasy_settings', JSON.stringify(this.leagueSettings));
                this.calculateValues();
            }
        });
        // Draft Assistant Checkbox
        document.getElementById('hideDraftedPlayers')?.addEventListener('change', (e) => {
             this.updateDraftAssistantUI();
        });

        // Data Management events (moved from Settings to Setup)
        document.getElementById('clearStorageBtn').addEventListener('click', () => this.clearAllData());
        document.getElementById('step4SaveBtn')?.addEventListener('click', () => this.saveSettings());

        // Yahoo Position Parser events (Yahoo Manual tab removed, but keep bindings for potential future use)
        document.getElementById('yahooParseBtn')?.addEventListener('click', () => this.parseYahooData());
        document.getElementById('yahooClearBtn')?.addEventListener('click', () => this.clearYahooData());
        document.getElementById('yahooSaveBtn')?.addEventListener('click', () => this.saveYahooData());
        document.getElementById('mergeDataBtn')?.addEventListener('click', () => this.mergeData());
        document.getElementById('yahooSearchBtn')?.addEventListener('click', () => this.searchYahooPlayer());

        // Setup tab events (Yahoo API)
        document.getElementById('saveYahooConfigBtn')?.addEventListener('click', () => YahooApi.saveApiConfig());
        document.getElementById('yahooLoadLeagueBtn')?.addEventListener('click', () => this.handleLoadLeague());
        document.getElementById('yahooLoadPlayersBtn')?.addEventListener('click', () => this.handleLoadPlayersFromApi());
        document.getElementById('setupFetchProjectionsBtn')?.addEventListener('click', () => this.handleFetchProjections());


        // Table sorting
        document.querySelectorAll('#playerTable th[data-sort]').forEach(th => {
            th.addEventListener('click', (e) => this.sortTable(e.target.dataset.sort));
        });

        // Active Bidder Events (Module 3)
        const bidInput = document.getElementById('bidSearchInput');
        if (bidInput) {
            bidInput.addEventListener('input', (e) => this.searchBidPlayer(e.target.value));

            // Hide results on outside click
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.bid-search-box')) {
                    document.getElementById('bidSearchResults')?.classList.add('hidden');
                }
            });
        }
    },

    /**
     * Search for player in Active Bidder module
     */
    searchBidPlayer(query) {
        const resultsDiv = document.getElementById('bidSearchResults');
        if (!query || query.length < 2) {
            resultsDiv.classList.add('hidden');
            return;
        }

        const players = this.currentData.combined || [];
        const matches = players
            .filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8);

        if (matches.length === 0) {
            resultsDiv.classList.add('hidden');
            return;
        }

        resultsDiv.innerHTML = matches.map(p => {
            const isTaken = DraftManager.isPlayerTaken(p);
            const style = isTaken ? 'opacity: 0.6; background: #f3f4f6;' : '';
            const takenBadge = isTaken ? '<span style="color:#dc2626; font-size:0.75em; font-weight:bold; margin-left:6px;">(TAKEN)</span>' : '';
            const injBadge = p.injuryStatus ? `<span class="injury-badge injury-${p.injuryStatus.startsWith('IL') ? 'il' : 'dtd'}">${p.injuryStatus}</span>` : '';

            return `
                <div class="bid-result-item" data-id="${p.name}|${p.team}" style="padding: 8px; cursor: pointer; border-bottom: 1px solid #eee; ${style}">
                    <div style="font-weight: bold;">${p.name} ${injBadge}<span style="font-weight:normal; font-size:0.8em; color:#666;">(${p.team} - ${p.positionString})</span>${takenBadge}</div>
                    <div style="font-size: 0.8em; color: #059669;">Val: $${p.dollarValue}</div>
                </div>
            `;
        }).join('');

        // Bind click events
        resultsDiv.querySelectorAll('.bid-result-item').forEach((el, index) => {
            el.addEventListener('click', () => {
                this.selectBidPlayer(matches[index]);
            });
        });

        resultsDiv.classList.remove('hidden');
    },

    /**
     * Select a player and show Bid Analysis
     */
    selectBidPlayer(player) {
        // UI Updates
        const input = document.getElementById('bidSearchInput');
        const resultsDiv = document.getElementById('bidSearchResults');
        const contentDiv = document.getElementById('bidAnalysisContent');

        input.value = player.name;
        resultsDiv.classList.add('hidden');
        contentDiv.classList.remove('hidden');

        // Calculations
        const stats = DraftManager.getMyTeamStats();
        const settings = this.leagueSettings.active;
        const totalBudget = settings.budget || 260;
        const rosterSize = (settings.rosterHitters || 14) + (settings.rosterPitchers || 9); // Total slots
        const slotsFilled = stats.count;
        const slotsLeft = Math.max(0, rosterSize - slotsFilled);
        const moneySpent = stats.spent;
        const moneyLeft = totalBudget - moneySpent;
        
        // Max Bid (Mathematical Hard Cap): Money Left - (Slots Left - 1) * $1
        const maxBid = Math.max(0, moneyLeft - (Math.max(0, slotsLeft - 1)));

        // Inflation
        const inflationStats = DraftManager.calculateInflationStats(this.currentData.combined, settings);
        const inflationRate = inflationStats ? inflationStats.inflationRate : 1.0;
        const systemPrice = player.dollarValue;
        const inflatedPrice = Math.round(systemPrice * inflationRate);

        // --- Strategic Max Logic (The "Smart" Bid) ---
        // 1. How much "extra" money do we have strictly mathematically?
        const slack = Math.max(0, maxBid - inflatedPrice);
        
        // 2. Value Discipline: Don't pay more than 35% over market value (min $2 buffer)
        const valuePremium = Math.max(2, inflatedPrice * 0.35);
        
        // 3. Budget Discipline: Don't use more than 25% of our total available slack on one player
        const budgetPremium = slack * 0.25;
        
        // 4. The actual premium we recommend is the stricter of the two
        const strategicPremium = Math.min(valuePremium, budgetPremium);
        
        // 5. Calculate Strategic Max (capped by actual Max Bid)
        let strategicMax = Math.floor(inflatedPrice + strategicPremium);
        if (strategicMax > maxBid) strategicMax = maxBid;
        if (strategicMax < inflatedPrice && maxBid >= inflatedPrice) strategicMax = inflatedPrice; // At least match price if affordable

        // Styling
        const isAffordable = maxBid >= inflatedPrice;
        const priceColor = isAffordable ? '#059669' : '#dc2626';

        // Check if Taken
        const isTaken = DraftManager.isPlayerTaken(player);
        const warningHtml = isTaken ? `
            <div style="background: #fee2e2; border: 1px solid #ef4444; color: #b91c1c; padding: 8px; border-radius: 4px; margin-bottom: 12px; text-align: center; font-weight: bold; font-size: 0.9em;">
                ⚠️ PLAYER ALREADY DRAFTED
            </div>
        ` : '';

        // Build Full Stats Grid (dynamic from active league categories)
        const league = Calculator.LEAGUES.active;
        const catDisplayNames = {
            'r': 'R', 'hr': 'HR', 'rbi': 'RBI', 'sb': 'SB', 'avg': 'AVG', 'ops': 'OPS',
            'obp': 'OBP', 'w': 'W', 'sv': 'SV', 'k': 'K', 'era': 'ERA', 'whip': 'WHIP',
            'qs': 'QS', 'hld': 'HLD', 'nsvh': 'NSVH'
        };
        const rateStats = new Set(['avg', 'ops', 'obp', 'era', 'whip']);
        const categories = player.type === 'hitter' ? league.hitting : league.pitching;

        let statsHtml = categories.map(cat => {
            const z = player['z_' + cat] || 0;
            const raw = player[cat] ?? (cat === 'k' ? player.so : undefined) ?? 0;
            const label = catDisplayNames[cat] || cat.toUpperCase();
            const val = rateStats.has(cat)
                ? this.formatNumber(raw, cat === 'avg' || cat === 'ops' || cat === 'obp' ? 3 : 2)
                : Math.round(raw);
            return `
                <div style="text-align: center; padding: 6px; background: #f8fafc; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 0.7em; color: #64748b; margin-bottom:2px;">${label}</div>
                    <div style="font-weight: bold; font-size: 1rem; color: ${z > 0.5 ? '#16a34a' : z < -0.5 ? '#dc2626' : '#334155'};">
                        ${val}
                    </div>
                </div>
            `;
        }).join('');

        contentDiv.innerHTML = `
            ${warningHtml}
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: #1e293b;">${player.name}${player.injuryStatus ? ` <span class="injury-badge injury-${player.injuryStatus.startsWith('IL') ? 'il' : 'dtd'}">${player.injuryStatus}</span>` : ''}</div>
                    <div style="font-size: 0.9rem; color: #64748b;">${player.team} | ${player.positionString}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.8rem; color: #64748b;">System Val</div>
                    <div style="font-size: 1.1rem; font-weight: bold;">$${systemPrice}</div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 15px;">
                <div style="background: #f1f5f9; padding: 6px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 0.7rem; color: #64748b;">Inflated</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: ${inflationRate > 1.05 ? '#b91c1c' : '#1e293b'};">
                        $${inflatedPrice}
                    </div>
                </div>
                
                <div style="background: #dcfce7; padding: 6px; border-radius: 4px; text-align: center; border: 1px solid #16a34a; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 0.7rem; color: #15803d; font-weight:bold;">Rec. Limit</div>
                    <div style="font-size: 1.3rem; font-weight: bold; color: #15803d;">
                        $${strategicMax}
                    </div>
                </div>

                <div style="background: #f8fafc; padding: 6px; border-radius: 4px; text-align: center; border: 1px solid #e2e8f0; opacity: 0.8;">
                    <div style="font-size: 0.7rem; color: #64748b;">Math Max</div>
                    <div style="font-size: 1.1rem; font-weight: bold; color: #64748b;">
                        $${maxBid}
                    </div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;">
                ${statsHtml}
            </div>
            
            <div style="margin-top: 10px; font-size: 0.8em; text-align: center; color: #64748b;">
                ${strategicMax < maxBid ? 'Safe bid based on value & remaining budget.' : 'Go all in if you need him.'}
            </div>
        `;
    },

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        const stored = localStorage.getItem('fantasy_settings');
        if (stored) {
            const saved = JSON.parse(stored);
            // Migration: if old format with roto5x5/h2h12, ignore (use defaults)
            if (saved.active) {
                const defaults = this.leagueSettings;
                this.leagueSettings = {
                    ...defaults,
                    active: { ...defaults.active, ...saved.active }
                };
            }
        }
    },

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        const settings = this.leagueSettings.active;

        // Read hitter/pitcher split (used for both auction budget and snake ranking weight)
        const splitEl = document.getElementById('step4HitterPitcherSplit');
        if (splitEl) {
            settings.hitterPitcherSplit = splitEl.value;
        }

        // Read category weights dynamically from container
        const container = document.getElementById('categoryWeightsContainer');
        if (container) {
            const weights = {};
            container.querySelectorAll('input[data-cat]').forEach(input => {
                const val = parseFloat(input.value);
                weights[input.dataset.cat] = isNaN(val) ? 1.0 : val;
            });
            if (Object.keys(weights).length > 0) {
                settings.categoryWeights = weights;
            }
        }

        localStorage.setItem('fantasy_settings', JSON.stringify(this.leagueSettings));

        // Save per-league weights so switching leagues preserves each league's settings
        if (typeof YahooApi !== 'undefined' && YahooApi.selectedLeague && YahooApi.selectedLeague.league_key) {
            const leagueKey = YahooApi.selectedLeague.league_key;
            localStorage.setItem('league_weights_' + leagueKey, JSON.stringify({
                categoryWeights: settings.categoryWeights,
                hitterPitcherSplit: settings.hitterPitcherSplit,
            }));
        }

        alert('Settings saved!');

        // Recalculate values with new settings
        this.calculateValues();
    },

    /**
     * Apply settings to UI elements
     */
    applySettingsToUI() {
        // Render Step 4 settings if a league has been synced
        this.renderStep4Settings();
    },

    /**
     * Render Step 4 settings UI dynamically based on synced league
     */
    renderStep4Settings() {
        const container = document.getElementById('categoryWeightsContainer');
        const noSyncMsg = document.getElementById('step4NoSync');
        const splitRow = document.getElementById('step4SplitRow');
        const saveRow = document.getElementById('step4SaveRow');
        if (!container) return;

        const settings = this.leagueSettings.active;
        const league = Calculator.LEAGUES.active;

        // Check if league has been configured (has scoringType set)
        if (!settings.scoringType) {
            if (noSyncMsg) noSyncMsg.classList.remove('hidden');
            if (splitRow) splitRow.classList.add('hidden');
            if (saveRow) saveRow.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        if (noSyncMsg) noSyncMsg.classList.add('hidden');
        if (saveRow) saveRow.classList.remove('hidden');

        if (!league) return;

        // Show split selector for all league types (auction: budget split, snake: ranking weight)
        if (splitRow) {
            splitRow.classList.remove('hidden');
            const splitEl = document.getElementById('step4HitterPitcherSplit');
            if (splitEl) splitEl.value = settings.hitterPitcherSplit || '60/40';
        }

        // Build category weight inputs
        const weights = settings.categoryWeights || {};
        const hittingCats = league.hitting || [];
        const pitchingCats = league.pitching || [];

        // Display name mapping
        const catDisplayNames = {
            'r': 'R', 'hr': 'HR', 'rbi': 'RBI', 'sb': 'SB', 'avg': 'AVG', 'ops': 'OPS',
            'obp': 'OBP', 'slg': 'SLG', 'h': 'H', 'doubles': '2B', 'triples': '3B', 'bb': 'BB',
            'w': 'W', 'sv': 'SV', 'k': 'K', 'era': 'ERA', 'whip': 'WHIP',
            'qs': 'QS', 'hld': 'HLD', 'nsvh': 'NSVH', 'l': 'L', 'ip': 'IP'
        };

        let html = '';

        if (hittingCats.length > 0) {
            html += `<h4 style="margin: 10px 0 6px 0; font-size: 0.95em;">Hitting Weights</h4>`;
            html += '<div style="display: flex; flex-wrap: wrap; gap: 6px 12px;">';
            hittingCats.forEach(cat => {
                const val = weights[cat] !== undefined ? weights[cat] : 1.0;
                const display = catDisplayNames[cat] || cat.toUpperCase();
                html += `<label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em;">
                    <span style="font-weight: 500;">${display}:</span>
                    <input type="number" data-cat="${cat}" value="${val}" step="0.1" min="0" max="5" style="width: 48px; padding: 2px 4px; font-size: 0.85em;">
                </label>`;
            });
            html += '</div>';
        }

        if (pitchingCats.length > 0) {
            html += `<h4 style="margin: 10px 0 6px 0; font-size: 0.95em;">Pitching Weights</h4>`;
            html += '<div style="display: flex; flex-wrap: wrap; gap: 6px 12px;">';
            pitchingCats.forEach(cat => {
                const val = weights[cat] !== undefined ? weights[cat] : 1.0;
                const display = catDisplayNames[cat] || cat.toUpperCase();
                html += `<label style="display: flex; align-items: center; gap: 4px; font-size: 0.85em;">
                    <span style="font-weight: 500;">${display}:</span>
                    <input type="number" data-cat="${cat}" value="${val}" step="0.1" min="0" max="5" style="width: 48px; padding: 2px 4px; font-size: 0.85em;">
                </label>`;
            });
            html += '</div>';
        }

        container.innerHTML = html;
    },

    /**
     * Switch between tabs
     */
    switchTab(tabId) {
        // Find the button for this tab and skip if disabled
        const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (targetBtn && targetBtn.disabled) return;

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabId);
        });

        // Refresh content when switching tabs
        if (tabId === 'setup') {
            this.updateSetupStatus();
        } else if (tabId === 'rankings') {
            this.updateRankingsTable();
        } else if (tabId === 'draft') {
            this.updateDraftAssistantUI();
        } else if (tabId === 'undervalued') {
            this.updateUndervaluedTab();
        }
    },

    /**
     * Enable Rankings and Draft tabs
     */
    enableTabs() {
        const rankingsBtn = document.getElementById('tabRankings');
        const draftBtn = document.getElementById('tabDraft');
        const undervaluedBtn = document.getElementById('tabUndervalued');
        if (rankingsBtn) rankingsBtn.disabled = false;
        if (draftBtn) draftBtn.disabled = false;
        if (undervaluedBtn) undervaluedBtn.disabled = false;
    },

    /**
     * Load Yahoo ADP data from static JSON
     */
    async loadYahooAdpData() {
        try {
            const resp = await fetch('data/yahoo_adp.json');
            if (resp.ok) {
                this.currentData.yahooAdp = await resp.json();
                console.log('Yahoo ADP data loaded:',
                    this.currentData.yahooAdp.standard?.length, 'standard,',
                    this.currentData.yahooAdp.salary?.length, 'salary');
            }
        } catch (e) {
            console.warn('Failed to load Yahoo ADP data:', e);
        }
    },

    /**
     * Normalize a player name for matching: lowercase, strip accents, remove suffixes
     */
    normalizeName(name) {
        return name
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s*\(batter\)\s*/i, '')
            .replace(/\s*\(pitcher\)\s*/i, '')
            .replace(/\./g, '')
            .trim();
    },

    /**
     * Match a Yahoo player to our player list
     * Handles (Batter)/(Pitcher) suffix to match correct playerType
     */
    matchPlayer(yahooEntry, ourPlayers) {
        const yName = this.normalizeName(yahooEntry.name);
        const rawName = yahooEntry.name || '';
        // Detect player type hint from Yahoo name suffix
        const isBatter = /\(batter\)/i.test(rawName);
        const isPitcher = /\(pitcher\)/i.test(rawName);

        const typeFilter = (p) => {
            if (isBatter) return p.playerType === 'hitter';
            if (isPitcher) return p.playerType === 'pitcher';
            return true;
        };

        // Exact normalized name match
        let match = ourPlayers.find(p => this.normalizeName(p.name) === yName && typeFilter(p));
        if (match) return match;

        // Fuzzy: last name + team match
        const yLastName = yName.split(' ').pop();
        const yTeam = yahooEntry.team.toUpperCase();
        const teamAliases = { 'KC': 'KCR', 'SD': 'SDP', 'SF': 'SFG', 'TB': 'TBR', 'AZ': 'ARI', 'WSH': 'WSN', 'CWS': 'CHW' };
        const yTeamNorm = teamAliases[yTeam] || yTeam;
        match = ourPlayers.find(p => {
            const pName = this.normalizeName(p.name);
            const pLast = pName.split(' ').pop();
            const pTeam = (p.team || '').toUpperCase();
            return pLast === yLastName && (pTeam === yTeam || pTeam === yTeamNorm) && typeFilter(p);
        });
        return match || null;
    },

    /**
     * Get the set of undervalued top 30 player keys (name + playerType) for badge display
     */
    getUndervaluedSet() {
        const yahooAdp = this.currentData.yahooAdp;
        const ourPlayers = this.currentData.combined || [];
        if (!yahooAdp || ourPlayers.length === 0) return new Set();

        const isAuction = this.leagueSettings.active.draftType === 'auction';
        const yahooList = isAuction ? yahooAdp.salary : yahooAdp.standard;
        if (!yahooList) return new Set();

        const comparisons = [];
        for (const yEntry of yahooList) {
            const ourPlayer = this.matchPlayer(yEntry, ourPlayers);
            if (!ourPlayer) continue;
            if (isAuction) {
                const avgGap = (ourPlayer.dollarValue || 0) - (yEntry.avgCost || 0);
                comparisons.push({ player: ourPlayer, avgGap });
            } else {
                const avgGap = (yEntry.adp || 9999) - (ourPlayer.overallRank || 9999);
                comparisons.push({ player: ourPlayer, avgGap });
            }
        }
        comparisons.sort((a, b) => b.avgGap - a.avgGap);
        const top50 = comparisons.slice(0, 50);
        const result = new Set();
        for (const item of top50) {
            result.add(item.player.name + '|' + (item.player.playerType || ''));
        }
        return result;
    },

    /**
     * Update the Undervalued tab content
     */
    updateUndervaluedTab() {
        const container = document.getElementById('undervaluedContent');
        if (!container) return;

        const yahooAdp = this.currentData.yahooAdp;
        const ourPlayers = this.currentData.combined || [];

        if (!yahooAdp || ourPlayers.length === 0) {
            container.innerHTML = '<p style="color:#64748b;">No data available. Load projections and connect to a Yahoo league first.</p>';
            return;
        }

        const isAuction = this.leagueSettings.active.draftType === 'auction';
        const yahooList = isAuction ? yahooAdp.salary : yahooAdp.standard;

        if (!yahooList || yahooList.length === 0) {
            container.innerHTML = '<p style="color:#64748b;">No Yahoo ADP data for this draft mode.</p>';
            return;
        }

        // Build comparison list
        const comparisons = [];
        for (const yEntry of yahooList) {
            const ourPlayer = this.matchPlayer(yEntry, ourPlayers);
            if (!ourPlayer) continue;
            const isTaken = typeof DraftManager !== 'undefined' && DraftManager.isPlayerTaken(ourPlayer);

            if (isAuction) {
                // Salary: Gap = Our$ - Yahoo$. Positive = Yahoo undervalues.
                const ourVal = ourPlayer.dollarValue || 0;
                const yahooProj = yEntry.projCost || 0;
                const yahooAvg = yEntry.avgCost || 0;
                const gap = ourVal - yahooProj;
                const avgGap = ourVal - yahooAvg;
                comparisons.push({
                    player: ourPlayer, isTaken,
                    ourDisplay: '$' + Math.round(ourVal),
                    yahooDisplay: '$' + yahooProj,
                    yahooAvgDisplay: '$' + yahooAvg.toFixed(1),
                    gap: gap,
                    gapDisplay: (gap >= 0 ? '+$' : '-$') + Math.abs(gap).toFixed(0),
                    avgGap: avgGap,
                    avgGapDisplay: (avgGap >= 0 ? '+$' : '-$') + Math.abs(avgGap).toFixed(1)
                });
            } else {
                // Standard: Gap = YahooRank - OurRank. Positive = Yahoo undervalues.
                const ourRank = ourPlayer.overallRank || 9999;
                const yahooRank = yEntry.yahooRank || 9999;
                const yahooAdpVal = yEntry.adp || 9999;
                const gap = yahooRank - ourRank;
                const avgGap = yahooAdpVal - ourRank;
                comparisons.push({
                    player: ourPlayer, isTaken,
                    ourDisplay: '#' + ourRank,
                    yahooDisplay: '#' + yahooRank,
                    yahooAvgDisplay: '#' + yahooAdpVal.toFixed(1),
                    gap: gap,
                    gapDisplay: (gap >= 0 ? '+' : '') + gap,
                    avgGap: avgGap,
                    avgGapDisplay: (avgGap >= 0 ? '+' : '') + avgGap.toFixed(1)
                });
            }
        }

        // Sort by avgGap descending (most undervalued by player average)
        comparisons.sort((a, b) => b.avgGap - a.avgGap);
        const top50 = comparisons.slice(0, 50);

        if (top50.length === 0) {
            container.innerHTML = '<p style="color:#64748b;">No matchable players found.</p>';
            return;
        }

        const modeLabel = isAuction ? 'Salary Cap' : 'Standard';
        const ourLabel = isAuction ? 'Our $' : 'Our Rank';
        const yahooLabel = isAuction ? 'Yahoo$' : 'Yahoo';
        const avgLabel = isAuction ? 'Avg$' : 'Avg ADP';

        let html = `
            <div style="margin-bottom: 12px; font-size: 0.9em; color: #64748b;">
                Mode: <strong>${modeLabel}</strong> | Top 50 most undervalued (sorted by Avg Gap)
            </div>
            <div style="display: grid; gap: 8px;">
        `;

        top50.forEach((item, i) => {
            const p = item.player;
            const pos = p.positionString || p.positions || '';
            const gapColor = item.gap > 0 ? '#16a34a' : '#dc2626';
            const avgGapColor = item.avgGap > 0 ? '#16a34a' : '#dc2626';
            const takenStyle = item.isTaken ? 'opacity: 0.5; text-decoration: line-through;' : '';
            const takenBadge = item.isTaken ? '<span style="color:#dc2626; font-size:0.7em; font-weight:bold; margin-left:6px; text-decoration:none; display:inline-block;">(TAKEN)</span>' : '';
            html += `
                <div style="display: grid; grid-template-columns: 32px 1fr repeat(5, auto); align-items: center; gap: 10px; padding: 10px 14px; background: ${item.isTaken ? '#f3f4f6' : '#f8fafc'}; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <span style="font-size: 1.2em; font-weight: 700; color: #94a3b8;">${i + 1}</span>
                    <div style="min-width: 140px;">
                        <div style="${takenStyle}"><span style="font-weight: 600; font-size: 0.95em;">${p.name}</span>${takenBadge}</div>
                        <div style="font-size: 0.8em; color: #64748b;">${p.team || ''} - ${pos}</div>
                    </div>
                    <div style="text-align: center; min-width: 55px;">
                        <div style="font-size: 0.7em; color: #94a3b8;">Ours</div>
                        <div style="font-weight: 600; font-size: 0.95em;">${item.ourDisplay}</div>
                    </div>
                    <div style="text-align: center; min-width: 55px;">
                        <div style="font-size: 0.7em; color: #94a3b8;">${yahooLabel}</div>
                        <div style="font-weight: 600; font-size: 0.95em;">${item.yahooDisplay}</div>
                    </div>
                    <div style="text-align: center; min-width: 50px;">
                        <div style="font-size: 0.7em; color: #94a3b8;">Gap</div>
                        <div style="font-weight: 700; color: ${gapColor}; font-size: 1em;">${item.gapDisplay}</div>
                    </div>
                    <div style="text-align: center; min-width: 55px;">
                        <div style="font-size: 0.7em; color: #94a3b8;">${avgLabel}</div>
                        <div style="font-weight: 600; font-size: 0.95em;">${item.yahooAvgDisplay}</div>
                    </div>
                    <div style="text-align: center; min-width: 50px;">
                        <div style="font-size: 0.7em; color: #94a3b8;">Gap</div>
                        <div style="font-weight: 700; color: ${avgGapColor}; font-size: 1em;">${item.avgGapDisplay}</div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    },

    /**
     * Parse the raw data input
     */
    parseData() {
        const rawData = document.getElementById('rawData').value;
        const dataType = document.getElementById('dataType').value;

        if (!rawData.trim()) {
            alert('Please paste data from FanGraphs first.');
            return;
        }

        const result = Parser.parse(rawData, dataType);

        if (result.success) {
            this.displayParseResult(result);
        } else {
            alert('Failed to parse data. Please check the format.');
        }
    },

    /**
     * Display parse results in table
     */
    displayParseResult(result) {
        const resultSection = document.getElementById('parseResult');
        const statsBar = document.getElementById('parseStats');
        const table = document.getElementById('parsedTable');

        // Determine type display
        const typeLabel = result.dataType === 'hitter' ? 'Hitters' : 'Pitchers';
        const autoDetectedBadge = result.autoDetected
            ? ' <span style="background: #16a34a; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem;">Auto-detected</span>'
            : '';

        // Update stats
        statsBar.innerHTML = `
            <div class="stat-item">
                <span class="stat-label">Players Found</span>
                <span class="stat-value">${result.count}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Type</span>
                <span class="stat-value">${typeLabel}${autoDetectedBadge}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Errors</span>
                <span class="stat-value">${result.errors.length}</span>
            </div>
        `;

        // Build table
        const columns = result.dataType === 'hitter'
            ? ['rank', 'name', 'team', 'hr', 'r', 'rbi', 'sb', 'avg', 'obp', 'slg', 'ops', 'war']
            : ['rank', 'name', 'team', 'w', 'sv', 'gs', 'ip', 'k', 'era', 'whip', 'qs', 'war'];

        // Header
        table.querySelector('thead').innerHTML = `
            <tr>
                ${columns.map(col => `<th>${col.toUpperCase()}</th>`).join('')}
            </tr>
        `;

        // Body - show first 50 players
        const displayPlayers = result.players.slice(0, 50);
        table.querySelector('tbody').innerHTML = displayPlayers.map(player => `
            <tr>
                ${columns.map(col => {
                    let value = player[col];
                    if (typeof value === 'number') {
                        if (col === 'avg' || col === 'obp' || col === 'slg' || col === 'ops') {
                            value = value.toFixed(3);
                        } else if (col === 'era' || col === 'whip') {
                            value = value.toFixed(2);
                        }
                    }
                    return `<td>${value !== undefined ? value : '-'}</td>`;
                }).join('')}
            </tr>
        `).join('');

        // Store temporarily
        this.tempParseResult = result;

        // Show result section
        resultSection.classList.remove('hidden');
    },

    /**
     * Clear parser input
     */
    clearParser() {
        document.getElementById('rawData').value = '';
        document.getElementById('parseResult').classList.add('hidden');
        this.tempParseResult = null;
    },

    /**
     * Save parsed data to CSV file only
     */
    async saveData() {
        if (!this.tempParseResult) {
            alert('No parsed data to save.');
            return;
        }

        // Save to CSV file
        const fileResult = await Parser.saveToFile(this.tempParseResult);

        // Update local data
        if (this.tempParseResult.dataType === 'hitter') {
            this.currentData.hitters = this.tempParseResult;
        } else {
            this.currentData.pitchers = this.tempParseResult;
        }

        this.updateDataInfo();

        if (fileResult.success) {
            alert(`Saved ${this.tempParseResult.count} ${this.tempParseResult.dataType}s successfully!\n\nFile saved: data/${fileResult.file}`);
        } else {
            alert(`File save failed: ${fileResult.error}`);
        }
    },

    /**
     * Export data to CSV
     */
    exportCSV() {
        if (!this.tempParseResult) {
            alert('No parsed data to export.');
            return;
        }

        const csv = Parser.toCSV(this.tempParseResult);
        const filename = `fantasy_${this.tempParseResult.dataType}s_${new Date().toISOString().split('T')[0]}.csv`;

        this.downloadFile(csv, filename, 'text/csv');
    },

    /**
     * Download file helper
     */
    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    /**
     * Load data from CSV files on startup
     */
    async loadDataFromFiles() {
        console.log('Loading data from CSV files...');

        // Load hitters
        this.currentData.hitters = await Parser.loadFromFile('hitter');
        if (this.currentData.hitters) {
            console.log('✓ Loaded', this.currentData.hitters.count, 'hitters from CSV');
        }

        // Load pitchers
        this.currentData.pitchers = await Parser.loadFromFile('pitcher');
        if (this.currentData.pitchers) {
            console.log('✓ Loaded', this.currentData.pitchers.count, 'pitchers from CSV');
        }

        // Load Yahoo positions
        const positionsLoaded = await YahooParser.loadFromFile();
        if (positionsLoaded) {
            console.log('✓ Loaded Yahoo positions:', YahooParser.positionData.players.size, 'players');
            this.updateYahooStats();
        } else {
            console.log('⚠ No Yahoo positions loaded (positions.csv not found or empty)');
        }

        // Load merged data if exists
        await this.loadMergedData();
    },

    /**
     * Load merged data from CSV file
     */
    async loadMergedData() {
        try {
            const response = await fetch('api/load.php?type=merged');
            const result = await response.json();

            if (result.success && result.players.length > 0) {
                // Separate hitters and pitchers from merged data
                const hitters = result.players.filter(p => p.type === 'hitter');
                const pitchers = result.players.filter(p => p.type === 'pitcher');

                this.currentData.merged = {
                    hitters: hitters,
                    pitchers: pitchers,
                    timestamp: new Date().toISOString()
                };

                console.log('✓ Loaded merged data:', hitters.length, 'hitters,', pitchers.length, 'pitchers');

                // Auto-calculate values and display rankings
                console.log('  → Auto-calculating player values...');
                this.calculateValues();

                return true;
            }

            return false;
        } catch (error) {
            console.log('No merged data file found (this is normal on first run)');
            return false;
        }
    },

    /**
     * Update data info display (CSV files status)
     */
    updateDataInfo() {
        const infoBox = document.getElementById('storageInfo');
        const hittersCount = this.currentData.hitters?.players?.length || 0;
        const pitchersCount = this.currentData.pitchers?.players?.length || 0;
        const yahooCount = YahooParser.positionData.players.size;

        let html = `
            <p><strong>FanGraphs Hitters:</strong> ${hittersCount} players
                ${hittersCount > 0 ? '(loaded from hitters.csv)' : '(not loaded)'}</p>
            <p><strong>FanGraphs Pitchers:</strong> ${pitchersCount} players
                ${pitchersCount > 0 ? '(loaded from pitchers.csv)' : '(not loaded)'}</p>
            <p><strong>Yahoo Positions:</strong> ${yahooCount} players
                ${yahooCount > 0 ? '(loaded from positions.csv)' : '(not loaded)'}</p>
        `;

        // Show merged data info if exists
        if (this.currentData.merged) {
            html += `
                <p style="color: #16a34a;"><strong>✓ Merged Data:</strong>
                    ${this.currentData.merged.hitters.length} hitters +
                    ${this.currentData.merged.pitchers.length} pitchers
                    (loaded from merged.csv)</p>
            `;
        }

        infoBox.innerHTML = html;

        // Update setup tab status
        this.updateSetupStatus();

        // Update Rankings tab visibility
        const hasData = hittersCount > 0 || pitchersCount > 0 || this.currentData.merged;

        const noDataMsg = document.getElementById('noDataMsg');
        const tableContainer = document.getElementById('playerTableContainer');
        if (noDataMsg) noDataMsg.classList.toggle('hidden', hasData);
        if (tableContainer) tableContainer.classList.toggle('hidden', !hasData);
    },

    /**
     * Calculate values and update player table
     */
    calculateValues() {
        // Determine which data to use: merged (if available) or original FanGraphs data
        let hittersToUse, pitchersToUse;

        if (this.currentData.merged?.hitters && this.currentData.merged?.pitchers) {
            // Use merged data (players with Yahoo positions)
            hittersToUse = this.currentData.merged.hitters;
            pitchersToUse = this.currentData.merged.pitchers;
            console.log('Using merged data (with Yahoo positions)');
        } else {
            // Use original FanGraphs data (no position info)
            hittersToUse = this.currentData.hitters?.players;
            pitchersToUse = this.currentData.pitchers?.players;
            console.log('Using original FanGraphs data (no positions)');
        }

        // Check if we have any data
        if (!hittersToUse && !pitchersToUse) {
            alert('請先在 Data Parser 頁籤載入球員資料！');
            return;
        }

        console.log('Calculating values...');
        console.log('Hitters:', hittersToUse?.length || 0);
        console.log('Pitchers:', pitchersToUse?.length || 0);

        // Calculate for single active league
        let allPlayers = [];
        const leagueSetting = this.leagueSettings.active;

        // Determine Z-score baseline pool size
        const teams = leagueSetting.teams || 12;
        const activeH = leagueSetting.rosterHitters || 14;
        const activeP = leagueSetting.rosterPitchers || 9;
        const comp = leagueSetting.rosterComposition || [];
        const benchSlots = comp.filter(s => s === 'BN').length;
        const activeTotal = activeH + activeP;
        const benchH = activeTotal > 0 ? Math.round(benchSlots * activeH / activeTotal) : 0;
        const benchP = benchSlots - benchH;
        const baselineHitters = Math.min(hittersToUse ? hittersToUse.length : 0, teams * (activeH + benchH) * 2);
        const baselinePitchers = Math.min(pitchersToUse ? pitchersToUse.length : 0, teams * (activeP + benchP) * 2);

        if (hittersToUse) {
            const hittersCopy = hittersToUse.map(p => ({...p}));
            const hittersWithZ = Calculator.calculateZScores(
                hittersCopy,
                'active',
                'hitter',
                leagueSetting.categoryWeights,
                baselineHitters
            );
            allPlayers = allPlayers.concat(hittersWithZ);
        }

        if (pitchersToUse) {
            const pitchersCopy = pitchersToUse.map(p => ({...p}));
            const pitchersWithZ = Calculator.calculateZScores(
                pitchersCopy,
                'active',
                'pitcher',
                leagueSetting.categoryWeights,
                baselinePitchers
            );
            allPlayers = allPlayers.concat(pitchersWithZ);
        }

        // Calculate dollar values if it's an auction draft
        if (leagueSetting.draftType === 'auction') {
            const teamCount = leagueSetting.teams || 12;
            const budgetPerTeam = leagueSetting.budget || 260;
            const totalLeagueBudget = teamCount * budgetPerTeam;

            const split = leagueSetting.hitterPitcherSplit || '60/40';
            const [hitterPctStr, pitcherPctStr] = split.split('/');
            const hitterPct = parseInt(hitterPctStr) / 100;
            const pitcherPct = parseInt(pitcherPctStr) / 100;

            const hitterBudgetPool = totalLeagueBudget * hitterPct;
            const pitcherBudgetPool = totalLeagueBudget * pitcherPct;

            const hitters = allPlayers.filter(p => p.type === 'hitter');
            const pitchers = allPlayers.filter(p => p.type === 'pitcher');

            const activeRatioH = activeH / (activeH + activeP);
            const benchHAuction = Math.round(benchSlots * activeRatioH);
            const benchPAuction = benchSlots - benchHAuction;
            const draftedHitters = activeH + benchHAuction;
            const draftedPitchers = activeP + benchPAuction;

            const valuedHitters = Calculator.calculateDollarValues(
                hitters, hitterBudgetPool, teamCount, draftedHitters
            );
            const valuedPitchers = Calculator.calculateDollarValues(
                pitchers, pitcherBudgetPool, teamCount, draftedPitchers
            );

            allPlayers = [...valuedHitters, ...valuedPitchers];
        } else {
            allPlayers = allPlayers.map(p => ({...p, dollarValue: 0}));
        }

        const splitStr = leagueSetting.hitterPitcherSplit || '60/40';
        const [hPctStr, pPctStr] = splitStr.split('/');
        const hitterWeight = parseInt(hPctStr) / 100;
        const pitcherWeight = parseInt(pPctStr) / 100;
        allPlayers = Calculator.rankPlayers(allPlayers, hitterWeight, pitcherWeight);
        this.currentData.combined = allPlayers;

        console.log('Calculation complete. Updating tables...');
        this.updateRankingsTable();
    },

    /**
     * Safely format a number with fixed decimal places
     * @param {any} value - Value to format
     * @param {number} decimals - Number of decimal places
     * @param {string} defaultValue - Default value if not a number
     * @returns {string} Formatted number string
     */
    formatNumber(value, decimals = 2, defaultValue = '0.00') {
        if (value === null || value === undefined || value === '') {
            return defaultValue;
        }
        const num = parseFloat(value);
        if (isNaN(num)) {
            return defaultValue;
        }
        return num.toFixed(decimals);
    },

    /**
     * Update Rankings table
     */
    updateRankingsTable() {
        const leagueData = this.currentData.combined;

        const noDataMsg = document.getElementById('noDataMsg');
        const tableContainer = document.getElementById('playerTableContainer');
        const tbody = document.querySelector('#playerTable tbody');
        const headerRow = document.querySelector('#playerTable thead tr');

        if (!leagueData || leagueData.length === 0) {
            if (noDataMsg) noDataMsg.classList.remove('hidden');
            if (tableContainer) tableContainer.classList.add('hidden');
            return;
        }

        const leagueSetting = this.leagueSettings.active;
        const isAuction = leagueSetting.draftType === 'auction';
        const positionFilter = document.getElementById('positionFilter')?.value || 'all';

        // Filter players based on position
        let players = this.filterPlayersByPosition(leagueData, positionFilter);

        // Filter Drafted Players
        const hideDraftedCheckbox = document.getElementById('hideDrafted');
        const hideDrafted = hideDraftedCheckbox ? hideDraftedCheckbox.checked : true;

        if (hideDrafted) {
            players = players.filter(p => !DraftManager.isPlayerTaken(p));
        }

        // Determine display mode based on filtered players
        const showPitchers = positionFilter === 'P' || positionFilter === 'SP' || positionFilter === 'RP';
        const showHitters = positionFilter === 'DH' || ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'LF', 'CF', 'RF', 'OF'].includes(positionFilter);
        const showAll = positionFilter === 'all';

        // Sort players using current sort state
        players = this.sortPlayers(players);

        // Dynamic category columns from Calculator.LEAGUES.active
        const league = Calculator.LEAGUES.active;
        const catDisplayNames = {
            'r': 'R', 'hr': 'HR', 'rbi': 'RBI', 'sb': 'SB', 'avg': 'AVG', 'ops': 'OPS',
            'obp': 'OBP', 'w': 'W', 'sv': 'SV', 'k': 'K', 'era': 'ERA', 'whip': 'WHIP',
            'qs': 'QS', 'hld': 'HLD', 'nsvh': 'NSVH'
        };
        const rateStatSet = new Set(['avg', 'ops', 'obp', 'era', 'whip']);

        const sortIndicator = (col) => {
            if (this.sortState.column === col) {
                return this.sortState.direction === 'asc' ? ' ▲' : ' ▼';
            }
            return '';
        };

        const getZClass = (z) => {
            if (z === undefined || z === null) return '';
            if (z >= 1.5) return 'stat-elite';
            if (z >= 0.5) return 'stat-good';
            if (z <= -1.5) return 'stat-poor';
            if (z <= -0.5) return 'stat-bad';
            return '';
        };

        const valHeader = isAuction
            ? `<th data-sort="value">$${sortIndicator('value')}</th>`
            : `<th data-sort="dollarValue">nZ${sortIndicator('dollarValue')}</th>`;

        // Determine which categories to show
        let activeCats = [];
        if (showPitchers && league) {
            activeCats = league.pitching;
        } else if (showHitters && league) {
            activeCats = league.hitting;
        }

        if (showPitchers || showHitters) {
            const catHeaders = activeCats.map(cat => {
                const display = catDisplayNames[cat] || cat.toUpperCase();
                return `<th data-sort="${cat}">${display}${sortIndicator(cat)}</th>`;
            }).join('');

            headerRow.innerHTML = `
                <th data-sort="rank">#</th>
                <th data-sort="name">Name${sortIndicator('name')}</th>
                <th data-sort="team">Team${sortIndicator('team')}</th>
                <th data-sort="positionString">Pos${sortIndicator('positionString')}</th>
                ${valHeader}
                ${catHeaders}
                <th data-sort="zTotal">Z-Total${sortIndicator('zTotal')}</th>
            `;
        } else {
            headerRow.innerHTML = `
                <th data-sort="rank">#</th>
                <th data-sort="name">Name${sortIndicator('name')}</th>
                <th data-sort="team">Team${sortIndicator('team')}</th>
                <th data-sort="playerType">Type${sortIndicator('playerType')}</th>
                <th data-sort="positionString">Pos${sortIndicator('positionString')}</th>
                ${valHeader}
                <th data-sort="zTotal">Z-Total${sortIndicator('zTotal')}</th>
            `;
        }

        // Helper to format a stat cell value
        const formatStatVal = (player, cat) => {
            const raw = player[cat] ?? (cat === 'k' ? player.so : undefined) ?? 0;
            if (rateStatSet.has(cat)) {
                return this.formatNumber(raw, cat === 'avg' || cat === 'ops' || cat === 'obp' ? 3 : 2,
                    cat === 'avg' || cat === 'ops' || cat === 'obp' ? '.000' : '0.00');
            }
            return Math.round(raw);
        };

        // Generate table rows
        const uvSet = this.getUndervaluedSet();
        tbody.innerHTML = players.map((player, index) => {
            const valueDisplay = isAuction
                ? `<td class="${player.dollarValue >= 20 ? 'value-high' : player.dollarValue <= 5 ? 'value-low' : ''}">$${player.dollarValue || 0}</td>`
                : `<td class="${(player.normalizedZ || 0) > 1 ? 'value-high' : (player.normalizedZ || 0) < -1 ? 'value-low' : ''}">${(player.normalizedZ || 0).toFixed(2)}</td>`;
            const posDisplay = player.positionString || player.positions?.join(',') || '-';
            const zTotal = parseFloat(player.zTotal) || 0;
            const zClass = zTotal > 0 ? 'z-positive' : 'z-negative';
            const injuryBadge = player.injuryStatus ? ` <span class="injury-badge injury-${player.injuryStatus.startsWith('IL') ? 'il' : 'dtd'}">${player.injuryStatus}</span>` : '';
            const uvKey = player.name + '|' + (player.playerType || '');
            const uvBadge = uvSet.has(uvKey) ? ' <span style="color:#7c3aed; font-size:0.7em; font-weight:bold; border:1px solid #7c3aed; padding:0 3px; border-radius:3px;">UV</span>' : '';

            if (showPitchers || showHitters) {
                const catCells = activeCats.map(cat => {
                    const z = player['z_' + cat] || 0;
                    return `<td class="${getZClass(z)}">${formatStatVal(player, cat)}</td>`;
                }).join('');

                return `<tr>
                    <td>${player.overallRank || index + 1}</td>
                    <td><strong>${player.name}</strong>${injuryBadge}${uvBadge}</td>
                    <td>${player.team}</td>
                    <td>${posDisplay}</td>
                    ${valueDisplay}
                    ${catCells}
                    <td class="${zClass}">${this.formatNumber(player.zTotal, 1, '0.0')}</td>
                </tr>`;
            } else {
                const typeLabel = player.type === 'pitcher' ? 'P' : 'H';
                return `<tr>
                    <td>${player.overallRank || index + 1}</td>
                    <td><strong>${player.name}</strong>${injuryBadge}${uvBadge}</td>
                    <td>${player.team}</td>
                    <td>${typeLabel}</td>
                    <td>${posDisplay}</td>
                    ${valueDisplay}
                    <td class="${zClass}">${this.formatNumber(player.zTotal, 1, '0.0')}</td>
                </tr>`;
            }
        }).join('');

        // Rebind sort event listeners
        headerRow.querySelectorAll('th[data-sort]').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', (e) => {
                const col = e.target.dataset.sort || e.target.closest('th').dataset.sort;
                if (col) this.sortTable(col);
            });
        });

        noDataMsg.classList.add('hidden');
        tableContainer.classList.remove('hidden');
    },


    /**
     * Filter players array by position
     * @param {Array} players - All players
     * @param {string} position - Position filter value
     * @returns {Array} Filtered players
     */
    filterPlayersByPosition(players, position) {
        if (!players || players.length === 0) return [];

        if (position === 'all') return players;
        
        // Pitchers
        if (position === 'P') return players.filter(p => p.type === 'pitcher');
        if (position === 'SP') return players.filter(p => p.type === 'pitcher' && (p.isPitcherSP || (p.gs > 0)));
        if (position === 'RP') return players.filter(p => p.type === 'pitcher' && (p.isPitcherRP || (p.gs === 0 && p.g > 0)));

        // Hitters
        if (position === 'DH') return players.filter(p => p.type === 'hitter');

        return players.filter(p => {
            if (p.type !== 'hitter') return false;

            // Normalize positions
            let pPositions = [];
            if (Array.isArray(p.positions)) {
                pPositions = p.positions;
            } else if (typeof p.positionString === 'string') {
                pPositions = p.positionString.split(',').map(s => s.trim());
            }

            // Aggregate Logic
            if (position === 'OF') {
                return pPositions.some(pos => ['OF', 'LF', 'CF', 'RF'].includes(pos));
            }
            if (position === 'CI') {
                return pPositions.some(pos => ['1B', '3B'].includes(pos));
            }
            if (position === 'MI') {
                return pPositions.some(pos => ['2B', 'SS'].includes(pos));
            }

            // Exact Match (C, 1B, 2B, 3B, SS, LF, CF, RF)
            return pPositions.includes(position);
        });
    },

    /**
     * Search players by name
     * @param {string} query - Search query
     */
    searchPlayers(query) {
        if (!query) {
            this.updateRankingsTable();
            return;
        }

        query = query.toLowerCase();
        const tbody = document.querySelector('#playerTable tbody');
        if (!tbody) return;
        const rows = tbody.querySelectorAll('tr');

        rows.forEach(row => {
            const name = row.cells[1]?.textContent.toLowerCase() || '';
            row.style.display = name.includes(query) ? '' : 'none';
        });
    },

    /**
     * Sort table by column
     * @param {string} column - Column to sort by
     */
    sortTable(column) {
        if (this.sortState.column === column) {
            this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.column = column;
            if (column === 'name' || column === 'team' || column === 'positionString') {
                this.sortState.direction = 'asc';
            } else if (column === 'era' || column === 'whip') {
                this.sortState.direction = 'asc';
            } else {
                this.sortState.direction = 'desc';
            }
        }

        this.updateRankingsTable();
    },

    /**
     * Sort players array by current sort state
     */
    sortPlayers(players) {
        const { column, direction } = this.sortState;
        const multiplier = direction === 'asc' ? 1 : -1;

        return [...players].sort((a, b) => {
            let aVal = this.getSortValue(a, column);
            let bVal = this.getSortValue(b, column);

            // Handle null/undefined
            if (aVal === null || aVal === undefined) aVal = direction === 'asc' ? Infinity : -Infinity;
            if (bVal === null || bVal === undefined) bVal = direction === 'asc' ? Infinity : -Infinity;

            // String comparison
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return multiplier * aVal.localeCompare(bVal);
            }

            // Numeric comparison
            return multiplier * (aVal - bVal);
        });
    },

    /**
     * Get sortable value from player
     */
    getSortValue(player, column) {
        // Handle special column mappings
        const mappings = {
            'value': player.dollarValue || player.normalizedZ || player.zTotal || 0,
            'rank': player.overallRank || player.valueRank || 0,
            'pos': player.positionString || '',
            'k': player.k || player.so || 0,
            'so': player.k || player.so || 0
        };

        if (mappings.hasOwnProperty(column)) {
            return mappings[column];
        }

        // dollarValue: fallback to normalizedZ (cross-type comparable) then zTotal for snake draft
        if (column === 'dollarValue') {
            return player.dollarValue || player.normalizedZ || player.zTotal || 0;
        }

        return player[column];
    },

    /**
     * Clear all data from memory (CSV files remain on disk)
     * To fully reset, delete CSV files manually
     */
    clearAllData() {
        if (confirm('Clear all data from memory?\n\nNote: CSV files will remain on disk.\nTo fully reset, delete the CSV files in the data/ folder.')) {
            // Clear memory only (files remain)
            YahooParser.clear();
            this.currentData = { hitters: null, pitchers: null, merged: null, combined: [], yahooAdp: this.currentData.yahooAdp };
            this.updateDataInfo();
            this.updateYahooStats();
            this.updateRankingsTable();
            // Hide unmatched players section
            document.getElementById('unmatchedPlayersSection')?.classList.add('hidden');
            alert('Memory cleared. Refresh page to reload data from CSV files.');
        }
    },

    // ==========================================
    // Setup Tab / Yahoo API Methods
    // ==========================================

    /**
     * Update Setup tab status display
     */
    updateSetupStatus() {
        const hitterCount = document.getElementById('setupHitterCount');
        const pitcherCount = document.getElementById('setupPitcherCount');
        const mergedCount = document.getElementById('setupMergedCount');
        const loadPlayersBtn = document.getElementById('yahooLoadPlayersBtn');
        const yahooSavedStatus = document.getElementById('yahooPlayerSavedStatus');

        if (!hitterCount) return;

        const hc = this.currentData.hitters?.players?.length || 0;
        const pc = this.currentData.pitchers?.players?.length || 0;
        const yahooCount = YahooParser.positionData.players.size;
        const mc = (this.currentData.merged?.hitters?.length || 0) + (this.currentData.merged?.pitchers?.length || 0);

        // Step 2: Show saved Yahoo player count
        if (yahooSavedStatus) {
            if (yahooCount > 0) {
                yahooSavedStatus.innerHTML = `<span style="color: #16a34a;">✓ ${yahooCount} players with position data loaded from saved data</span>`;
            } else {
                yahooSavedStatus.innerHTML = `<span style="color: #94a3b8;">No saved position data. Click below to load from Yahoo.</span>`;
            }
        }

        // Step 2: Update button text based on existing data
        if (loadPlayersBtn && typeof YahooApi !== 'undefined') {
            loadPlayersBtn.disabled = !(YahooApi.authenticated && YahooApi.selectedLeague);
            loadPlayersBtn.textContent = yahooCount > 0 ? 'Reload Players from Yahoo' : 'Load Players from Yahoo';
        }

        // Step 3: Hitter/Pitcher counts
        hitterCount.textContent = hc > 0 ? `${hc} players loaded` : 'Not loaded';
        hitterCount.style.color = hc > 0 ? '#16a34a' : '#dc2626';

        pitcherCount.textContent = pc > 0 ? `${pc} players loaded` : 'Not loaded';
        pitcherCount.style.color = pc > 0 ? '#16a34a' : '#dc2626';

        if (mc > 0) {
            mergedCount.textContent = `${mc} players merged`;
            mergedCount.style.color = '#16a34a';
        } else if (yahooCount > 0 && (hc > 0 || pc > 0)) {
            mergedCount.textContent = `Ready to merge (${yahooCount} positions loaded)`;
            mergedCount.style.color = '#0284c7';
        } else {
            mergedCount.textContent = 'Not merged';
            mergedCount.style.color = '#dc2626';
        }

        // Step 3: Update fetch button text based on existing data
        const fetchBtn = document.getElementById('setupFetchProjectionsBtn');
        if (fetchBtn) {
            fetchBtn.textContent = (hc > 0 || pc > 0) ? 'Reload from FanGraphs' : 'Fetch from FanGraphs';
        }
    },

    /**
     * Handle "Fetch from FanGraphs" button click in Setup tab
     * Fetches hitter + pitcher projections via PHP proxy and saves to CSV
     */
    async handleFetchProjections() {
        const btn = document.getElementById('setupFetchProjectionsBtn');
        const statusEl = document.getElementById('setupFetchStatus');
        const systemSelect = document.getElementById('projectionSystem');
        const system = systemSelect?.value || 'thebatx';

        btn.disabled = true;
        btn.textContent = 'Fetching...';
        statusEl.innerHTML = '<span style="color: #0284c7;">Fetching hitter projections...</span>';

        try {
            // Fetch both hitters and pitchers
            // For hitters: use selected system (default thebatx)
            // For pitchers: if system is thebatx, use thebat (thebatx is hitters-only)
            const pitcherSystem = system === 'thebatx' ? 'thebat' : system;

            const response = await fetch(`api/fangraphs.php?action=both&system=${system}`);
            const result = await response.json();

            if (!result.success) {
                const err = result.hitters?.error || result.pitchers?.error || 'Unknown error';
                statusEl.innerHTML = `<span style="color: #dc2626;">Error: ${err}</span>`;
                return;
            }

            const hittersData = result.hitters;
            const pitchersData = result.pitchers;

            if (!hittersData.success || !pitchersData.success) {
                const err = hittersData.error || pitchersData.error || 'Partial failure';
                statusEl.innerHTML = `<span style="color: #dc2626;">Error: ${err}</span>`;
                return;
            }

            statusEl.innerHTML = '<span style="color: #0284c7;">Processing data...</span>';

            // Convert FanGraphs API JSON to our internal parser format
            const hitterParsed = this.convertFanGraphsToInternal(hittersData.players, 'hitter');
            const pitcherParsed = this.convertFanGraphsToInternal(pitchersData.players, 'pitcher');

            // Store in app state
            this.currentData.hitters = hitterParsed;
            this.currentData.pitchers = pitcherParsed;

            // Save to CSV files via existing Parser.saveToFile
            await Parser.saveToFile(hitterParsed);
            await Parser.saveToFile(pitcherParsed);

            // Update UI
            this.updateSetupStatus();
            statusEl.innerHTML = `<span style="color: #16a34a;">${hittersData.count} hitters + ${pitchersData.count} pitchers (${hittersData.system})</span>`;

            // Auto-merge if Yahoo positions are loaded
            if (YahooParser && YahooParser.getStats().totalPlayers > 0) {
                statusEl.innerHTML += ' - Merging...';
                await this.mergeData();
                statusEl.innerHTML = `<span style="color: #16a34a;">${hittersData.count} hitters + ${pitchersData.count} pitchers loaded & merged!</span>`;
                this.updateSetupStatus();
            }

        } catch (e) {
            console.error('Failed to fetch projections:', e);
            statusEl.innerHTML = `<span style="color: #dc2626;">Error: ${e.message}</span>`;
        } finally {
            btn.disabled = false;
            this.updateSetupStatus();
        }
    },

    /**
     * Convert FanGraphs API JSON players to our internal parser result format
     * This produces the same structure as Parser.parse() so existing merge/calc code works
     */
    convertFanGraphsToInternal(players, dataType) {
        const internalPlayers = players.map((p, i) => {
            const base = {
                type: dataType,
                rank: i + 1,
                name: p.name,
                team: p.team,
            };

            if (dataType === 'hitter') {
                return {
                    ...base,
                    g: p.g, pa: p.pa, ab: p.ab, h: p.h,
                    '2b': p.doubles, '3b': p.triples,
                    hr: p.hr, r: p.r, rbi: p.rbi,
                    bb: p.bb, so: p.so, hbp: p.hbp,
                    sb: p.sb, cs: p.cs,
                    bbPct: p.bbPct, kPct: p.kPct,
                    iso: p.iso, babip: p.babip,
                    avg: p.avg, obp: p.obp, slg: p.slg,
                    ops: p.ops, woba: p.woba, wrcPlus: p.wrcPlus,
                    adp: p.adp,
                };
            } else {
                return {
                    ...base,
                    g: p.g, gs: p.gs, ip: p.ip,
                    w: p.w, l: p.l, qs: p.qs,
                    sv: p.sv, hld: p.hld,
                    h: p.h, er: p.er, hr: p.hr,
                    so: p.so, bb: p.bb, k: p.so, // k = so alias
                    k9: p.k9, bb9: p.bb9, hr9: p.hr9,
                    avg: p.avg, whip: p.whip,
                    babip: p.babip, lobPct: p.lobPct,
                    era: p.era, fip: p.fip,
                    adp: p.adp,
                };
            }
        });

        return {
            success: true,
            dataType: dataType,
            autoDetected: false,
            players: internalPlayers,
            count: internalPlayers.length,
            errors: [],
            timestamp: new Date().toISOString(),
            source: 'fangraphs_api',
        };
    },

    /**
     * Handle "Load League" button click in Setup tab
     */
    async handleLoadLeague() {
        if (typeof YahooApi === 'undefined') return;

        const selector = document.getElementById('yahooLeagueSelect');
        const leagueKey = selector?.value;
        if (!leagueKey) {
            alert('Please select a league first.');
            return;
        }

        await YahooApi.selectLeague(leagueKey);
        this.updateSetupStatus();
    },

    /**
     * Handle "Load Players from Yahoo" button click in Setup tab
     */
    async handleLoadPlayersFromApi() {
        if (typeof YahooApi === 'undefined' || !YahooApi.selectedLeague) {
            alert('Please select a league first.');
            return;
        }

        const btn = document.getElementById('yahooLoadPlayersBtn');
        const progressDiv = document.getElementById('yahooPlayerLoadProgress');
        const progressBar = document.getElementById('yahooPlayerProgressBar');
        const progressText = document.getElementById('yahooPlayerProgressText');
        const statusEl = document.getElementById('yahooPlayerLoadStatus');

        btn.disabled = true;
        btn.textContent = 'Loading...';
        progressDiv.classList.remove('hidden');

        try {
            const players = await YahooApi.fetchAllPlayers(
                YahooApi.selectedLeague.league_key,
                (msg) => {
                    progressText.textContent = msg;
                    // Progress based on "Total so far: N" in the message
                    const totalMatch = msg.match(/Total so far: (\d+)/);
                    if (totalMatch) {
                        const current = parseInt(totalMatch[1]);
                        const estimated = 800;
                        progressBar.style.width = Math.min(95, (current / estimated) * 100) + '%';
                    }
                }
            );

            if (players && players.length > 0) {
                // Clear existing Yahoo data and load new data
                YahooParser.clear();
                players.forEach(p => YahooParser.addPlayer(p));

                // Save to file
                await YahooParser.saveToFile();

                // Update UI
                this.updateYahooStats();
                statusEl.innerHTML = `<span style="color: #16a34a;">${players.length} players loaded from Yahoo API</span>`;
                progressBar.style.width = '100%';

                // Auto-merge if projections are available
                const hc = this.currentData.hitters?.players?.length || 0;
                const pc = this.currentData.pitchers?.players?.length || 0;
                if (hc > 0 || pc > 0) {
                    statusEl.innerHTML += ' - Auto-merging...';
                    await this.mergeData();
                    statusEl.innerHTML = `<span style="color: #16a34a;">${players.length} players loaded and merged!</span>`;
                }

                this.updateSetupStatus();
            } else {
                statusEl.innerHTML = '<span style="color: #dc2626;">No players returned from API</span>';
            }
        } catch (e) {
            console.error('Failed to load players from API:', e);
            statusEl.innerHTML = `<span style="color: #dc2626;">Error: ${e.message}</span>`;
        } finally {
            btn.disabled = false;
            this.updateSetupStatus();
        }
    },

    // ==========================================
    // Yahoo Position Parser Methods
    // ==========================================

    /**
     * Parse Yahoo position data
     */
    parseYahooData() {
        const rawData = document.getElementById('yahooRawData').value;

        if (!rawData.trim()) {
            alert('Please paste Yahoo player data first.');
            return;
        }

        const result = YahooParser.parse(rawData);

        // Show result
        const resultDiv = document.getElementById('yahooParseResult');
        const statsDiv = document.getElementById('yahooParseStats');

        if (result.success) {
            statsDiv.innerHTML = `
                <p class="success">Successfully added <strong>${result.newCount}</strong> players.</p>
                <p>Total players collected: <strong>${result.totalPlayers}</strong></p>
            `;
            resultDiv.classList.remove('hidden');

            // Update accumulated stats display
            this.updateYahooStats();

            // Clear input for next paste
            document.getElementById('yahooRawData').value = '';
        } else {
            statsDiv.innerHTML = `<p class="error">No players found in the pasted data. Please check the format.</p>`;
            resultDiv.classList.remove('hidden');
        }
    },

    /**
     * Update Yahoo accumulated stats display
     */
    updateYahooStats() {
        const stats = YahooParser.getStats();

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        // Update hitter stats
        set('statHittersTotal', stats.hitters.total);
        set('statC', stats.hitters.C);
        set('stat1B', stats.hitters['1B']);
        set('stat2B', stats.hitters['2B']);
        set('stat3B', stats.hitters['3B']);
        set('statSS', stats.hitters.SS);
        set('statOF', stats.hitters.OF);

        // Update pitcher stats
        set('statPitchersTotal', stats.pitchers.total);
        set('statSP', stats.pitchers.SP);
        set('statRP', stats.pitchers.RP);
        set('statSPRP', stats.pitchers['SP,RP']);

        // Update special stats
        set('statTwoWay', stats.twoWay);
    },

    /**
     * Clear Yahoo position data from memory only
     */
    clearYahooData() {
        if (confirm('Clear position data from memory?\n\nThis will also clear merged data and Roto/H2H rankings.\nNote: CSV files will remain on disk.')) {
            // Clear Yahoo positions
            YahooParser.clear();
            this.updateYahooStats();
            document.getElementById('yahooParseResult').classList.add('hidden');

            // Clear merged + combined (depends on Yahoo data)
            this.currentData.merged = null;
            this.currentData.combined = [];

            // Update all UI
            this.updateDataInfo();
            this.updateRankingsTable();
            this.updateDraftAssistantUI();
            document.getElementById('unmatchedPlayersSection')?.classList.add('hidden');

            alert('Position data and merged rankings cleared from memory.');
        }
    },

    /**
     * Save Yahoo position data to CSV file
     */
    async saveYahooData() {
        const fileResult = await YahooParser.saveToFile();

        if (fileResult.success) {
            alert(`Position data saved!\n- ${YahooParser.positionData.players.size} players\n- File: data/positions.csv`);
        } else {
            alert('File save failed: ' + fileResult.error);
        }
    },

    /**
     * Search for a player in Yahoo position data
     */
    searchYahooPlayer() {
        const searchInput = document.getElementById('yahooSearchInput').value.trim();
        const resultDiv = document.getElementById('yahooSearchResult');

        if (!searchInput) {
            resultDiv.classList.add('hidden');
            return;
        }

        // Search in Yahoo position data
        const searchLower = searchInput.toLowerCase();
        const matches = [];

        YahooParser.positionData.players.forEach(player => {
            if (player.name.toLowerCase().includes(searchLower)) {
                matches.push(player);
            }
        });

        // Display results
        resultDiv.classList.remove('hidden');

        if (matches.length === 0) {
            resultDiv.style.background = '#fee';
            resultDiv.innerHTML = `
                <h4 style="color: #c00; margin-bottom: 10px;">❌ Not Found</h4>
                <p><strong>"${searchInput}"</strong> 不在 Yahoo 位置資料中。</p>
                <p style="margin-top: 10px; font-size: 0.9em;">可能原因：</p>
                <ul style="margin-left: 20px; font-size: 0.9em;">
                    <li>該球員未在 Yahoo 系統中（新秀、小聯盟等）</li>
                    <li>匯入 Yahoo 數據時漏掉了該球員的位置</li>
                    <li>名字拼寫不同</li>
                </ul>
            `;
        } else {
            resultDiv.style.background = '#efe';
            let html = `
                <h4 style="color: #0a0; margin-bottom: 10px;">✓ Found ${matches.length} Match${matches.length > 1 ? 'es' : ''}</h4>
                <table style="width: 100%; font-size: 0.9em; margin-top: 10px;">
                    <thead>
                        <tr style="background: #ddd;">
                            <th style="padding: 8px; text-align: left;">Name</th>
                            <th style="padding: 8px; text-align: left;">Team</th>
                            <th style="padding: 8px; text-align: left;">Positions</th>
                            <th style="padding: 8px; text-align: left;">Type</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            matches.forEach(player => {
                html += `
                    <tr style="border-bottom: 1px solid #ddd;">
                        <td style="padding: 8px;">${player.name}</td>
                        <td style="padding: 8px;">${player.team}</td>
                        <td style="padding: 8px;">${player.positions.join(', ')}</td>
                        <td style="padding: 8px;">${player.playerType}</td>
                    </tr>
                `;
            });

            html += '</tbody></table>';

            // Show normalized key for debugging
            if (matches.length === 1) {
                const player = matches[0];
                const normalizedKey = this.normalizePlayerKey(player.name, player.team);
                html += `<p style="margin-top: 10px; font-size: 0.85em; color: #666;">
                    <strong>Normalized Key:</strong> <code>${normalizedKey}</code>
                </p>`;
            }

            resultDiv.innerHTML = html;
        }
    },

    // ==========================================
    // Data Merger Methods
    // ==========================================

    /**
     * Merge projection data with position data
     * Reads directly from CSV files and creates merged.csv
     */
    async mergeData() {
        // Prevent double-clicking
        const mergeBtn = document.getElementById('mergeDataBtn');
        if (mergeBtn?.disabled) {
            console.log('Merge already in progress, ignoring click');
            return;
        }

        if (mergeBtn) {
            mergeBtn.disabled = true;
            mergeBtn.textContent = 'Merging...';
        }

        try {
            console.log('Starting merge process - loading fresh data from CSV files...');

            // Load fresh data from CSV files
            const hittersData = await Parser.loadFromFile('hitter');
            const pitchersData = await Parser.loadFromFile('pitcher');
            const positionsLoaded = await YahooParser.loadFromFile();

            const hitters = hittersData?.players || [];
            const pitchers = pitchersData?.players || [];
            const positions = YahooParser.getAllPlayers();

            if (hitters.length === 0 && pitchers.length === 0) {
                alert('No projection data found!\n\nPlease:\n1. Go to Projections tab\n2. Import hitters and pitchers\n3. Save the data');
                return;
            }

            if (positions.length === 0) {
                alert('No position data found!\n\nPlease:\n1. Go to Yahoo Positions tab\n2. Import position data\n3. Save the data');
                return;
            }

            console.log('Merging data...');
            console.log('Projections:', hitters.length, 'hitters,', pitchers.length, 'pitchers');
            console.log('Yahoo positions:', positions.length, 'players');

        // Create position lookup maps from Yahoo data (separate for hitters and pitchers)
        // This handles Ohtani-type players who have both hitter and pitcher entries
        const hitterPositionMap = new Map();
        const pitcherPositionMap = new Map();

        positions.forEach(p => {
            const baseKey = this.normalizePlayerKey(p.name, p.team);
            if (p.playerType === 'two-way') {
                // Two-way players (e.g. Ohtani) go into BOTH maps
                hitterPositionMap.set(baseKey, p);
                pitcherPositionMap.set(baseKey, p);
            } else if (p.playerType === 'pitcher') {
                pitcherPositionMap.set(baseKey, p);
            } else {
                hitterPositionMap.set(baseKey, p);
            }
        });

        let matched = 0;
        let excluded = 0;
        const unmatchedHitters = [];
        const unmatchedPitchers = [];

        // Merge hitters - only keep players that exist in both FanGraphs and Yahoo
        const mergedHitters = [];
        hitters.forEach(player => {
            const posData = this.findPlayerWithAbbreviation(player.name, player.team, hitterPositionMap);

            if (posData) {
                matched++;
                mergedHitters.push({
                    ...player,
                    positions: posData.positions,
                    playerType: 'hitter',
                    positionString: posData.positions.join(','),
                    injuryStatus: posData.injuryStatus || '',
                    _yahooPlayerKey: posData._yahooPlayerKey || '',
                });
            } else {
                excluded++;
                unmatchedHitters.push({ name: player.name, team: player.team });
            }
        });

        // Merge pitchers - only keep players that exist in both FanGraphs and Yahoo
        const mergedPitchers = [];
        pitchers.forEach(player => {
            const posData = this.findPlayerWithAbbreviation(player.name, player.team, pitcherPositionMap);

            if (posData) {
                matched++;
                mergedPitchers.push({
                    ...player,
                    positions: posData.positions,
                    playerType: 'pitcher',
                    isPitcherSP: posData.isPitcherSP,
                    isPitcherRP: posData.isPitcherRP,
                    positionString: posData.positions.join(','),
                    injuryStatus: posData.injuryStatus || '',
                    _yahooPlayerKey: posData._yahooPlayerKey || '',
                });
            } else {
                excluded++;
                unmatchedPitchers.push({ name: player.name, team: player.team });
            }
        });

            // Store merged data separately (DO NOT overwrite original FanGraphs data)
            this.currentData.merged = {
                hitters: mergedHitters,
                pitchers: mergedPitchers,
                timestamp: new Date().toISOString()
            };

            console.log('Saving merged data to file...');
            // Save merged data to CSV file
            await this.saveMergedDataToFile(mergedHitters, mergedPitchers);

            console.log('Calculating player values...');
            // Recalculate values
            this.calculateValues();

            // Display unmatched players
            this.displayUnmatchedPlayers(unmatchedHitters, unmatchedPitchers);

            console.log('Merge completed successfully!');
            alert(`Data merged!\n\nMatched: ${matched} players\nExcluded: ${excluded} players (not in Yahoo)\n\nFinal: ${mergedHitters.length} hitters, ${mergedPitchers.length} pitchers\n\nFile saved: data/merged.csv`);

        } catch (error) {
            console.error('Merge failed:', error);
            alert(`Merge failed!\n\nError: ${error.message}\n\nPlease check:\n1. All CSV files exist (hitters.csv, pitchers.csv, positions.csv)\n2. Browser console for detailed error messages\n3. API server is running`);
        } finally {
            if (mergeBtn) {
                mergeBtn.disabled = false;
                mergeBtn.textContent = 'Merge with Projections';
            }
        }
    },

    /**
     * Save merged data to file via API
     */
    async saveMergedDataToFile(mergedHitters, mergedPitchers) {
        // Define the canonical field order for merged CSV
        // This ensures consistency regardless of source data structure
        const fieldOrder = [
            // Common fields
            'type', 'rank', 'name', 'team',

            // Hitter fields (will be empty for pitchers)
            'g', 'pa', 'ab', 'h', 'doubles', 'triples', 'hr', 'r', 'rbi', 'bb', 'so', 'hbp', 'sb', 'cs',
            'bbPct', 'kPct', 'iso', 'babip', 'avg', 'obp', 'slg', 'ops', 'woba', 'wrcPlus',
            'bsr', 'off', 'def',

            // Common/Yahoo fields
            'war', 'adp', 'positions', 'playerType', 'positionString', 'injuryStatus',

            // Pitcher fields (will be empty for hitters)
            'gs', 'ip', 'w', 'l', 'qs', 'sv', 'hld', 'er', 'k9', 'bb9', 'kbb', 'hr9',
            'whip', 'lobPct', 'gbPct', 'era', 'fip', 'k', 'nsvh',

            // Pitcher Yahoo fields
            'isPitcherSP', 'isPitcherRP'
        ];

        // Combine hitters and pitchers into single array
        const allPlayers = [...mergedHitters, ...mergedPitchers];

        // Convert positions array to comma-separated string for CSV compatibility
        // and ensure fields are in canonical order
        const playersForExport = allPlayers.map(p => {
            const exportPlayer = {};

            // Extract fields in the canonical order
            fieldOrder.forEach(field => {
                let value = p[field];

                // Convert positions array to string
                if (field === 'positions' && Array.isArray(value)) {
                    value = value.join(',');
                }

                // Set the value (undefined becomes empty string in CSV)
                exportPlayer[field] = value !== undefined ? value : '';
            });

            return exportPlayer;
        });

        try {
            const response = await fetch('api/save.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'merged',
                    players: playersForExport
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            if (result.success) {
                console.log(`✓ Merged data saved to file: data/merged.csv (${result.count} players)`);
            } else {
                throw new Error(`Save API returned error: ${result.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to save merged data to file:', error);
            throw new Error(`Failed to save merged.csv: ${error.message}`);
        }
    },

    /**
     * Display unmatched players list
     */
    displayUnmatchedPlayers(unmatchedHitters, unmatchedPitchers) {
        const section = document.getElementById('unmatchedPlayersSection');
        if (!section) {
            // UI elements not present, log to console instead
            if (unmatchedHitters.length > 0) {
                console.log('Unmatched hitters:', unmatchedHitters.map(p => `${p.name} (${p.team})`).join(', '));
            }
            if (unmatchedPitchers.length > 0) {
                console.log('Unmatched pitchers:', unmatchedPitchers.map(p => `${p.name} (${p.team})`).join(', '));
            }
            return;
        }

        const hittersBody = document.getElementById('unmatchedHittersBody');
        const pitchersBody = document.getElementById('unmatchedPitchersBody');
        const hittersCount = document.getElementById('unmatchedHittersCount');
        const pitchersCount = document.getElementById('unmatchedPitchersCount');

        // Update summary stats
        const fangraphsTotal = (this.currentData.hitters?.players?.length || 0) +
                               (this.currentData.pitchers?.players?.length || 0);
        const yahooTotal = YahooParser.positionData.players.size;
        const matchedTotal = (this.currentData.merged?.hitters?.length || 0) +
                            (this.currentData.merged?.pitchers?.length || 0);
        const unmatchedTotal = unmatchedHitters.length + unmatchedPitchers.length;

        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setText('fangraphsTotalCount', fangraphsTotal);
        setText('yahooTotalCount', yahooTotal);
        setText('matchedTotalCount', matchedTotal);
        setText('fangraphsUnmatchedTotal', unmatchedTotal);

        if (hittersCount) hittersCount.textContent = unmatchedHitters.length;
        if (pitchersCount) pitchersCount.textContent = unmatchedPitchers.length;

        if (hittersBody) {
            hittersBody.innerHTML = unmatchedHitters.length > 0
                ? unmatchedHitters.map(p => {
                    const normalizedKey = this.normalizePlayerKey(p.name, p.team);
                    return `<tr><td><strong>${p.name}</strong></td><td>${p.team}</td><td style="color: #64748b; font-size: 0.8rem;">${normalizedKey}</td></tr>`;
                }).join('')
                : '<tr><td colspan="3" style="text-align: center; color: #16a34a;">All hitters matched!</td></tr>';
        }

        if (pitchersBody) {
            pitchersBody.innerHTML = unmatchedPitchers.length > 0
                ? unmatchedPitchers.map(p => {
                    const normalizedKey = this.normalizePlayerKey(p.name, p.team);
                    return `<tr><td><strong>${p.name}</strong></td><td>${p.team}</td><td style="color: #64748b; font-size: 0.8rem;">${normalizedKey}</td></tr>`;
                }).join('')
                : '<tr><td colspan="3" style="text-align: center; color: #16a34a;">All pitchers matched!</td></tr>';
        }

        section.classList.remove('hidden');
    },

    /**
     * Unified team code normalization map (FanGraphs → Standard)
     * Both FanGraphs and Yahoo codes are normalized to a common standard
     */
    TEAM_CODE_MAP: {
        // FanGraphs codes → Standard
        'KCR': 'KC',
        'SDP': 'SD',
        'SFG': 'SF',
        'TBR': 'TB',
        'WSN': 'WSH',
        'CHW': 'CWS',

        // Yahoo codes → Standard (from yahooParser)
        'AZ': 'ARI',
        'ATH': 'OAK',
        'WAS': 'WSH',

        // Standard codes (map to themselves for consistency)
        'ARI': 'ARI', 'ATL': 'ATL', 'BAL': 'BAL', 'BOS': 'BOS',
        'CHC': 'CHC', 'CWS': 'CWS', 'CIN': 'CIN', 'CLE': 'CLE',
        'COL': 'COL', 'DET': 'DET', 'HOU': 'HOU', 'KC': 'KC',
        'LAA': 'LAA', 'LAD': 'LAD', 'MIA': 'MIA', 'MIL': 'MIL',
        'MIN': 'MIN', 'NYM': 'NYM', 'NYY': 'NYY', 'OAK': 'OAK',
        'PHI': 'PHI', 'PIT': 'PIT', 'SD': 'SD', 'SF': 'SF',
        'SEA': 'SEA', 'STL': 'STL', 'TB': 'TB', 'TEX': 'TEX',
        'TOR': 'TOR', 'WSH': 'WSH'
    },

    /**
     * Normalize team code to standard format
     */
    normalizeTeamCode(team) {
        const upperTeam = team.toUpperCase();

        // Return normalized code if found, otherwise return original
        // (numeric codes or invalid codes will pass through)
        return this.TEAM_CODE_MAP[upperTeam] || upperTeam;
    },

    /**
     * Normalize player key for matching
     */
    normalizePlayerKey(name, team) {
        const normalizedName = name.toLowerCase()
            .normalize('NFD')                        // Decompose accented characters
            .replace(/[\u0300-\u036f]/g, '')         // Remove accent marks (á→a, é→e, ñ→n, etc.)
            .replace(/\./g, '')
            .replace(/'/g, '')
            .replace(/'/g, '')  // curly apostrophe
            .replace(/-/g, ' ')
            .replace(/\s+(jr|sr|ii|iii|iv)$/i, '')  // Remove suffixes
            .replace(/\s+/g, ' ')
            .trim();

        // Normalize team code using unified map
        const normalizedTeam = this.normalizeTeamCode(team);

        return `${normalizedName}|${normalizedTeam}`;
    },

    /**
     * Try to match player with abbreviated first name
     * E.g., "S. Schwellenbach" (Yahoo) matches "Spencer Schwellenbach" (FanGraphs)
     * @param {string} fangraphsName - Full name from FanGraphs
     * @param {string} yahooName - Possibly abbreviated name from Yahoo
     * @param {string} team - Team code (already normalized)
     * @returns {boolean} - True if names match (considering abbreviations)
     */
    matchWithAbbreviation(fangraphsName, yahooName, team) {
        // Normalize both names (lowercase, remove punctuation)
        const normalizeName = (name) => name.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\./g, '')
            .replace(/'/g, '')
            .replace(/'/g, '')
            .replace(/-/g, ' ')
            .trim();

        const fgNorm = normalizeName(fangraphsName);
        const yahooNorm = normalizeName(yahooName);

        // Split into parts (first name(s) and last name)
        const fgParts = fgNorm.split(/\s+/);
        const yahooParts = yahooNorm.split(/\s+/);

        // Must have at least 2 parts (first + last name)
        if (fgParts.length < 2 || yahooParts.length < 2) {
            return false;
        }

        // Last names must match exactly
        const fgLast = fgParts[fgParts.length - 1];
        const yahooLast = yahooParts[yahooParts.length - 1];
        if (fgLast !== yahooLast) {
            return false;
        }

        // Check first name(s) - handle abbreviations
        const fgFirst = fgParts[0];
        const yahooFirst = yahooParts[0];

        // If one is a single letter, check if it matches the first letter of the other
        if (fgFirst.length === 1 && yahooFirst.length > 1) {
            return fgFirst === yahooFirst[0];
        }
        if (yahooFirst.length === 1 && fgFirst.length > 1) {
            return yahooFirst === fgFirst[0];
        }

        // Handle multi-part first names (e.g., "a j" vs "aj")
        if (fgParts.length >= 2 && yahooParts.length >= 2) {
            // Check if second part is also abbreviated (e.g., "A.J." vs "Andrew James")
            const fgSecond = fgParts.length > 2 ? fgParts[1] : '';
            const yahooSecond = yahooParts.length > 2 ? yahooParts[1] : '';

            if (fgSecond && yahooSecond) {
                if (fgSecond.length === 1 && yahooSecond.length > 1) {
                    return fgFirst === yahooFirst[0] && fgSecond === yahooSecond[0];
                }
                if (yahooSecond.length === 1 && fgSecond.length > 1) {
                    return yahooFirst === fgFirst[0] && yahooSecond === fgSecond[0];
                }
            }
        }

        // Both full names or both abbreviated - must match exactly
        return fgFirst === yahooFirst;
    },

    /**
     * Find player in position map using fuzzy matching (abbreviations)
     * @param {string} playerName - Player name from FanGraphs
     * @param {string} team - Normalized team code
     * @param {Map} positionMap - Map of Yahoo positions
     * @returns {Object|null} - Position data if found
     */
    findPlayerWithAbbreviation(playerName, team, positionMap) {
        // Try exact match first
        const exactKey = this.normalizePlayerKey(playerName, team);
        if (positionMap.has(exactKey)) {
            return positionMap.get(exactKey);
        }

        // Try fuzzy match (abbreviations) - same team
        for (const [key, posData] of positionMap.entries()) {
            if (this.matchWithAbbreviation(playerName, posData.name, team)) {
                console.log(`  ✓ Abbreviation match: "${playerName}" → "${posData.name}"`);
                return posData;
            }
        }

        // Fallback for UNKNOWN team (free agents): match by name only
        if (team === 'UNKNOWN' || team === '' || !team) {
            const normName = this.normalizePlayerKey(playerName, '').split('|')[0]; // name part only
            for (const [key, posData] of positionMap.entries()) {
                const keyName = key.split('|')[0];
                if (keyName === normName) {
                    console.log(`  ✓ Name-only match (FA): "${playerName}" (${team}) → "${posData.name}" (${posData.team})`);
                    return posData;
                }
            }
            // Also try abbreviation match ignoring team
            for (const [key, posData] of positionMap.entries()) {
                if (this.matchWithAbbreviation(playerName, posData.name, posData.team)) {
                    console.log(`  ✓ Abbreviation+FA match: "${playerName}" → "${posData.name}" (${posData.team})`);
                    return posData;
                }
            }
        }

        return null;
    },

    /**
     * Debug: Check for potential duplicates in Yahoo data
     */
    checkDuplicates() {
        const duplicates = YahooParser.findPotentialDuplicates();
        if (duplicates.length > 0) {
            console.log('=== Potential Duplicates Found ===');
            duplicates.forEach(d => {
                console.log(`  ${d.player1} [${d.positions1}]`);
                console.log(`  ${d.player2} [${d.positions2}]`);
                console.log('---');
            });
            return duplicates;
        } else {
            console.log('No potential duplicates found.');
            return [];
        }
    },

    // ==========================================
    // Draft Assistant Methods
    // ==========================================

    /**
     * Process draft log text
     */
    processDraftLog() {
        const inputEl = document.getElementById('draftLogInput');
        if (!inputEl) return;

        const text = inputEl.value;
        const playerPool = this.currentData.combined || [];

        // Sync team name from input field before processing
        const nameInput = document.getElementById('draftTeamName');
        if (nameInput && nameInput.value.trim()) {
            DraftManager.setTeamName(nameInput.value.trim());
        }

        const result = DraftManager.processDraftLog(text, playerPool);

        if (result.success) {
            this.updateDraftAssistantUI();
            this.updateRankingsTable();
            inputEl.value = '';
            alert(`Draft log processed! ${result.count} players marked as taken.`);
        } else {
            alert('Failed to process draft log: ' + result.message);
        }
    },

    /**
     * Clear draft log
     */
    clearDraftLog() {
        if (confirm('Clear all draft history?')) {
            DraftManager.clearDraft();
            this.updateDraftAssistantUI();
            this.updateRankingsTable();
        }
    },

    /**
     * Sync draft results from Yahoo API
     */
    async syncDraftFromApi() {
        if (typeof YahooApi === 'undefined' || !YahooApi.authenticated || !YahooApi.selectedLeague) {
            alert('Please connect to Yahoo and select a league in the Setup tab first.');
            return;
        }

        const btn = document.getElementById('syncDraftFromApiBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Syncing...';
        }

        try {
            // Fetch draft results
            const picks = await YahooApi.fetchDraftResults(YahooApi.selectedLeague.league_key);
            if (!picks || picks.length === 0) {
                alert('No draft results found. The draft may not have started yet.');
                return;
            }

            // Fetch teams to identify "my team"
            const teams = await YahooApi.fetchTeams(YahooApi.selectedLeague.league_key);
            const myTeam = teams?.find(t => t.is_owned_by_current_login);
            const myTeamKey = myTeam?.team_key || '';

            // Clear existing draft data
            DraftManager.clearDraft();
            if (myTeam) {
                DraftManager.setTeamName(myTeam.name);
            }

            // Process each pick
            const playerPool = this.currentData.combined || [];
            let processedCount = 0;

            for (const pick of picks) {
                const isMyPick = pick.team_key === myTeamKey;
                // Draft results only have player_key, not name/team directly
                // We need to find the player in our pool by player_key or iterate
                // Since Yahoo draft results don't include player names directly,
                // we'll need a reverse lookup. For now, mark by pick order.

                // The player_key format is like "449.p.12345"
                // We can match against our Yahoo-loaded player data
                const yahooPlayerKey = pick.player_key;

                // Find player in our combined data that has a matching Yahoo player key
                // This requires that we stored _yahooPlayerKey during player loading
                let matchedPlayer = null;

                // Try matching by Yahoo player key (if stored)
                if (yahooPlayerKey) {
                    matchedPlayer = playerPool.find(p => p._yahooPlayerKey === yahooPlayerKey);
                }

                if (matchedPlayer) {
                    const uniqueKey = `${matchedPlayer.name}|${matchedPlayer.team}|${matchedPlayer.type}`;

                    if (!DraftManager.state.takenPlayers.has(uniqueKey)) {
                        DraftManager.state.takenPlayers.add(uniqueKey);
                        DraftManager.state.draftLog.push({
                            pick: pick.pick,
                            player: matchedPlayer,
                            isMyTeam: isMyPick,
                            cost: pick.cost || 0,
                        });
                    }

                    if (isMyPick) {
                        const alreadyInTeam = DraftManager.state.myTeam.some(p =>
                            p.name === matchedPlayer.name && p.team === matchedPlayer.team
                        );
                        if (!alreadyInTeam) {
                            DraftManager.state.myTeam.push({ ...matchedPlayer, cost: pick.cost || 0 });
                        }
                    }
                    processedCount++;
                }
            }

            DraftManager.saveState();

            // Update UI
            this.updateDraftAssistantUI();
            this.updateRankingsTable();

            alert(`Draft synced! ${processedCount} of ${picks.length} picks matched.${processedCount < picks.length ? '\n\nSome picks could not be matched. This may happen if player data was not loaded from Yahoo API.' : ''}`);
        } catch (e) {
            console.error('Draft sync failed:', e);
            alert('Draft sync failed: ' + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Sync from Yahoo API';
            }
        }
    },

    /**
     * Render Category Balance Dashboard (Z-Score Bars)
     */
    renderBalanceDashboard() {
        const myTeam = DraftManager.state.myTeam;

        if (!myTeam || myTeam.length === 0) return '';

        const league = Calculator.LEAGUES.active;
        const cats = league
            ? [...league.hitting, ...league.pitching].map(c => c.toUpperCase())
            : ['R', 'HR', 'RBI', 'SB', 'AVG', 'W', 'SV', 'K', 'ERA', 'WHIP'];
            
        // Calculate Total Z-Scores for each cat
        const zTotals = {};
        cats.forEach(c => zTotals[c] = 0);
        
        myTeam.forEach(p => {
            cats.forEach(c => {
                const key = 'z_' + c.toLowerCase();
                if (p[key] !== undefined) {
                    zTotals[c] += parseFloat(p[key]);
                }
            });
        });

        // Generate HTML
        let barsHtml = cats.map(c => {
            const z = zTotals[c];
            const maxRange = 10; // Visual limit for bar (+/- 10 SD)
            const magnitude = Math.min(50, (Math.abs(z) / maxRange) * 50);
            
            const colorClass = z >= 0.5 ? 'bar-pos' : z <= -0.5 ? 'bar-neg' : 'bar-neutral';
            
            // Bar Positioning
            const marginLeft = z >= 0 ? '50%' : `${50 - magnitude}%`;
            
            return `
                <div class="balance-item">
                    <div class="balance-label-row">
                        <span>${c}</span>
                        <span style="font-weight:bold; color:${z>0?'#10b981':z<0?'#ef4444':'#64748b'}">${z > 0 ? '+' : ''}${z.toFixed(1)}</span>
                    </div>
                    <div class="balance-bar-container">
                        <div class="balance-center-line"></div>
                        <div class="balance-bar ${colorClass}" style="width: ${magnitude}%; margin-left: ${marginLeft};"></div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="balance-dashboard">
                <div class="balance-header">⚖️ Category Balance (Total Z)</div>
                <div class="balance-grid">
                    ${barsHtml}
                </div>
            </div>
        `;
    },

    /**
     * Update Draft Assistant UI
     */
    updateDraftAssistantUI() {
        if (typeof DraftManager === 'undefined') return;

        const settings = this.leagueSettings.active;
        const isAuction = settings.draftType === 'auction';
        const scoringType = settings.scoringType || 'roto';

        // Update draft title
        const draftTitle = document.getElementById('draftTitle');
        if (draftTitle) {
            const typeLabel = scoringType === 'head' ? 'H2H' : 'Roto';
            const modeLabel = isAuction ? 'Auction' : 'Snake';
            draftTitle.textContent = `${typeLabel} ${modeLabel} Draft Assistant`;
        }

        // Show/hide auction-only sections
        const bidAssistant = document.getElementById('activeBidAssistant');
        const marketSection = document.getElementById('marketStatusSection');
        if (bidAssistant) bidAssistant.classList.toggle('hidden', !isAuction);
        if (marketSection) marketSection.classList.toggle('hidden', !isAuction);

        const stats = DraftManager.getMyTeamStats();
        const limit = settings.inningsLimit || 1350;
        const ipPct = Math.min(100, (stats.ip / limit) * 100);
        const ipColor = stats.ip > limit ? '#ef4444' : stats.ip > limit * 0.9 ? '#f59e0b' : '#3b82f6';

        // Update Team Name Input if not focused
        const nameInput = document.getElementById('draftTeamName');
        if (nameInput && document.activeElement !== nameInput) {
             nameInput.value = DraftManager.state.myTeamName || 'bluezhin';
        }

        // Update Teams count input if not focused
        const teamCountInput = document.getElementById('draftTeamCount');
        if (teamCountInput && document.activeElement !== teamCountInput) {
            teamCountInput.value = settings.teams || 12;
        }

        // Update My Team Stats display
        const statsContainer = document.getElementById('myTeamStats');
        if (statsContainer) {
            let inflationHtml = '';

            // Inflation tracker (auction only)
            if (isAuction) {
                const inflationStats = DraftManager.calculateInflationStats(
                    this.currentData.combined,
                    settings
                );

                if (inflationStats) {
                    const rate = inflationStats.inflationRate;
                    let bgColor = '#f1f5f9';
                    let textColor = '#334155';
                    let statusText = 'Neutral';

                    if (rate > 1.05) {
                        bgColor = '#fee2e2';
                        textColor = '#b91c1c';
                        statusText = 'Inflated (Expensive)';
                    } else if (rate < 0.95) {
                        bgColor = '#dcfce7';
                        textColor = '#15803d';
                        statusText = 'Deflated (Value)';
                    }

                    inflationHtml = `
                        <div class="stat-group" style="background: ${bgColor}; border: 1px solid ${textColor}; margin-bottom: 20px;">
                            <h4 style="color: ${textColor}; border-bottom: 1px solid ${textColor}40; margin-bottom: 8px; display: flex; justify-content: space-between;">
                                <span>Market Pulse: ${statusText}</span>
                                <span style="font-size: 1.2em; font-weight: bold;">${rate.toFixed(2)}x</span>
                            </h4>
                            <div style="font-size: 0.9rem; display: flex; justify-content: space-between; color: ${textColor};">
                                <div>
                                    <div style="font-size: 0.8em; opacity: 0.8;">Money Left</div>
                                    <div style="font-weight: bold;">${Math.round(inflationStats.moneyRemaining)}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 0.8em; opacity: 0.8;">Value Left</div>
                                    <div style="font-weight: bold;">${Math.round(inflationStats.valueRemaining)}</div>
                                </div>
                            </div>
                            <div style="margin-top: 8px; background: rgba(0,0,0,0.1); height: 4px; border-radius: 2px;">
                                <div style="width: ${Math.min(100, inflationStats.draftProgress * 100)}%; background: ${textColor}; height: 100%;"></div>
                            </div>
                            <div style="text-align: center; font-size: 0.75rem; margin-top: 2px; opacity: 0.7;">Draft Progress: ${Math.round(inflationStats.draftProgress * 100)}%</div>
                        </div>
                    `;
                }
            }

            // Dynamic stats from active league categories
            const league = Calculator.LEAGUES.active;
            const catDisplayNames = {
                'r': 'R', 'hr': 'HR', 'rbi': 'RBI', 'sb': 'SB', 'avg': 'AVG', 'ops': 'OPS',
                'obp': 'OBP', 'w': 'W', 'sv': 'SV', 'k': 'K', 'era': 'ERA', 'whip': 'WHIP',
                'qs': 'QS', 'hld': 'HLD', 'nsvh': 'NSVH'
            };
            const rateStatSet = new Set(['avg', 'ops', 'obp', 'era', 'whip']);

            const formatStat = (cat) => {
                const val = stats[cat] ?? (cat === 'nsvh' ? stats.nsvh : 0);
                const label = catDisplayNames[cat] || cat.toUpperCase();
                const formatted = rateStatSet.has(cat)
                    ? this.formatNumber(val, cat === 'avg' || cat === 'ops' || cat === 'obp' ? 3 : 2,
                        cat === 'avg' || cat === 'ops' || cat === 'obp' ? '.000' : '0.00')
                    : Math.round(val);
                return `<div>${label}: <strong>${formatted}</strong></div>`;
            };

            const hittingStatsHtml = league ? league.hitting.map(formatStat).join('') : '';
            const pitchingStatsHtml = league ? league.pitching.map(formatStat).join('') : '';

            const inningsHtml = `
                <div style="margin-top: 10px; font-size: 0.85rem; color: #64748b;">
                    Innings: <strong>${Math.round(stats.ip)}</strong> / ${limit} (${Math.round(ipPct)}%)
                    <div style="background: #e2e8f0; height: 6px; border-radius: 3px; overflow: hidden; margin-top: 4px;">
                        <div style="background: ${ipColor}; width: ${ipPct}%; height: 100%;"></div>
                    </div>
                </div>
            `;

            const balanceHtml = this.renderBalanceDashboard();

            statsContainer.innerHTML = `
                ${inflationHtml}
                <div class="stat-group">
                    <h4 style="display:flex; justify-content:space-between; align-items:center;">
                        <span>Roster (${stats.count}/23)</span>
                        <span style="font-size:0.85em; background:#ecfdf5; color:#047857; padding:2px 6px; border-radius:4px;">Spent: ${stats.spent}</span>
                    </h4>
                    <p style="margin-top:5px; font-size:0.9em; color:#64748b;">
                        Hitters: <strong>${stats.hitters}</strong> | Pitchers: <strong>${stats.pitchers}</strong>
                    </p>
                </div>

                <div class="stat-group" style="margin-top: 15px;">
                    <h4 style="color:#0284c7; border-bottom:1px solid #e0f2fe; padding-bottom:4px; margin-bottom:8px;">Hitting</h4>
                    <div class="stat-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.9rem;">
                        ${hittingStatsHtml}
                    </div>
                </div>

                <div class="stat-group" style="margin-top: 15px;">
                    <h4 style="color:#dc2626; border-bottom:1px solid #fee2e2; padding-bottom:4px; margin-bottom:8px;">Pitching</h4>
                    <div class="stat-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.9rem;">
                        ${pitchingStatsHtml}
                    </div>
                    ${inningsHtml}
                </div>

                ${balanceHtml}
            `;
        }

        this.updateDraftRecommendations();

        // Scarcity Heatmap (both modes)
        const scarcityContainer = document.getElementById('scarcityHeatmap');
        if (scarcityContainer) {
            const defaultTiers = isAuction ? [30, 20, 15, 10, 5, 3] : [8, 6, 5, 3, 2, 1, 0];
            const allPlayers = this.currentData.combined || [];
            const scarcity = DraftManager.getScarcityData(allPlayers, scoringType, defaultTiers);
            scarcityContainer.innerHTML = this.renderScarcityHeatmap(scarcity, isAuction, defaultTiers);
        }
    },
    /**
     * Update List A: Best Value Recommendations
     */
    updateDraftRecommendations() {
        const container = document.getElementById('draftRecommendations');
        if (!container) return;

        const allPlayers = this.currentData.combined || [];
        const isAuction = this.leagueSettings.active.draftType === 'auction';

        // Market status section (auction only)
        if (isAuction) {
            const marketContainer = document.getElementById('marketRecommendations');
            if (marketContainer) {
                const scoringType = this.leagueSettings.active.scoringType || 'roto';
                const tiers = [30, 20, 15, 10, 5, 3];
                const scarcity = DraftManager.getScarcityData(allPlayers, scoringType, tiers);
                marketContainer.innerHTML = this.renderScarcityHeatmap(scarcity, true, tiers);
            }
        }

        const available = allPlayers.filter(p => !DraftManager.isPlayerTaken(p));
        
        if (available.length === 0) {
            container.innerHTML = '<p>No players available.</p>';
            return;
        }

        // Score players based on "Best Available"
        const scoredPlayers = available.map(p => ({
            ...p,
            recScore: this.getRecommendationScore(p)
        }));

        // Sort by Recommendation Score
        scoredPlayers.sort((a, b) => b.recScore - a.recScore);
        
        // Take Top 5
        const top5 = scoredPlayers.slice(0, 5);
        
        const uvSet = this.getUndervaluedSet();
        container.innerHTML = top5.map((p, i) => {
            const isPitcher = p.type === 'pitcher';
            let statsHtml = '';

            if (isPitcher) {
                statsHtml = `ERA: ${this.formatNumber(p.era)} | WHIP: ${this.formatNumber(p.whip)} | K: ${p.k}`;
            } else {
                statsHtml = `AVG: ${this.formatNumber(p.avg, 3, '.000')} | HR: ${p.hr} | SB: ${p.sb}`;
            }

            const valDisplay = isAuction ? `$${p.dollarValue || 0}` : `Z: ${this.formatNumber(p.zTotal, 1)}`;
            const uvKey = p.name + '|' + (p.playerType || '');
            const uvTag = uvSet.has(uvKey) ? '<span style="color:#7c3aed; font-weight:bold; font-size:0.7rem; border:1px solid #7c3aed; padding:0 4px; border-radius:3px;">UV</span>' : '';

            return `
                <div class="recommendation-card rank-${i+1}">
                    <div class="rec-header">
                        <span class="rec-rank">#${i+1}</span>
                        <span class="rec-name" style="font-size: 1rem;">${p.name}</span>
                        ${p.injuryStatus ? `<span class="injury-badge injury-${p.injuryStatus.startsWith('IL') ? 'il' : 'dtd'}">${p.injuryStatus}</span>` : ''}
                        ${uvTag}
                        <span class="rec-pos" style="font-size: 0.75rem;">${p.positionString}</span>
                    </div>
                    <div class="rec-team">${p.team}</div>
                    <div class="rec-stats" style="font-size: 0.8rem;">${statsHtml}</div>
                    <div class="rec-value">${valDisplay}</div>
                </div>
            `;
        }).join('');

        this.updateSmartRecommendations();
    },

    /**
     * Render Scarcity Heatmap
     * @param {Object} scarcity - Scarcity data from DraftManager
     * @param {boolean} isAuction - True for auction (dollar tiers), false for snake (Z-score tiers)
     * @param {Array} tiers - Tier thresholds
     */
    renderScarcityHeatmap(scarcity, isAuction = false, tiers = null) {
        if (!scarcity) return '<p>No data available</p>';

        // Positions depend on scoring type (roto includes CI/MI slots)
        const scoringType = this.leagueSettings.active.scoringType || 'roto';
        const positions = scoringType === 'head'
            ? ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'SP', 'RP']
            : ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'LF', 'CF', 'RF', 'OF', 'SP', 'RP'];

        let activeTiers = tiers;
        if (!activeTiers) {
            activeTiers = isAuction
                ? [30, 20, 15, 10, 5, 3]
                : [8, 6, 5, 3, 2, 1, 0];
        }

        const headers = activeTiers.map(t => isAuction ? `$${t}+` : `Z>${t}`);
        
        // Helper to get color based on count
        const getCellColor = (count) => {
            if (count <= 1) return '#fecaca'; // Red (Critical: 0-1 left)
            if (count <= 4) return '#fed7aa'; // Orange (Low: 2-4 left)
            if (count <= 9) return '#fef08a'; // Yellow (Warning: 5-9 left)
            return '#dcfce7'; // Green (Safe)
        };
        
        // Helper to format cell
        const renderCell = (count) => {
            const bg = getCellColor(count);
            const opacity = count === 0 ? '0.3' : '1';
            return `<td style="background:${bg}; opacity:${opacity}; padding: 4px 2px; text-align: center; border: 1px solid #e2e8f0; font-size: 0.85em;">
                <span style="font-weight:bold; color: #334155;">${count}</span>
            </td>`;
        };

        let rows = positions.map(pos => {
            const data = scarcity[pos];
            if (!data) return '';
            
            // Generate cells for all tiers dynamically
            const cells = activeTiers.map((_, i) => renderCell(data['t' + (i+1)] || 0)).join('');

            return `
                <tr>
                    <td style="font-weight:bold; padding:6px; border-bottom:1px solid #e2e8f0; font-size: 0.9em;">${pos}</td>
                    ${cells}
                </tr>
            `;
        }).join('');

        return `
            <div class="scarcity-panel" style="background:white; padding:10px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <h4 style="margin-top:0; color:#334155; border-bottom:2px solid #e2e8f0; padding-bottom:8px; margin-bottom:10px; font-size: 1rem;">
                    Positional Scarcity (${isAuction ? '$ Value' : 'Z-Score'})
                </h4>
                <table style="width:100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background:#f8fafc; color:#64748b; font-size:0.7em;">
                            <th style="text-align:left; padding:6px;">Pos</th>
                            ${headers.map(h => `<th style="padding:4px;">${h}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
                <div style="margin-top:8px; font-size:0.72em; color:#94a3b8; text-align:center; line-height: 1.2;">
                    *Counts are cumulative.<br>
                    Red < 2 | Orange < 5 | Yellow < 10
                </div>
            </div>
        `;
    },

    /**
     * Update List B: Smart Team Needs Recommendations
     */
    updateSmartRecommendations() {
        const container = document.getElementById('smartRecommendations');
        if (!container) return;

        const allPlayers = this.currentData.combined || [];
        const available = allPlayers.filter(p => !DraftManager.isPlayerTaken(p));
        
        if (available.length === 0) {
            container.innerHTML = '<p>No players available.</p>';
            return;
        }

        // Prepare scarcity cache for batch need scoring
        this._needScoreTick = (this._needScoreTick || 0) + 1;
        this._allPlayersForNeed = allPlayers;

        // Score with "Need Factor"
        const scoredPlayers = available.map(p => ({
            ...p,
            smartScore: this.getTeamNeedScore(p)
        }));

        scoredPlayers.sort((a, b) => b.smartScore - a.smartScore);
        
        const top5 = scoredPlayers.slice(0, 5);
        
        const isAuction = this.leagueSettings.active.draftType === 'auction';
        const league = Calculator.LEAGUES.active;

        const uvSet2 = this.getUndervaluedSet();
        container.innerHTML = top5.map((p, i) => {
            const isPitcher = p.type === 'pitcher';
            const categories = isPitcher ? league.pitching : league.hitting;
            // Show first 2-3 key stats from active categories
            const statsArr = categories.slice(0, 3).map(cat => {
                const val = Calculator.getStatValue(p, cat);
                const isRate = ['avg', 'ops', 'era', 'whip'].includes(cat);
                const formatted = isRate ? this.formatNumber(val, 3, '.000') : Math.round(val || 0);
                return `${cat.toUpperCase()}: ${formatted}`;
            });
            const statsHtml = statsArr.join(' | ');

            // Generate tags based on why they were recommended
            let tags = [];
            if (p.isNeedFit) tags.push('<span style="color: #ef4444; font-weight: bold; font-size: 0.7rem; border: 1px solid #ef4444; padding: 0 4px; border-radius: 3px;">NEED</span>');
            if (p.isScarcityPick) tags.push('<span style="color: #f59e0b; font-weight: bold; font-size: 0.7rem; border: 1px solid #f59e0b; padding: 0 4px; border-radius: 3px;">SCARCE</span>');
            const uvKey2 = p.name + '|' + (p.playerType || '');
            if (uvSet2.has(uvKey2)) tags.push('<span style="color:#7c3aed; font-weight:bold; font-size:0.7rem; border:1px solid #7c3aed; padding:0 4px; border-radius:3px;">UV</span>');

            return `
                <div class="recommendation-card" style="border-left-color: #0284c7;">
                    <div class="rec-header">
                        <span class="rec-rank" style="color: #0284c7;">#${i+1}</span>
                        <span class="rec-name" style="font-size: 1rem;">${p.name}</span>
                        ${p.injuryStatus ? `<span class="injury-badge injury-${p.injuryStatus.startsWith('IL') ? 'il' : 'dtd'}">${p.injuryStatus}</span>` : ''}
                        ${tags.join(' ')}
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span class="rec-pos" style="font-size: 0.75rem; background: #e0f2fe; color: #0284c7;">${p.positionString}</span>
                        <span class="rec-team" style="margin: 0;">${p.team}</span>
                    </div>
                    <div class="rec-stats" style="font-size: 0.8rem; background: #f0f9ff; color: #0c4a6e;">${statsHtml}</div>
                    <div class="rec-value" style="color: #0284c7;">
                        ${isAuction ? `$${p.dollarValue || 0}` : `Z: ${this.formatNumber(p.zTotal, 1)}`}
                        | Need: ${this.formatNumber(p.smartScore, 1)}
                    </div>
                </div>
            `;
        }).join('');
    },

    /**
     * Calculate dynamic position caps from rosterComposition
     */
    calculatePositionCaps() {
        const composition = this.leagueSettings.active.rosterComposition || [];
        const caps = { 'C': 0, '1B': 0, '2B': 0, '3B': 0, 'SS': 0, 'OF': 0, 'SP': 0, 'RP': 0 };

        let bnCount = 0;
        composition.forEach(slot => {
            switch (slot) {
                case 'C': caps['C']++; break;
                case '1B': caps['1B']++; break;
                case '2B': caps['2B']++; break;
                case '3B': caps['3B']++; break;
                case 'SS': caps['SS']++; break;
                case 'LF': case 'CF': case 'RF': case 'OF': caps['OF']++; break;
                case 'CI': caps['1B']++; caps['3B']++; break;
                case 'MI': caps['2B']++; caps['SS']++; break;
                case 'Util': // Counts toward all hitter positions
                    ['C','1B','2B','3B','SS','OF'].forEach(p => caps[p]++);
                    break;
                case 'SP': caps['SP']++; break;
                case 'RP': caps['RP']++; break;
                case 'P': caps['SP']++; caps['RP']++; break;
                case 'BN': bnCount++; break;
            }
        });

        // Distribute BN slots 60/40 hitter/pitcher
        const bnHitter = Math.round(bnCount * 0.6);
        const bnPitcher = bnCount - bnHitter;
        ['C','1B','2B','3B','SS','OF'].forEach(p => caps[p] += Math.round(bnHitter / 6));
        caps['SP'] += Math.round(bnPitcher * 0.6);
        caps['RP'] += bnPitcher - Math.round(bnPitcher * 0.6);

        return caps;
    },

    /**
     * Calculate category need multiplier based on team weaknesses
     * Uses categoryWeights to respect user preferences (weight=0 means ignore)
     */
    calculateCategoryNeedMultiplier(player, myTeam) {
        const league = Calculator.LEAGUES.active;
        if (!league || myTeam.length === 0) return 1.0;

        const weights = this.leagueSettings.active.categoryWeights || {};
        const categories = player.type === 'hitter' ? league.hitting : league.pitching;

        // Sum z-scores for each category across my team
        const teamCatZ = {};
        categories.forEach(cat => {
            const key = 'z_' + cat;
            teamCatZ[cat] = myTeam.reduce((sum, p) => sum + (parseFloat(p[key]) || 0), 0);
        });

        // Filter to categories with weight > 0
        const activeCats = categories.filter(cat => (weights[cat] ?? 1.0) > 0);
        if (activeCats.length === 0) return 1.0;

        const zValues = activeCats.map(cat => teamCatZ[cat]);
        const maxZ = Math.max(...zValues);
        const minZ = Math.min(...zValues);
        const range = maxZ - minZ;

        if (range < 0.5) return 1.0; // Team is balanced enough

        // Calculate need weights: weaker categories get higher weights
        const needWeights = {};
        activeCats.forEach(cat => {
            const catWeight = weights[cat] ?? 1.0;
            needWeights[cat] = (1 + 0.5 * (maxZ - teamCatZ[cat]) / range) * catWeight;
        });

        // Score player's contribution to needed categories
        let weightedScore = 0;
        let baseScore = 0;
        activeCats.forEach(cat => {
            const pZ = parseFloat(player['z_' + cat]) || 0;
            weightedScore += pZ * needWeights[cat];
            baseScore += pZ;
        });

        if (Math.abs(baseScore) < 0.1) return 1.0;

        const multiplier = Math.max(0.8, Math.min(1.5, weightedScore / baseScore));
        if (multiplier > 1.2) player.isNeedFit = true;

        return multiplier;
    },

    /**
     * Calculate Team Need Score (Smart Logic)
     */
    getTeamNeedScore(player) {
        // Base score from weighted Z-Total
        let score = this.getRecommendationScore(player);

        const myTeam = DraftManager.state.myTeam || [];

        player.isNeedFit = false;
        player.isScarcityPick = false;

        // --- 1. ROSTER BALANCE (Position Need) ---
        const caps = this.calculatePositionCaps();
        const posCounts = {
            'C': 0, '1B': 0, '2B': 0, '3B': 0, 'SS': 0, 'OF': 0,
            'SP': 0, 'RP': 0
        };

        myTeam.forEach(p => {
            if (p.type === 'pitcher') {
                if (p.isPitcherSP) posCounts.SP++;
                if (p.isPitcherRP) posCounts.RP++;
                return;
            }

            let posList = [];
            if (Array.isArray(p.positions)) posList = p.positions;
            else if (typeof p.positions === 'string') posList = p.positions.split(/,|\||\//).map(s => s.trim());
            else if (typeof p.positionString === 'string') posList = p.positionString.split(/,|\||\//).map(s => s.trim());

            // Count player toward their most-needed position (lowest fill ratio)
            const validPositions = posList.filter(pos => posCounts[pos] !== undefined);
            if (validPositions.length > 0) {
                let bestPos = validPositions[0];
                let bestRatio = Infinity;
                validPositions.forEach(pos => {
                    const cap = caps[pos] || 1;
                    const ratio = posCounts[pos] / cap;
                    if (ratio < bestRatio) {
                        bestRatio = ratio;
                        bestPos = pos;
                    }
                });
                posCounts[bestPos]++;
            }
        });

        let posMultiplier = 1.0;

        // Cache scarcity data per call batch (avoid recalculating per player)
        if (!this._scarcityCache || this._scarcityCacheTick !== this._needScoreTick) {
            const scoringType = (this.leagueSettings.active.scoringType || 'roto').startsWith('head') ? 'head' : 'roto';
            this._scarcityCache = DraftManager.getScarcityData(this._allPlayersForNeed || [], scoringType);
            this._scarcityCacheTick = this._needScoreTick;
        }
        const scarcity = this._scarcityCache;

        if (player.type === 'hitter') {
            const positions = player.positions || [];
            let isSaturated = true;
            let isHighNeed = false;
            let hasEmptyPosition = false;
            let hasScarcePosAvailable = false;

            for (const pos of positions) {
                if (posCounts[pos] < caps[pos]) isSaturated = false;
                if (posCounts[pos] === 0 && caps[pos] > 0) {
                    isHighNeed = true;
                    hasEmptyPosition = true;

                    // Check if this position is scarce (<=5 remaining at tier 1)
                    if (scarcity[pos] && scarcity[pos].t1 !== undefined && scarcity[pos].t1 <= 5) {
                        hasScarcePosAvailable = true;
                    }
                }
            }

            if (hasEmptyPosition && hasScarcePosAvailable) {
                posMultiplier = 1.6;
                player.isNeedFit = true;
                player.isScarcityPick = true;
            } else if (hasEmptyPosition) {
                posMultiplier = 1.4;
                player.isNeedFit = true;
            } else if (isHighNeed) {
                posMultiplier = 1.2;
                player.isNeedFit = true;
            } else if (isSaturated) {
                posMultiplier = 0.8;
            }
        } else {
            // Pitcher position + innings limit check
            if (player.isPitcherSP && posCounts.SP >= caps.SP) posMultiplier = 0.8;
            if (player.isPitcherRP && posCounts.RP >= caps.RP) posMultiplier = 0.8;

            const stats = DraftManager.getMyTeamStats();
            const limit = this.leagueSettings.active.inningsLimit || 1400;
            if (stats.ip > limit * 0.95 && player.isPitcherSP) {
                posMultiplier = 0.5;
            }
        }

        // Scarcity detection for positions not yet on team
        if (!player.isScarcityPick && scarcity) {
            const posList = player.positions || [];
            for (const pos of posList) {
                if (scarcity[pos] && scarcity[pos].t1 !== undefined && scarcity[pos].t1 <= 3) {
                    player.isScarcityPick = true;
                    if (posMultiplier < 1.15) posMultiplier = 1.15;
                    break;
                }
            }
        }

        score *= posMultiplier;

        // --- 2. CATEGORY NEED (Dynamic Balancing) ---
        score *= this.calculateCategoryNeedMultiplier(player, myTeam);

        return score;
    },

    /**
     * Calculate Recommendation Score
     * Applies category weights to z-score calculation
     */
    getRecommendationScore(player) {
        const league = Calculator.LEAGUES.active;
        const weights = this.leagueSettings.active.categoryWeights || {};

        // Recalculate weighted zTotal based on category weights
        let score = 0;
        if (league) {
            const categories = player.type === 'hitter' ? league.hitting : league.pitching;
            categories.forEach(cat => {
                const w = weights[cat] ?? 1.0;
                score += (parseFloat(player['z_' + cat]) || 0) * w;
            });
        } else {
            score = parseFloat(player.zTotal) || 0;
        }

        return score;
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
