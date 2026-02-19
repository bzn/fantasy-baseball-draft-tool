/**
 * Fantasy Baseball Draft Tool - Main Application
 */

const App = {
    currentData: {
        hitters: null,      // Original FanGraphs hitter projections
        pitchers: null,     // Original FanGraphs pitcher projections
        merged: null,       // Merged data (FanGraphs + Yahoo positions)
        combined: {
            roto5x5: [],
            h2h12: []
        }
    },

    // Sort state
    sortState: {
        column: 'dollarValue',
        direction: 'desc' // 'asc' or 'desc'
    },

    // Default league settings
    leagueSettings: {
        roto5x5: {
            name: 'Roto 5x5',
            teams: 16,
            draftType: 'snake',
            budget: 260,
            inningsLimit: 1350,
            rosterHitters: 12, // Active hitters (C, 1B, 2B, 3B, SS, CI, MI, LF, CF, RF, OF, Util)
            rosterPitchers: 8,  // Active pitchers (3 SP, 2 RP, 3 P)
            rosterComposition: ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'LF', 'CF', 'RF', 'OF', 'Util', 'SP', 'SP', 'SP', 'RP', 'RP', 'P', 'P', 'P', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IL', 'IL', 'IL', 'NA'],
            categoryWeights: {
                'r': 1.0, 'hr': 1.0, 'rbi': 1.0, 'sb': 1.0, 'avg': 1.0,
                'w': 1.0, 'sv': 1.0, 'k': 1.0, 'era': 1.0, 'whip': 1.0
            }
        },
        h2h12: {
            name: 'H2H 6x6',
            teams: 16,
            draftType: 'auction',
            budget: 260,
            hitterPitcherSplit: '60/40', // 60% hitters, 40% pitchers
            rosterHitters: 9,   // Active hitters (C, 1B, 2B, 3B, SS, LF, CF, RF, Util)
            rosterPitchers: 9,  // Active pitchers (3 SP, 3 RP, 3 P)
            rosterComposition: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'Util', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'P', 'P', 'P', 'BN', 'BN', 'BN', 'BN', 'BN', 'IL', 'IL', 'IL', 'NA'],
            categoryWeights: {
                'r': 1.0, 'hr': 1.0, 'rbi': 1.0, 'sb': 0.7, 'avg': 1.0, 'ops': 1.0,
                'w': 0.7, 'sv': 1.0, 'k': 1.0, 'era': 1.0, 'whip': 1.0, 'qs': 1.0, 'nsvh': 1.0
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
        this.updateDataInfo();
        this.updateSetupStatus();
        this.applySettingsToUI();
        this.updateDraftAssistantUI('roto5x5');
        this.updateDraftAssistantUI('h2h12');

        // Restore tab state from saved league settings
        const savedLeague = localStorage.getItem('yahoo_league_settings');
        if (savedLeague) {
            try {
                const parsed = JSON.parse(savedLeague);
                if (parsed.leagueKey) {
                    this.updateTabsForLeague(parsed.leagueKey);
                }
            } catch (e) { /* ignore parse errors */ }
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

        // Roto 5x5 table events
        document.getElementById('rotoPositionFilter').addEventListener('change', () => this.updateRotoTable());
        document.getElementById('rotoSearchPlayer').addEventListener('input', (e) => this.searchPlayers('roto', e.target.value));
        document.getElementById('rotoHideDrafted').addEventListener('change', () => this.updateRotoTable());

        // Draft Assistant events (ROTO)
        document.getElementById('processDraftLogBtn')?.addEventListener('click', () => this.processDraftLog('roto5x5'));
        document.getElementById('clearDraftLogBtn')?.addEventListener('click', () => this.clearDraftLog('roto5x5'));
        document.getElementById('syncDraftFromApiBtn')?.addEventListener('click', () => this.syncDraftFromApi('roto5x5'));
        document.getElementById('draftTeamName')?.addEventListener('change', (e) => {
            if (typeof DraftManager !== 'undefined') {
                DraftManager.setTeamName(e.target.value, 'roto5x5');
                this.updateDraftAssistantUI('roto5x5');
            }
        });
        document.getElementById('draftTeamCount')?.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (count >= 4 && count <= 30) {
                this.leagueSettings.roto5x5.teams = count;
                localStorage.setItem('fantasy_settings', JSON.stringify(this.leagueSettings));
                this.calculateValues();
            }
        });
        // Draft Assistant Checkbox (ROTO)
        document.getElementById('hideDraftedPlayers')?.addEventListener('change', (e) => {
             this.updateDraftAssistantUI('roto5x5');
        });

        // Draft Assistant events (H2H)
        document.getElementById('h2hProcessDraftLogBtn')?.addEventListener('click', () => this.processDraftLog('h2h12'));
        document.getElementById('h2hClearDraftLogBtn')?.addEventListener('click', () => this.clearDraftLog('h2h12'));
        document.getElementById('h2hSyncDraftFromApiBtn')?.addEventListener('click', () => this.syncDraftFromApi('h2h12'));
        document.getElementById('h2hDraftTeamName')?.addEventListener('change', (e) => {
            if (typeof DraftManager !== 'undefined') {
                DraftManager.setTeamName(e.target.value, 'h2h12');
                this.updateDraftAssistantUI('h2h12');
            }
        });
        document.getElementById('h2hDraftTeamCount')?.addEventListener('change', (e) => {
            const count = parseInt(e.target.value);
            if (count >= 4 && count <= 30) {
                this.leagueSettings.h2h12.teams = count;
                localStorage.setItem('fantasy_settings', JSON.stringify(this.leagueSettings));
                this.calculateValues();
            }
        });
        // Draft Assistant Checkbox (H2H)
        document.getElementById('h2hHideDraftedPlayers')?.addEventListener('change', (e) => {
             this.updateDraftAssistantUI('h2h12');
        });
        
        // H2H 12-Cat table events
        document.getElementById('h2hPositionFilter').addEventListener('change', () => this.updateH2HTable());
        document.getElementById('h2hSearchPlayer').addEventListener('input', (e) => this.searchPlayers('h2h', e.target.value));
        document.getElementById('h2hHideDrafted').addEventListener('change', () => this.updateH2HTable());

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
        const bidInput = document.getElementById('h2hBidSearchInput');
        if (bidInput) {
            bidInput.addEventListener('input', (e) => this.searchBidPlayer(e.target.value));
            
            // Hide results on outside click
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.bid-search-box')) {
                    document.getElementById('h2hBidSearchResults')?.classList.add('hidden');
                }
            });
        }
    },

    /**
     * Search for player in Active Bidder module
     */
    searchBidPlayer(query) {
        const resultsDiv = document.getElementById('h2hBidSearchResults');
        if (!query || query.length < 2) {
            resultsDiv.classList.add('hidden');
            return;
        }

        const players = this.currentData.combined.h2h12 || [];
        const matches = players
            .filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8);

        if (matches.length === 0) {
            resultsDiv.classList.add('hidden');
            return;
        }

        resultsDiv.innerHTML = matches.map(p => {
            const isTaken = DraftManager.isPlayerTaken(p, 'h2h12');
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
        const input = document.getElementById('h2hBidSearchInput');
        const resultsDiv = document.getElementById('h2hBidSearchResults');
        const contentDiv = document.getElementById('h2hBidAnalysisContent');
        
        input.value = player.name;
        resultsDiv.classList.add('hidden');
        contentDiv.classList.remove('hidden');

        // Calculations
        const stats = DraftManager.getMyTeamStats('h2h12');
        const settings = this.leagueSettings.h2h12;
        const totalBudget = settings.budget || 260;
        const rosterSize = (settings.rosterHitters || 14) + (settings.rosterPitchers || 9); // Total slots
        const slotsFilled = stats.count;
        const slotsLeft = Math.max(0, rosterSize - slotsFilled);
        const moneySpent = stats.spent;
        const moneyLeft = totalBudget - moneySpent;
        
        // Max Bid (Mathematical Hard Cap): Money Left - (Slots Left - 1) * $1
        const maxBid = Math.max(0, moneyLeft - (Math.max(0, slotsLeft - 1)));

        // Inflation
        const inflationStats = DraftManager.calculateInflationStats(this.currentData.combined.h2h12, settings);
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
        const isTaken = DraftManager.isPlayerTaken(player, 'h2h12');
        const warningHtml = isTaken ? `
            <div style="background: #fee2e2; border: 1px solid #ef4444; color: #b91c1c; padding: 8px; border-radius: 4px; margin-bottom: 12px; text-align: center; font-weight: bold; font-size: 0.9em;">
                ⚠️ PLAYER ALREADY DRAFTED
            </div>
        ` : '';

        // Build Full Stats Grid (H2H 6x6)
        let statsHtml = '';
        if (player.type === 'hitter') {
            const cats = [
                { label: 'R', val: Math.round(player.r || 0), z: player.z_r },
                { label: 'HR', val: Math.round(player.hr || 0), z: player.z_hr },
                { label: 'RBI', val: Math.round(player.rbi || 0), z: player.z_rbi },
                { label: 'SB', val: Math.round(player.sb || 0), z: player.z_sb },
                { label: 'AVG', val: this.formatNumber(player.avg, 3, '.000'), z: player.z_avg },
                { label: 'OPS', val: this.formatNumber(player.ops, 3, '.000'), z: player.z_ops }
            ];
            
            statsHtml = cats.map(c => `
                <div style="text-align: center; padding: 6px; background: #f8fafc; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 0.7em; color: #64748b; margin-bottom:2px;">${c.label}</div>
                    <div style="font-weight: bold; font-size: 1rem; color: ${c.z > 0.5 ? '#16a34a' : c.z < -0.5 ? '#dc2626' : '#334155'};">
                        ${c.val}
                    </div>
                </div>
            `).join('');
        } else {
            const cats = [
                { label: 'W', val: Math.round(player.w || 0), z: player.z_w },
                { label: 'K', val: Math.round(player.k || 0), z: player.z_k },
                { label: 'ERA', val: this.formatNumber(player.era, 2), z: player.z_era },
                { label: 'WHIP', val: this.formatNumber(player.whip, 2), z: player.z_whip },
                { label: 'QS', val: Math.round(player.qs || 0), z: player.z_qs },
                { label: 'NSVH', val: Math.round(player.nsvh || 0), z: player.z_nsvh }
            ];
            
            statsHtml = cats.map(c => `
                <div style="text-align: center; padding: 6px; background: #f8fafc; border-radius: 4px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 0.7em; color: #64748b; margin-bottom:2px;">${c.label}</div>
                    <div style="font-weight: bold; font-size: 1rem; color: ${c.z > 0.5 ? '#16a34a' : c.z < -0.5 ? '#dc2626' : '#334155'};">
                        ${c.val}
                    </div>
                </div>
            `).join('');
        }

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
            // Merge saved settings over defaults to preserve hardcoded properties
            // (rosterHitters, rosterPitchers, rosterComposition, etc.)
            const defaults = this.leagueSettings;
            this.leagueSettings = {
                ...defaults,
                ...saved,
                roto5x5: { ...defaults.roto5x5, ...saved.roto5x5 },
                h2h12: { ...defaults.h2h12, ...saved.h2h12 }
            };
        }

        // Always use hardcoded Scarcity Tiers (not user-configurable)
        this.leagueSettings.scarcityTiers = {
            h2h12: [30, 20, 15, 10, 5, 3],
            roto5x5: [8, 6, 5, 3, 2, 1, 0]
        };
    },

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        // Read split and weights from Step 4 UI
        const leagueKey = this._step4LeagueKey;
        if (!leagueKey) return;

        const prev = this.leagueSettings[leagueKey];

        // Read hitter/pitcher split if auction
        const splitEl = document.getElementById('step4HitterPitcherSplit');
        if (splitEl && prev.draftType === 'auction') {
            prev.hitterPitcherSplit = splitEl.value;
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
                prev.categoryWeights = weights;
            }
        }

        localStorage.setItem('fantasy_settings', JSON.stringify(this.leagueSettings));
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

        // Determine which league was synced by checking if Yahoo API has current settings
        let leagueKey = null;
        if (typeof YahooApi !== 'undefined' && YahooApi._currentSettings) {
            leagueKey = YahooApi._currentSettings.scoring_type === 'head' ? 'h2h12' : 'roto5x5';
        } else {
            // Fallback: check if settings were previously saved to localStorage
            const stored = localStorage.getItem('fantasy_settings');
            if (stored) {
                const saved = JSON.parse(stored);
                for (const key of ['h2h12', 'roto5x5']) {
                    if (saved[key]?.categoryWeights && Calculator.LEAGUES[key]) {
                        leagueKey = key;
                        break;
                    }
                }
            }
        }

        if (!leagueKey) {
            // No league synced yet
            if (noSyncMsg) noSyncMsg.classList.remove('hidden');
            if (splitRow) splitRow.classList.add('hidden');
            if (saveRow) saveRow.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        this._step4LeagueKey = leagueKey;
        if (noSyncMsg) noSyncMsg.classList.add('hidden');
        if (saveRow) saveRow.classList.remove('hidden');

        const settings = this.leagueSettings[leagueKey];
        const league = Calculator.LEAGUES[leagueKey];
        if (!league) return;

        // Show split selector for auction leagues
        if (splitRow) {
            if (settings.draftType === 'auction') {
                splitRow.classList.remove('hidden');
                const splitEl = document.getElementById('step4HitterPitcherSplit');
                if (splitEl) splitEl.value = settings.hitterPitcherSplit || '60/40';
            } else {
                splitRow.classList.add('hidden');
            }
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
        } else if (tabId === 'roto') {
            this.updateRotoTable();
        } else if (tabId === 'h2h') {
            this.updateH2HTable();
        } else if (tabId === 'draft') {
            this.updateDraftAssistantUI('roto5x5');
        } else if (tabId === 'h2h-draft') {
            this.updateDraftAssistantUI('h2h12');
        }
    },

    /**
     * Update tab buttons based on loaded league type
     * Maps Rankings/Draft tabs to the correct section for the league
     */
    updateTabsForLeague(leagueKey) {
        const rankingsBtn = document.getElementById('tabRankings');
        const draftBtn = document.getElementById('tabDraft');
        if (!rankingsBtn || !draftBtn) return;

        if (leagueKey === 'h2h12') {
            rankingsBtn.dataset.tab = 'h2h';
            draftBtn.dataset.tab = 'h2h-draft';
        } else {
            rankingsBtn.dataset.tab = 'roto';
            draftBtn.dataset.tab = 'draft';
        }

        // Enable the tabs
        rankingsBtn.disabled = false;
        draftBtn.disabled = false;
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

        // Update player tabs visibility (both Roto and H2H)
        const hasData = hittersCount > 0 || pitchersCount > 0 || this.currentData.merged;

        // Roto 5x5 tab
        document.getElementById('rotoNoDataMsg').classList.toggle('hidden', hasData);
        document.getElementById('rotoPlayerTableContainer').classList.toggle('hidden', !hasData);

        // H2H 12-Cat tab
        document.getElementById('h2hNoDataMsg').classList.toggle('hidden', hasData);
        document.getElementById('h2hPlayerTableContainer').classList.toggle('hidden', !hasData);
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

        // Calculate for both leagues
        ['roto5x5', 'h2h12'].forEach(leagueType => {
            let allPlayers = [];
            const leagueSetting = this.leagueSettings[leagueType];

            // Determine Z-score baseline pool size
            // Use 2× drafted count (active + bench) so Z=0 ≈ draftable boundary
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
                // Deep copy to avoid mutation
                const hittersCopy = hittersToUse.map(p => ({...p}));
                const hittersWithZ = Calculator.calculateZScores(
                    hittersCopy,
                    leagueType,
                    'hitter',
                    leagueSetting.categoryWeights,
                    baselineHitters // 2× drafted count for intuitive Z values
                );
                allPlayers = allPlayers.concat(hittersWithZ);
            }

            if (pitchersToUse) {
                const pitchersCopy = pitchersToUse.map(p => ({...p}));
                const pitchersWithZ = Calculator.calculateZScores(
                    pitchersCopy,
                    leagueType,
                    'pitcher',
                    leagueSetting.categoryWeights,
                    baselinePitchers // 2× drafted count for intuitive Z values
                );
                allPlayers = allPlayers.concat(pitchersWithZ);
            }

            // Calculate dollar values if it's an auction draft
            if (leagueSetting.draftType === 'auction') {
                const teamCount = leagueSetting.teams || 12;
                const budgetPerTeam = leagueSetting.budget || 260;
                const totalLeagueBudget = teamCount * budgetPerTeam;
                
                // Parse split
                const split = leagueSetting.hitterPitcherSplit || '60/40';
                const [hitterPctStr, pitcherPctStr] = split.split('/');
                const hitterPct = parseInt(hitterPctStr) / 100;
                const pitcherPct = parseInt(pitcherPctStr) / 100;

                const hitterBudgetPool = totalLeagueBudget * hitterPct;
                const pitcherBudgetPool = totalLeagueBudget * pitcherPct;

                // Separate players by type
                const hitters = allPlayers.filter(p => p.type === 'hitter');
                const pitchers = allPlayers.filter(p => p.type === 'pitcher');

                // For dollar values, use total draftable slots (active + bench).
                // Bench is split by active roster ratio (not budget ratio),
                // because budget split determines spending, not draft composition.
                const activeH = leagueSetting.rosterHitters || 14;
                const activeP = leagueSetting.rosterPitchers || 9;
                const comp = leagueSetting.rosterComposition || [];
                const benchSlots = comp.filter(s => s === 'BN').length;
                const activeRatioH = activeH / (activeH + activeP);
                const benchH = Math.round(benchSlots * activeRatioH);
                const benchP = benchSlots - benchH;
                const draftedHitters = activeH + benchH;
                const draftedPitchers = activeP + benchP;

                // Calculate values separately
                const valuedHitters = Calculator.calculateDollarValues(
                    hitters,
                    hitterBudgetPool,
                    teamCount,
                    draftedHitters
                );

                const valuedPitchers = Calculator.calculateDollarValues(
                    pitchers,
                    pitcherBudgetPool,
                    teamCount,
                    draftedPitchers
                );

                // Merge back
                allPlayers = [...valuedHitters, ...valuedPitchers];
            } else {
                // Snake draft logic (simple ranking by Z-total) - dollar value 0
                allPlayers = allPlayers.map(p => ({...p, dollarValue: 0}));
            }

            allPlayers = Calculator.rankPlayers(allPlayers);
            this.currentData.combined[leagueType] = allPlayers;
        });

        console.log('Calculation complete. Updating tables...');
        // Update both Roto and H2H tables
        this.updateRotoTable();
        this.updateH2HTable();
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
     * Update Roto 5x5 player table
     */
    updateRotoTable() {
        this.updatePlayerTable('roto5x5', 'roto');
    },

    /**
     * Update H2H 12-Cat player table
     */
    updateH2HTable() {
        this.updatePlayerTable('h2h12', 'h2h');
    },

    /**
     * Update player table display (unified method for both leagues)
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     * @param {string} prefix - 'roto' or 'h2h' (for element IDs)
     */
    updatePlayerTable(leagueType, prefix) {
        const leagueData = this.currentData.combined[leagueType];

        console.log('Updating player table for:', leagueType);
        console.log('League data:', leagueData?.length || 0, 'players');

        const noDataMsg = document.getElementById(`${prefix}NoDataMsg`);
        const tableContainer = document.getElementById(`${prefix}PlayerTableContainer`);
        const tbody = document.querySelector(`#${prefix}PlayerTable tbody`);
        const headerRow = document.querySelector(`#${prefix}PlayerTable thead tr`);

        if (!leagueData || leagueData.length === 0) {
            console.log('No league data found. Showing no data message.');
            noDataMsg.classList.remove('hidden');
            tableContainer.classList.add('hidden');
            return;
        }

        const leagueSetting = this.leagueSettings[leagueType];
        const isAuction = leagueSetting.draftType === 'auction';
        const isH2H = leagueType === 'h2h12';
        const positionFilter = document.getElementById(`${prefix}PositionFilter`).value;

        // Filter players based on position
        let players = this.filterPlayersByPosition(leagueData, positionFilter);

        // Filter Drafted Players
        // Use the specific checkbox for this tab
        const hideDraftedCheckbox = document.getElementById(`${prefix}HideDrafted`);
        const hideDrafted = hideDraftedCheckbox ? hideDraftedCheckbox.checked : true;
        
        if (hideDrafted) {
            players = players.filter(p => !DraftManager.isPlayerTaken(p, leagueType));
        }

        // Determine display mode based on filtered players
        const showPitchers = positionFilter === 'P' || positionFilter === 'SP' || positionFilter === 'RP';
        const showHitters = positionFilter === 'DH' || ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'LF', 'CF', 'RF', 'OF'].includes(positionFilter);
        const showAll = positionFilter === 'all';

        console.log('Position filter:', positionFilter, '| Displaying', players.length, 'players');

        // Sort players using current sort state
        players = this.sortPlayers(players);

        // Helper to generate sort indicator
        const sortIndicator = (col) => {
            if (this.sortState.column === col) {
                return this.sortState.direction === 'asc' ? ' ▲' : ' ▼';
            }
            return '';
        };

        // Helper to get CSS class based on Z-score
        const getZClass = (z) => {
            if (z === undefined || z === null) return '';
            if (z >= 1.5) return 'stat-elite';  // Deep Green (Elite)
            if (z >= 0.5) return 'stat-good';   // Light Green (Helpful)
            if (z <= -1.5) return 'stat-poor';  // Deep Red (Poison) - reusing 'stat-poor' class which is dark red
            if (z <= -0.5) return 'stat-bad';   // Light Red (Harmful) - reusing 'stat-bad' class which is light red
            return '';                          // Neutral (No Color)
        };

        // Update table header based on player type and league
        const valHeader = isAuction ? `<th data-sort="value">$${sortIndicator('value')}</th>` : '';

        if (showPitchers) {
            // Pitcher columns
            if (isH2H) {
                headerRow.innerHTML = `
                    <th data-sort="rank">#</th>
                    <th data-sort="name">Name${sortIndicator('name')}</th>
                    <th data-sort="team">Team${sortIndicator('team')}</th>
                    <th data-sort="positionString">Pos${sortIndicator('positionString')}</th>
                    ${valHeader}
                    <th data-sort="w">W${sortIndicator('w')}</th>
                    <th data-sort="k">K${sortIndicator('k')}</th>
                    <th data-sort="era">ERA${sortIndicator('era')}</th>
                    <th data-sort="whip">WHIP${sortIndicator('whip')}</th>
                    <th data-sort="qs">QS${sortIndicator('qs')}</th>
                    <th data-sort="nsvh">NSVH${sortIndicator('nsvh')}</th>
                    <th data-sort="zTotal">Z-Total${sortIndicator('zTotal')}</th>
                `;
            } else {
                headerRow.innerHTML = `
                    <th data-sort="rank">#</th>
                    <th data-sort="name">Name${sortIndicator('name')}</th>
                    <th data-sort="team">Team${sortIndicator('team')}</th>
                    <th data-sort="positionString">Pos${sortIndicator('positionString')}</th>
                    ${valHeader}
                    <th data-sort="w">W${sortIndicator('w')}</th>
                    <th data-sort="sv">SV${sortIndicator('sv')}</th>
                    <th data-sort="k">K${sortIndicator('k')}</th>
                    <th data-sort="era">ERA${sortIndicator('era')}</th>
                    <th data-sort="whip">WHIP${sortIndicator('whip')}</th>
                    <th data-sort="zTotal">Z-Total${sortIndicator('zTotal')}</th>
                `;
            }
        } else if (showHitters) {
            // Hitter columns
            if (isH2H) {
                headerRow.innerHTML = `
                    <th data-sort="rank">#</th>
                    <th data-sort="name">Name${sortIndicator('name')}</th>
                    <th data-sort="team">Team${sortIndicator('team')}</th>
                    <th data-sort="positionString">Pos${sortIndicator('positionString')}</th>
                    ${valHeader}
                    <th data-sort="r">R${sortIndicator('r')}</th>
                    <th data-sort="hr">HR${sortIndicator('hr')}</th>
                    <th data-sort="rbi">RBI${sortIndicator('rbi')}</th>
                    <th data-sort="sb">SB${sortIndicator('sb')}</th>
                    <th data-sort="avg">AVG${sortIndicator('avg')}</th>
                    <th data-sort="ops">OPS${sortIndicator('ops')}</th>
                    <th data-sort="zTotal">Z-Total${sortIndicator('zTotal')}</th>
                `;
            } else {
                headerRow.innerHTML = `
                    <th data-sort="rank">#</th>
                    <th data-sort="name">Name${sortIndicator('name')}</th>
                    <th data-sort="team">Team${sortIndicator('team')}</th>
                    <th data-sort="positionString">Pos${sortIndicator('positionString')}</th>
                    ${valHeader}
                    <th data-sort="r">R${sortIndicator('r')}</th>
                    <th data-sort="hr">HR${sortIndicator('hr')}</th>
                    <th data-sort="rbi">RBI${sortIndicator('rbi')}</th>
                    <th data-sort="sb">SB${sortIndicator('sb')}</th>
                    <th data-sort="avg">AVG${sortIndicator('avg')}</th>
                    <th data-sort="zTotal">Z-Total${sortIndicator('zTotal')}</th>
                `;
            }
        } else {
            // All players view
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

        // Generate table rows (display all players)
        tbody.innerHTML = players.map((player, index) => {
            const valueDisplay = isAuction ? `<td class="${player.dollarValue >= 20 ? 'value-high' : player.dollarValue <= 5 ? 'value-low' : ''}">$${player.dollarValue || 0}</td>` : '';
            const posDisplay = player.positionString || player.positions?.join(',') || '-';
            const zTotal = parseFloat(player.zTotal) || 0;
            const zClass = zTotal > 0 ? 'z-positive' : 'z-negative';
            const injuryBadge = player.injuryStatus ? ` <span class="injury-badge injury-${player.injuryStatus.startsWith('IL') ? 'il' : 'dtd'}">${player.injuryStatus}</span>` : '';

            if (showPitchers) {
                // Pitcher row
                if (isH2H) {
                    return `<tr>
                        <td>${index + 1}</td>
                        <td><strong>${player.name}</strong>${injuryBadge}</td>
                        <td>${player.team}</td>
                        <td>${posDisplay}</td>
                        ${valueDisplay}
                        <td class="${getZClass(player.z_w)}">${player.w || 0}</td>
                        <td class="${getZClass(player.z_k)}">${player.k || player.so || 0}</td>
                        <td class="${getZClass(player.z_era)}">${this.formatNumber(player.era, 2, '0.00')}</td>
                        <td class="${getZClass(player.z_whip)}">${this.formatNumber(player.whip, 2, '0.00')}</td>
                        <td class="${getZClass(player.z_qs)}">${player.qs || 0}</td>
                        <td class="${getZClass(player.z_nsvh)}">${player.nsvh || 0}</td>
                        <td class="${zClass}">${this.formatNumber(player.zTotal, 1, '0.0')}</td>
                    </tr>`;
                } else {
                    return `<tr>
                        <td>${index + 1}</td>
                        <td><strong>${player.name}</strong>${injuryBadge}</td>
                        <td>${player.team}</td>
                        <td>${posDisplay}</td>
                        ${valueDisplay}
                        <td class="${getZClass(player.z_w)}">${player.w || 0}</td>
                        <td class="${getZClass(player.z_sv)}">${player.sv || 0}</td>
                        <td class="${getZClass(player.z_k)}">${player.k || player.so || 0}</td>
                        <td class="${getZClass(player.z_era)}">${this.formatNumber(player.era, 2, '0.00')}</td>
                        <td class="${getZClass(player.z_whip)}">${this.formatNumber(player.whip, 2, '0.00')}</td>
                        <td class="${zClass}">${this.formatNumber(player.zTotal, 1, '0.0')}</td>
                    </tr>`;
                }
            } else if (showHitters) {
                // Hitter row
                if (isH2H) {
                    return `<tr>
                        <td>${index + 1}</td>
                        <td><strong>${player.name}</strong>${injuryBadge}</td>
                        <td>${player.team}</td>
                        <td>${posDisplay}</td>
                        ${valueDisplay}
                        <td class="${getZClass(player.z_r)}">${player.r || 0}</td>
                        <td class="${getZClass(player.z_hr)}">${player.hr || 0}</td>
                        <td class="${getZClass(player.z_rbi)}">${player.rbi || 0}</td>
                        <td class="${getZClass(player.z_sb)}">${player.sb || 0}</td>
                        <td class="${getZClass(player.z_avg)}">${this.formatNumber(player.avg, 3, '.000')}</td>
                        <td class="${getZClass(player.z_ops)}">${this.formatNumber(player.ops, 3, '.000')}</td>
                        <td class="${zClass}">${this.formatNumber(player.zTotal, 1, '0.0')}</td>
                    </tr>`;
                } else {
                    return `<tr>
                        <td>${index + 1}</td>
                        <td><strong>${player.name}</strong>${injuryBadge}</td>
                        <td>${player.team}</td>
                        <td>${posDisplay}</td>
                        ${valueDisplay}
                        <td class="${getZClass(player.z_r)}">${player.r || 0}</td>
                        <td class="${getZClass(player.z_hr)}">${player.hr || 0}</td>
                        <td class="${getZClass(player.z_rbi)}">${player.rbi || 0}</td>
                        <td class="${getZClass(player.z_sb)}">${player.sb || 0}</td>
                        <td class="${getZClass(player.z_avg)}">${this.formatNumber(player.avg, 3, '.000')}</td>
                        <td class="${zClass}">${this.formatNumber(player.zTotal, 1, '0.0')}</td>
                    </tr>`;
                }
            } else {
                // All players view
                const typeLabel = player.type === 'pitcher' ? 'P' : 'H';
                return `<tr>
                    <td>${index + 1}</td>
                    <td><strong>${player.name}</strong>${injuryBadge}</td>
                    <td>${player.team}</td>
                    <td>${typeLabel}</td>
                    <td>${posDisplay}</td>
                    ${valueDisplay}
                    <td class="${zClass}">${this.formatNumber(player.zTotal, 1, '0.0')}</td>
                </tr>`;
            }
        }).join('');

        // Rebind sort event listeners to new header cells
        headerRow.querySelectorAll('th[data-sort]').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', (e) => {
                const col = e.target.dataset.sort || e.target.closest('th').dataset.sort;
                if (col) this.sortTable(col, prefix);
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
     * @param {string} prefix - 'roto' or 'h2h'
     * @param {string} query - Search query
     */
    searchPlayers(prefix, query) {
        if (!query) {
            // Refresh table to show all players
            if (prefix === 'roto') {
                this.updateRotoTable();
            } else {
                this.updateH2HTable();
            }
            return;
        }

        query = query.toLowerCase();
        const tbody = document.querySelector(`#${prefix}PlayerTable tbody`);
        const rows = tbody.querySelectorAll('tr');

        rows.forEach(row => {
            const name = row.cells[1]?.textContent.toLowerCase() || '';
            row.style.display = name.includes(query) ? '' : 'none';
        });
    },

    /**
     * Sort table by column
     * @param {string} column - Column to sort by
     * @param {string} prefix - 'roto' or 'h2h'
     */
    sortTable(column, prefix) {
        // Toggle direction if same column, otherwise default to desc (or asc for name/team)
        if (this.sortState.column === column) {
            this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.column = column;
            // Default direction based on column type
            if (column === 'name' || column === 'team' || column === 'positionString') {
                this.sortState.direction = 'asc';
            } else if (column === 'era' || column === 'whip') {
                // Lower is better for ERA/WHIP
                this.sortState.direction = 'asc';
            } else {
                this.sortState.direction = 'desc';
            }
        }

        console.log('Sorting by:', column, this.sortState.direction);

        // Refresh the appropriate table
        if (prefix === 'roto') {
            this.updateRotoTable();
        } else {
            this.updateH2HTable();
        }
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
            'value': player.dollarValue || player.zTotal || 0,
            'rank': player.overallRank || player.valueRank || 0,
            'pos': player.positionString || '',
            'k': player.k || player.so || 0,
            'so': player.k || player.so || 0
        };

        if (mappings.hasOwnProperty(column)) {
            return mappings[column];
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
            this.currentData = { hitters: null, pitchers: null, merged: null, combined: { roto5x5: [], h2h12: [] } };
            this.updateDataInfo();
            this.updateYahooStats();
            this.updateRotoTable();
            this.updateH2HTable();
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
            this.currentData.combined = { roto5x5: [], h2h12: [] };

            // Update all UI
            this.updateDataInfo();
            this.updateRotoTable();
            this.updateH2HTable();
            this.updateDraftAssistantUI('roto5x5');
            this.updateDraftAssistantUI('h2h12');
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
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    processDraftLog(leagueType = 'roto5x5') {
        const inputId = leagueType === 'h2h12' ? 'h2hDraftLogInput' : 'draftLogInput';
        const inputEl = document.getElementById(inputId);
        if (!inputEl) return;

        const text = inputEl.value;
        // Use the correct player pool for matching
        const playerPool = this.currentData.combined[leagueType] || this.currentData.combined.roto5x5;

        // Sync team name from input field before processing
        const nameInputId = leagueType === 'h2h12' ? 'h2hDraftTeamName' : 'draftTeamName';
        const nameInput = document.getElementById(nameInputId);
        if (nameInput && nameInput.value.trim()) {
            DraftManager.setTeamName(nameInput.value.trim(), leagueType);
        }

        const result = DraftManager.processDraftLog(text, playerPool, leagueType);
        
        if (result.success) {
            this.updateDraftAssistantUI(leagueType);
            // Refresh tables to hide drafted players
            if (leagueType === 'roto5x5') this.updateRotoTable();
            else this.updateH2HTable();
            
            // Clear input
            inputEl.value = '';
            alert(`Draft log processed! ${result.count} players marked as taken.`);
        } else {
            alert('Failed to process draft log: ' + result.message);
        }
    },

    /**
     * Clear draft log
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    clearDraftLog(leagueType = 'roto5x5') {
        if (confirm('Clear all draft history for ' + (leagueType === 'h2h12' ? 'H2H' : 'Roto') + '?')) {
            DraftManager.clearDraft(leagueType);
            this.updateDraftAssistantUI(leagueType);
            if (leagueType === 'roto5x5') this.updateRotoTable();
            else this.updateH2HTable();
        }
    },

    /**
     * Sync draft results from Yahoo API
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    async syncDraftFromApi(leagueType = 'roto5x5') {
        if (typeof YahooApi === 'undefined' || !YahooApi.authenticated || !YahooApi.selectedLeague) {
            alert('Please connect to Yahoo and select a league in the Setup tab first.');
            return;
        }

        const btnId = leagueType === 'h2h12' ? 'h2hSyncDraftFromApiBtn' : 'syncDraftFromApiBtn';
        const btn = document.getElementById(btnId);
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

            // Clear existing draft data for this league
            DraftManager.clearDraft(leagueType);
            if (myTeam) {
                DraftManager.setTeamName(myTeam.name, leagueType);
            }

            // Process each pick
            const playerPool = this.currentData.combined[leagueType] || [];
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
                    const state = DraftManager._getState(leagueType);

                    if (!state.takenPlayers.has(uniqueKey)) {
                        state.takenPlayers.add(uniqueKey);
                        state.draftLog.push({
                            pick: pick.pick,
                            player: matchedPlayer,
                            isMyTeam: isMyPick,
                            cost: pick.cost || 0,
                        });
                    }

                    if (isMyPick) {
                        const alreadyInTeam = state.myTeam.some(p =>
                            p.name === matchedPlayer.name && p.team === matchedPlayer.team
                        );
                        if (!alreadyInTeam) {
                            state.myTeam.push({ ...matchedPlayer, cost: pick.cost || 0 });
                        }
                    }
                    processedCount++;
                }
            }

            DraftManager.saveState();

            // Update UI
            this.updateDraftAssistantUI(leagueType);
            if (leagueType === 'roto5x5') this.updateRotoTable();
            else this.updateH2HTable();

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
    renderBalanceDashboard(leagueType) {
        const state = DraftManager._getState(leagueType);
        const myTeam = state.myTeam;
        
        if (!myTeam || myTeam.length === 0) return '';

        const isH2H = leagueType === 'h2h12';

        // Get categories dynamically from Calculator LEAGUES config
        const league = Calculator.LEAGUES[leagueType];
        const cats = league
            ? [...league.hitting, ...league.pitching].map(c => c.toUpperCase())
            : (isH2H
                ? ['R', 'HR', 'RBI', 'SB', 'AVG', 'OPS', 'W', 'K', 'ERA', 'WHIP', 'QS', 'NSVH']
                : ['R', 'HR', 'RBI', 'SB', 'AVG', 'W', 'SV', 'K', 'ERA', 'WHIP']);
            
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
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    updateDraftAssistantUI(leagueType = 'roto5x5') {
        if (typeof DraftManager === 'undefined') return;

        const isH2H = leagueType === 'h2h12';
        const containerId = isH2H ? 'h2hMyTeamStats' : 'myTeamStats';
        const nameInputId = isH2H ? 'h2hDraftTeamName' : 'draftTeamName';
        
        const stats = DraftManager.getMyTeamStats(leagueType);
        const limit = this.leagueSettings[leagueType]?.inningsLimit || 1350;
        const ipPct = Math.min(100, (stats.ip / limit) * 100);
        const ipColor = stats.ip > limit ? '#ef4444' : stats.ip > limit * 0.9 ? '#f59e0b' : '#3b82f6';
        
        // Update Team Name Input if not focused
        const nameInput = document.getElementById(nameInputId);
        if (nameInput && document.activeElement !== nameInput) {
             const state = DraftManager._getState(leagueType);
             nameInput.value = state.myTeamName || 'bluezhin';
        }

        // Update Teams count input if not focused
        const teamCountId = isH2H ? 'h2hDraftTeamCount' : 'draftTeamCount';
        const teamCountInput = document.getElementById(teamCountId);
        if (teamCountInput && document.activeElement !== teamCountInput) {
            teamCountInput.value = this.leagueSettings[leagueType]?.teams || 12;
        }

        // Update My Team Stats display
        const statsContainer = document.getElementById(containerId);
        if (statsContainer) {
            let inflationHtml = '';
            
            // --- MODULE 1: INFLATION TRACKER (H2H Only) ---
            if (isH2H) {
                const inflationStats = DraftManager.calculateInflationStats(
                    this.currentData.combined[leagueType],
                    this.leagueSettings[leagueType],
                    leagueType
                );

                if (inflationStats) {
                    const rate = inflationStats.inflationRate;
                    let bgColor = '#f1f5f9'; // Neutral gray
                    let textColor = '#334155';
                    let statusText = 'Neutral';

                    if (rate > 1.05) {
                        bgColor = '#fee2e2'; // Light Red (Inflation)
                        textColor = '#b91c1c';
                        statusText = 'Inflated (Expensive)';
                    } else if (rate < 0.95) {
                        bgColor = '#dcfce7'; // Light Green (Deflation)
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
            // ----------------------------------------------

            let hittingStatsHtml = '';
            let pitchingStatsHtml = '';

            if (isH2H) {
                // H2H 6x6 Stats
                hittingStatsHtml = `
                    <div>R: <strong>${Math.round(stats.r)}</strong></div>
                    <div>HR: <strong>${Math.round(stats.hr)}</strong></div>
                    <div>RBI: <strong>${Math.round(stats.rbi)}</strong></div>
                    <div>SB: <strong>${Math.round(stats.sb)}</strong></div>
                    <div title="Batting Average">AVG: <strong>${this.formatNumber(stats.avg, 3, '.000')}</strong></div>
                    <div title="On-Base Plus Slugging">OPS: <strong>${this.formatNumber(stats.ops, 3, '.000')}</strong></div>
                `;
                pitchingStatsHtml = `
                    <div>W: <strong>${Math.round(stats.w)}</strong></div>
                    <div>K: <strong>${Math.round(stats.k)}</strong></div>
                    <div title="Quality Starts">QS: <strong>${Math.round(stats.qs)}</strong></div>
                    <div title="Saves + Holds">NSVH: <strong>${Math.round(stats.nsvh)}</strong></div>
                    <div>ERA: <strong>${this.formatNumber(stats.era, 2)}</strong></div>
                    <div>WHIP: <strong>${this.formatNumber(stats.whip, 2)}</strong></div>
                `;
            } else {
                // Roto 5x5 Stats
                hittingStatsHtml = `
                    <div>AVG: <strong>${this.formatNumber(stats.avg, 3, '.000')}</strong></div>
                    <div>HR: <strong>${Math.round(stats.hr)}</strong></div>
                    <div>R: <strong>${Math.round(stats.r)}</strong></div>
                    <div>RBI: <strong>${Math.round(stats.rbi)}</strong></div>
                    <div>SB: <strong>${Math.round(stats.sb)}</strong></div>
                `;
                pitchingStatsHtml = `
                    <div>ERA: <strong>${this.formatNumber(stats.era, 2)}</strong></div>
                    <div>WHIP: <strong>${this.formatNumber(stats.whip, 2)}</strong></div>
                    <div>W: <strong>${Math.round(stats.w)}</strong></div>
                    <div>SV: <strong>${Math.round(stats.sv)}</strong></div>
                    <div>K: <strong>${Math.round(stats.k)}</strong></div>
                `;
            }

            const inningsHtml = (!isH2H) ? `
                <div style="margin-top: 10px; font-size: 0.85rem; color: #64748b;">
                    Innings: <strong>${Math.round(stats.ip)}</strong> / ${limit} (${Math.round(ipPct)}%)
                    <div style="background: #e2e8f0; height: 6px; border-radius: 3px; overflow: hidden; margin-top: 4px;">
                        <div style="background: ${ipColor}; width: ${ipPct}%; height: 100%;"></div>
                    </div>
                </div>
            ` : '';

            const balanceHtml = this.renderBalanceDashboard(leagueType);

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
        
        this.updateDraftRecommendations(leagueType);

        // --- ROTO SCARCITY HEATMAP ---
        if (!isH2H) {
            const rotoScarcityContainer = document.getElementById('rotoScarcityHeatmap');
            if (rotoScarcityContainer) {
                const tiers = this.leagueSettings.scarcityTiers?.roto5x5 || [8, 6, 5, 3, 2, 1, 0];
                const allPlayers = this.currentData.combined[leagueType] || [];
                const scarcity = DraftManager.getScarcityData(allPlayers, leagueType, tiers);
                rotoScarcityContainer.innerHTML = this.renderScarcityHeatmap(scarcity, false, tiers);
            }
        }
    },
    /**
     * Update List A: Best Value Recommendations
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    updateDraftRecommendations(leagueType = 'roto5x5') {
        const isH2H = leagueType === 'h2h12';
        const containerId = isH2H ? 'h2hRecommendations' : 'draftRecommendations';
        const container = document.getElementById(containerId);
        if (!container) return;

        // Get available players
        const allPlayers = this.currentData.combined[leagueType] || [];
        
        // --- MODULE 2: SCARCITY HEATMAP (H2H Only) ---
        if (isH2H) {
            const tiers = this.leagueSettings.scarcityTiers?.h2h12 || [30, 20, 15, 10, 5, 3];
            const scarcity = DraftManager.getScarcityData(allPlayers, leagueType, tiers);
            container.innerHTML = this.renderScarcityHeatmap(scarcity, true, tiers);
            return; // Skip standard recommendations for H2H
        }
        // ---------------------------------------------

        const available = allPlayers.filter(p => !DraftManager.isPlayerTaken(p, leagueType));
        
        if (available.length === 0) {
            container.innerHTML = '<p>No players available.</p>';
            return;
        }

        // Score players based on "Best Available" + "Punt SV" logic
        const scoredPlayers = available.map(p => ({
            ...p,
            recScore: this.getRecommendationScore(p, leagueType)
        }));

        // Sort by Recommendation Score
        scoredPlayers.sort((a, b) => b.recScore - a.recScore);
        
        // Take Top 5
        const top5 = scoredPlayers.slice(0, 5);
        
        container.innerHTML = top5.map((p, i) => {
            const isPitcher = p.type === 'pitcher';
            let statsHtml = '';
            
            if (isPitcher) {
                statsHtml = `ERA: ${this.formatNumber(p.era)} | WHIP: ${this.formatNumber(p.whip)} | K: ${p.k}`;
            } else {
                statsHtml = `AVG: ${this.formatNumber(p.avg, 3, '.000')} | HR: ${p.hr} | SB: ${p.sb}`;
            }
            
            return `
                <div class="recommendation-card rank-${i+1}">
                    <div class="rec-header">
                        <span class="rec-rank">#${i+1}</span>
                        <span class="rec-name" style="font-size: 1rem;">${p.name}</span>
                        ${p.injuryStatus ? `<span class="injury-badge injury-${p.injuryStatus.startsWith('IL') ? 'il' : 'dtd'}">${p.injuryStatus}</span>` : ''}
                        <span class="rec-pos" style="font-size: 0.75rem;">${p.positionString}</span>
                    </div>
                    <div class="rec-team">${p.team}</div>
                    <div class="rec-stats" style="font-size: 0.8rem;">${statsHtml}</div>
                    <div class="rec-value">Z: ${this.formatNumber(p.zTotal, 1)}</div>
                </div>
            `;
        }).join('');
        
        this.updateSmartRecommendations(leagueType);
    },

    /**
     * Render Scarcity Heatmap (Generic for H2H & Roto)
     */
    renderScarcityHeatmap(scarcity, isH2H = true, tiers = null) {
        if (!scarcity) return '<p>No data available</p>';

        const positions = isH2H 
            ? ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'SP', 'RP']
            : ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'LF', 'CF', 'RF', 'OF', 'SP', 'RP'];
        
        let activeTiers = tiers;
        if (!activeTiers) {
            activeTiers = isH2H 
                ? [30, 20, 15, 10, 5, 3] 
                : [8, 6, 5, 3, 2, 1, 0];
        }

        const headers = activeTiers.map(t => isH2H ? `$${t}+` : `Z>${t}`);
        
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
                    Positional Scarcity (${isH2H ? '$ Value' : 'Z-Score'})
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
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    updateSmartRecommendations(leagueType = 'roto5x5') {
        const isH2H = leagueType === 'h2h12';
        const containerId = isH2H ? 'h2hSmartRecommendations' : 'smartRecommendations';
        const container = document.getElementById(containerId);
        if (!container) return;

        const allPlayers = this.currentData.combined[leagueType] || [];
        const available = allPlayers.filter(p => !DraftManager.isPlayerTaken(p, leagueType));
        
        if (available.length === 0) {
            container.innerHTML = '<p>No players available.</p>';
            return;
        }

        // Score with "Need Factor"
        const scoredPlayers = available.map(p => ({
            ...p,
            smartScore: this.getTeamNeedScore(p, leagueType)
        }));

        scoredPlayers.sort((a, b) => b.smartScore - a.smartScore);
        
        const top5 = scoredPlayers.slice(0, 5);
        
        container.innerHTML = top5.map((p, i) => {
            const isPitcher = p.type === 'pitcher';
            let statsHtml = '';
            
            if (isPitcher) {
                statsHtml = isH2H
                    ? `QS: ${Math.round(p.qs || 0)} | K: ${p.k}`
                    : `ERA: ${this.formatNumber(p.era)} | K: ${p.k}`;
            } else {
                statsHtml = isH2H
                    ? `OPS: ${this.formatNumber(p.ops, 3, '.000')} | HR: ${p.hr}`
                    : `AVG: ${this.formatNumber(p.avg, 3, '.000')} | SB: ${p.sb}`;
            }
            
            // Generate tags based on why they were recommended
            let tags = [];
            if (p.isNeedFit) tags.push('<span style="color: #ef4444; font-weight: bold; font-size: 0.7rem; border: 1px solid #ef4444; padding: 0 4px; border-radius: 3px;">NEED</span>');
            if (p.isScarcityPick) tags.push('<span style="color: #f59e0b; font-weight: bold; font-size: 0.7rem; border: 1px solid #f59e0b; padding: 0 4px; border-radius: 3px;">SCARCE</span>');
            
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
                    <div class="rec-value" style="color: #0284c7;">Score: ${this.formatNumber(p.smartScore, 1)}</div>
                </div>
            `;
        }).join('');
    },

    /**
     * Calculate dynamic position caps from rosterComposition
     */
    calculatePositionCaps(leagueType) {
        const composition = this.leagueSettings[leagueType]?.rosterComposition || [];
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
    calculateCategoryNeedMultiplier(player, myTeam, leagueType) {
        const league = Calculator.LEAGUES[leagueType];
        if (!league || myTeam.length === 0) return 1.0;

        const weights = this.leagueSettings[leagueType]?.categoryWeights || {};
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
    getTeamNeedScore(player, leagueType = 'roto5x5') {
        // Base score from weighted Z-Total
        let score = this.getRecommendationScore(player, leagueType);

        const state = DraftManager._getState(leagueType);
        const myTeam = state.myTeam || [];

        player.isNeedFit = false;
        player.isScarcityPick = false;

        // --- 1. ROSTER BALANCE (Position Need) ---
        const posCounts = {
            'C': 0, '1B': 0, '2B': 0, '3B': 0, 'SS': 0, 'OF': 0,
            'SP': 0, 'RP': 0
        };

        myTeam.forEach(p => {
            if (p.positions) {
                let posList = [];
                if (Array.isArray(p.positions)) posList = p.positions;
                else if (typeof p.positions === 'string') posList = p.positions.split(/,|\||\//).map(s => s.trim());
                else if (typeof p.positionString === 'string') posList = p.positionString.split(/,|\||\//).map(s => s.trim());

                posList.forEach(pos => {
                    const trimPos = pos.trim();
                    if (posCounts[trimPos] !== undefined) posCounts[trimPos]++;
                });
            }
            if (p.isPitcherSP) posCounts.SP++;
            if (p.isPitcherRP) posCounts.RP++;
        });

        // Dynamic position caps from roster composition
        const caps = this.calculatePositionCaps(leagueType);

        let posMultiplier = 1.0;

        if (player.type === 'hitter') {
            const positions = player.positions || [];
            let isSaturated = true;
            let isHighNeed = false;

            for (const pos of positions) {
                if (posCounts[pos] < caps[pos]) isSaturated = false;
                if (posCounts[pos] === 0) isHighNeed = true;
            }

            if (isHighNeed) {
                posMultiplier = 1.2;
                player.isNeedFit = true;
            } else if (isSaturated) {
                posMultiplier = 0.8;
            }
        } else {
            // Pitcher position + innings limit check
            if (player.isPitcherSP && posCounts.SP >= caps.SP) posMultiplier = 0.8;
            if (player.isPitcherRP && posCounts.RP >= caps.RP) posMultiplier = 0.8;

            const stats = DraftManager.getMyTeamStats(leagueType);
            const limit = this.leagueSettings[leagueType]?.inningsLimit || 1400;
            if (stats.ip > limit * 0.95 && player.isPitcherSP) {
                posMultiplier = 0.5;
            }
        }

        score *= posMultiplier;

        // --- 2. CATEGORY NEED (Dynamic Balancing) ---
        score *= this.calculateCategoryNeedMultiplier(player, myTeam, leagueType);

        return score;
    },

    /**
     * Calculate Recommendation Score
     * Applies category weights to z-score calculation
     */
    getRecommendationScore(player, leagueType = 'roto5x5') {
        const league = Calculator.LEAGUES[leagueType];
        const weights = this.leagueSettings[leagueType]?.categoryWeights || {};

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
