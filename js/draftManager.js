/**
 * Fantasy Baseball Draft Tool - Draft Manager
 * Handles live draft tracking, parsing Yahoo draft logs, and managing team state.
 * Supports multiple leagues (Roto 5x5 and H2H 6x6) with independent states.
 */

const DraftManager = {
    // State - Independent for each league
    state: {
        roto5x5: {
            myTeamName: 'bluezhin',
            takenPlayers: new Set(), // Set of player keys (name|team|type)
            myTeam: [], // Array of player objects
            draftLog: [], // History of picks
            lastProcessedText: '' 
        },
        h2h12: {
            myTeamName: 'bluezhin',
            takenPlayers: new Set(),
            myTeam: [],
            draftLog: [],
            lastProcessedText: ''
        }
    },

    /**
     * Initialize Draft Manager
     */
    init() {
        this.loadState();
    },

    /**
     * Get state for specific league
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    _getState(leagueType) {
        return this.state[leagueType] || this.state.roto5x5;
    },

    /**
     * Load state from localStorage
     */
    loadState() {
        const stored = localStorage.getItem('fantasy_draft_state_v2');
        if (stored) {
            const data = JSON.parse(stored);
            
            // Restore Roto State
            if (data.roto5x5) {
                this.state.roto5x5 = {
                    ...data.roto5x5,
                    takenPlayers: new Set(data.roto5x5.takenPlayers || [])
                };
            }
            
            // Restore H2H State
            if (data.h2h12) {
                this.state.h2h12 = {
                    ...data.h2h12,
                    takenPlayers: new Set(data.h2h12.takenPlayers || [])
                };
            }
        } else {
            // Migration from v1 (single state) if exists
            const oldStored = localStorage.getItem('fantasy_draft_state');
            if (oldStored) {
                const oldData = JSON.parse(oldStored);
                // Assume old data was for Roto
                this.state.roto5x5 = {
                    myTeamName: oldData.myTeamName || 'bluezhin',
                    takenPlayers: new Set(oldData.takenPlayers || []),
                    myTeam: oldData.myTeam || [],
                    draftLog: oldData.draftLog || [],
                    lastProcessedText: ''
                };
            }
        }
    },

    /**
     * Save state to localStorage
     */
    saveState() {
        const data = {
            roto5x5: {
                ...this.state.roto5x5,
                takenPlayers: Array.from(this.state.roto5x5.takenPlayers)
            },
            h2h12: {
                ...this.state.h2h12,
                takenPlayers: Array.from(this.state.h2h12.takenPlayers)
            }
        };
        localStorage.setItem('fantasy_draft_state_v2', JSON.stringify(data));
    },

    /**
     * Set user's team name
     * @param {string} name 
     * @param {string} leagueType
     */
    setTeamName(name, leagueType = 'roto5x5') {
        const state = this._getState(leagueType);
        state.myTeamName = name;
        this.saveState();
    },

    /**
     * Clear all draft history for a league
     * @param {string} leagueType
     */
    clearDraft(leagueType = 'roto5x5') {
        const state = this._getState(leagueType);
        state.takenPlayers.clear();
        state.myTeam = [];
        state.draftLog = [];
        state.lastProcessedText = '';
        this.saveState();
        return true;
    },

    /**
     * Process draft log text pasted from Yahoo
     * @param {string} text - Raw text from Yahoo Draft interface
     * @param {Array} allPlayers - Master list of all players (hitters + pitchers)
     * @param {string} leagueType - 'roto5x5' or 'h2h12'
     */
    processDraftLog(text, allPlayers, leagueType = 'roto5x5') {
        if (!text || !text.trim()) return { success: false, message: 'Empty text' };

        const state = this._getState(leagueType);
        const savedTeamName = state.myTeamName;
        state.lastProcessedText = text;
        const lines = text.trim().split('\n');

        // Clear existing state before reprocessing (full paste = source of truth)
        state.takenPlayers.clear();
        state.myTeam = [];
        state.draftLog = [];
        state.myTeamName = savedTeamName; // Preserve team name

        // 0. Attempt to auto-detect team name (only if current name is default/empty)
        const isDefaultName = !savedTeamName || savedTeamName === 'bluezhin';
        if (isDefaultName) {
            const detectedName = this.detectTeamName(lines);
            if (detectedName) {
                console.log(`[${leagueType}] Auto-detected team name: ${detectedName}`);
                state.myTeamName = detectedName;
            }
        }

        let processedCount = 0;

        // 1. Process Draft Results
        // Regex 1: Auction Format (with Cost) - "1 PlayerNameTeam- Pos Manager ... $12"
        const auctionRegex = /^(\d+)\s+(.+?)([A-Z]{2,3}|ATH|WAS|CWS|AZ)-\s+([A-Za-z0-9,]+)\s+(.+?)\s+\d+\s+\$(\d+)/;
        
        // Regex 2: Snake Result Format (No Cost) - "217 PlayerNameTeam- Pos Manager Rank"
        const snakeResultRegex = /^(\d+)\s+(.+?)([A-Z]{2,3}|ATH|WAS|CWS|AZ)-\s+([A-Za-z0-9,]+)\s+(.+?)(?:\s+\d+)?$/;
        
        // Regex 3: Sidebar/Updates Format - "1stPlayerNameTeam - Pos" (No spaces between rank and name sometimes)
        const snakeUpdateRegex = /^(\d+)(?:st|nd|rd|th)\s*(.+?)([A-Z]{2,3}|ATH|WAS|CWS|AZ)\s+-\s+([A-Za-z0-9,]+)/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.length < 5) continue;

            // Stop processing draft picks when we hit non-results sections
            if (line.startsWith('My Queue') || line.startsWith('My Team')) break;
            
            let pickNum = 0;
            let rawName = '';
            let teamCode = '';
            let posStr = ''; // Unused but captured
            let manager = '';
            let cost = 0;
            let matched = false;

            // Try Auction
            let match = line.match(auctionRegex);
            if (match) {
                pickNum = parseInt(match[1]);
                rawName = match[2].trim();
                teamCode = match[3];
                manager = match[5].trim();
                cost = parseInt(match[6]);
                matched = true;
            } 
            // Try Snake Result
            else {
                match = line.match(snakeResultRegex);
                if (match) {
                    pickNum = parseInt(match[1]);
                    rawName = match[2].trim();
                    teamCode = match[3];
                    // Manager might be missing or merged? Assuming standard copy paste:
                    // In the log: "217 Masyn WinnSTL- SS Team 1 182"
                    // Group 5 is "Team 1 182" or "Team 1". 
                    // Let's assume the last token is rank if numeric.
                    manager = match[5].trim(); 
                    matched = true;
                }
                // Try Snake Update
                else {
                    match = line.match(snakeUpdateRegex);
                    if (match) {
                        pickNum = parseInt(match[1]);
                        rawName = match[2].trim();
                        teamCode = match[3];
                        // No manager info in this line usually
                        matched = true;
                    }
                }
            }
            
            if (matched) {
                // If manager is detected, check if it's me
                // Use word-boundary matching to avoid "Team 1" matching "Team 10"
                let isMyPick = false;
                if (manager && state.myTeamName) {
                    const managerLower = manager.toLowerCase().trim();
                    const myNameLower = state.myTeamName.toLowerCase().trim();
                    // Exact match, or manager starts with myName followed by non-alphanumeric (e.g. space+rank)
                    const namePattern = new RegExp('^' + myNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)', 'i');
                    isMyPick = managerLower === myNameLower || namePattern.test(managerLower);
                }

                this.markPlayerAsTaken(rawName, teamCode, allPlayers, isMyPick, pickNum, cost, leagueType);
                processedCount++;
            }
        }
        
        // 2. Process "My Team" section (Fallback only if no picks matched via Draft Results)
        if (state.myTeam.length === 0) {
            const myTeamIndex = lines.findIndex(l => l.includes('My Team') && l.includes('of'));
            if (myTeamIndex !== -1) {
                this.parseMyTeamSection(lines, myTeamIndex + 1, allPlayers, leagueType);
            }
        }
        
        this.saveState();
        return { success: true, count: state.takenPlayers.size };
    },

    /**
     * Auto-detect team name from draft log
     */
    detectTeamName(lines) {
        // Strategy 1: Cross-reference "My Team" section
        const myTeamIndex = lines.findIndex(l => l.includes('My Team') && l.includes('of'));
        
        if (myTeamIndex !== -1) {
            const myPlayers = [];
            for (let i = myTeamIndex + 1; i < Math.min(myTeamIndex + 25, lines.length); i++) {
                const line = lines[i].trim();
                const match = line.match(/\s+(.+?)([A-Z]{2,3}|ATH|WAS|CWS|AZ)\s+-\s+/);
                if (match) myPlayers.push(match[1].trim());
            }

            if (myPlayers.length > 0) {
                const pickRegex = /^(\d+)\s+(.+?)([A-Z]{2,3}|ATH|WAS|CWS|AZ)-\s+([A-Z,]+)\s+(.+?)\s+\d+\s+\$(\d+)/;
                for (const line of lines) {
                    const match = line.match(pickRegex);
                    if (match) {
                        const rawName = match[2].trim();
                        const manager = match[5].trim();
                        for (const myP of myPlayers) {
                            const myPLast = myP.split(' ').pop().toLowerCase();
                            if (rawName.toLowerCase().includes(myPLast)) return manager;
                        }
                    }
                }
            }
        }

        // Strategy 2: Known aliases
        const knownAliases = ['bluezhin', 'Blues Explosion', 'BlueZhin'];
        const pickRegex = /^(\d+)\s+(.+?)([A-Z]{2,3}|ATH|WAS|CWS|AZ)-\s+([A-Z,]+)\s+(.+?)\s+\d+\s+\$(\d+)/;

        for (const line of lines) {
            const match = line.match(pickRegex);
            if (match) {
                const manager = match[5].trim();
                if (knownAliases.some(alias => manager.toLowerCase() === alias.toLowerCase())) {
                    return manager;
                }
            }
        }
        return null;
    },
    
    /**
     * Parse "My Team" specific section
     */
    parseMyTeamSection(lines, startIndex, allPlayers, leagueType) {
        const state = this._getState(leagueType);
        
        for (let i = startIndex; i < Math.min(startIndex + 40, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith('Updates') || line === 'Pos' || line === 'Player' || line === 'Salary' || !line) continue;
            if (line.includes('joined')) break;
            
            const match = line.match(/\s+(.+?)([A-Z]{2,3}|ATH|WAS|CWS|AZ)\s+-\s+/);

            if (match) {
                const name = match[1].trim();
                const team = match[2];
                const player = this.findPlayerInMasterList(name, team, allPlayers);
                
                if (player) {
                    const uniqueKey = `${player.name}|${player.team}|${player.type}`;
                    
                    if (!state.takenPlayers.has(uniqueKey)) {
                        state.takenPlayers.add(uniqueKey);
                    }
                    
                    if (!state.myTeam.some(p => p.name === player.name && p.team === player.team)) {
                        state.myTeam.push(player);
                    }
                }
            }
        }
    },

    /**
     * Mark a player as taken
     */
    markPlayerAsTaken(name, team, allPlayers, isMyTeam, pickNum = null, cost = 0, leagueType = 'roto5x5') {
        const state = this._getState(leagueType);
        const player = this.findPlayerInMasterList(name, team, allPlayers);
        
        if (player) {
            const uniqueKey = `${player.name}|${player.team}|${player.type}`;
            
            if (!state.takenPlayers.has(uniqueKey)) {
                state.takenPlayers.add(uniqueKey);
                state.draftLog.push({
                    pick: pickNum,
                    player: player,
                    isMyTeam: isMyTeam,
                    cost: cost
                });
            }
            
            if (isMyTeam) {
                 const alreadyInTeam = state.myTeam.some(p => p.name === player.name && p.team === player.team && p.type === player.type);
                 if (!alreadyInTeam) {
                     state.myTeam.push({
                         ...player,
                         cost: cost
                     });
                 }
            }
        }
    },

    /**
     * Find player object in master list using fuzzy matching
     */
    findPlayerInMasterList(yahooName, yahooTeam, allPlayers) {
        const players = Array.isArray(allPlayers) ? allPlayers : (allPlayers.roto5x5 || []);
        
        // --- SPECIAL HANDLING: SHOHEI OHTANI ---
        if (yahooName.includes('Ohtani')) {
            let targetType = null;
            // Yahoo format: "Shohei Ohtani (Batter)", "Shohei Ohtani (Pitcher)"
            if (yahooName.includes('(Batter)') || yahooName.includes('Util')) targetType = 'hitter';
            else if (yahooName.includes('(Pitcher)') || yahooName.includes('SP')) targetType = 'pitcher';
            
            if (targetType) {
                // Find matching Ohtani in master list
                // Master list might just say "Shohei Ohtani" for both entries, distinguished by 'type'
                const match = players.find(p => p.name.includes('Ohtani') && p.type === targetType);
                if (match) return match;
            }
        }

        const normYahooName = this.normalizeNameForMatching(this.cleanYahooName(yahooName));
        
        // 1. Try Exact Normalized Match
        let match = players.find(p => this.normalizeNameForMatching(p.name) === normYahooName);
        
        // 2. Try "FirstInitial. LastName" (D. Dingler vs Dillon Dingler)
        if (!match && yahooName.includes('.')) {
            const cleanName = this.cleanYahooName(yahooName); // Keep dots for splitting
            const parts = cleanName.split('.');
            if (parts.length > 1) {
                const initial = parts[0].trim().toLowerCase();
                const lastName = this.normalizeNameForMatching(parts[1]); // Normalize last name
                
                match = players.find(p => {
                    const pNorm = this.normalizeNameForMatching(p.name);
                    // This is tricky because we normalized p.name (removed spaces). 
                    // Let's rely on raw p.name splitting
                    const pParts = p.name.split(' ');
                    const pLast = this.normalizeNameForMatching(pParts[pParts.length - 1]);
                    const pFirst = pParts[0].toLowerCase();
                    
                    return pLast === lastName && pFirst.startsWith(initial);
                });
            }
        }
        
        // 3. Fallback: Check if one name contains the other (for Jazz Chisholm Jr vs Jazz Chisholm)
        if (!match) {
            match = players.find(p => {
                const pNorm = this.normalizeNameForMatching(p.name);
                return pNorm.includes(normYahooName) || normYahooName.includes(pNorm);
            });
        }

        return match;
    },

    /**
     * Clean Yahoo name format (remove position tags)
     */
    cleanYahooName(name) {
        return name
            .replace(/\(Batter\)/i, '')
            .replace(/\(Pitcher\)/i, '')
            .trim();
    },

    /**
     * Normalize name for robust matching
     * Removes accents, suffixes (Jr, Sr), punctuation, and casing
     */
    normalizeNameForMatching(name) {
        return name.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
            .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '') // Remove suffixes
            .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric (spaces, dots, dashes)
            .trim();
    },

    /**
     * Check if a player is taken in a specific league
     */
    isPlayerTaken(player, leagueType = 'roto5x5') {
        const state = this._getState(leagueType);
        const key = `${player.name}|${player.team}|${player.type}`;
        return state.takenPlayers.has(key);
    },
    
    /**
     * Get My Team Stats (H2H 6x6 Support)
     */
    getMyTeamStats(leagueType = 'roto5x5') {
        const state = this._getState(leagueType);
        const stats = {
            count: state.myTeam.length,
            spent: 0,
            hitters: 0, pitchers: 0,
            // Hitting
            r: 0, hr: 0, rbi: 0, sb: 0, 
            avg: 0, ops: 0,
            ab: 0, h: 0, bb_hit: 0,
            // Pitching
            w: 0, k: 0, 
            era: 0, whip: 0,
            qs: 0, nsvh: 0,
            ip: 0, er: 0, bb_pitch: 0, h_pitch: 0
        };

        state.myTeam.forEach(p => {
            stats.spent += (p.cost || 0);

            if (p.type === 'hitter') {
                stats.hitters++;
                stats.r += (p.r || 0);
                stats.hr += (p.hr || 0);
                stats.rbi += (p.rbi || 0);
                stats.sb += (p.sb || 0);
                
                const ab = p.ab || (p.pa ? p.pa * 0.9 : 500);
                const h = p.h || (ab * (p.avg || 0.250));
                
                stats.ab += ab;
                stats.h += h;
                
                const ops = p.ops || 0.750;
                stats.ops += (ops * ab); 

            } else {
                stats.pitchers++;
                stats.w += (p.w || 0);
                stats.k += (p.so || p.k || 0);
                stats.qs += (p.qs || 0);
                stats.nsvh += ((p.sv || 0) + (p.hld || 0));

                const ip = p.ip || 0;
                const er = p.er || (ip * (p.era || 4.00) / 9);
                const walks = p.bb || (ip * (p.bb9 || 3.00) / 9);
                const hits = p.h || (ip * (p.whip || 1.30)) - walks;
                
                stats.ip += ip;
                stats.er += er;
                stats.bb_pitch += walks;
                stats.h_pitch += hits;
            }
        });

        if (stats.ab > 0) {
            stats.avg = stats.h / stats.ab;
            stats.ops = stats.ops / stats.ab;
        }
        
        if (stats.ip > 0) {
            stats.era = (stats.er * 9) / stats.ip;
            stats.whip = (stats.h_pitch + stats.bb_pitch) / stats.ip;
        }

        return stats;
    },

    /**
     * Calculate Market Inflation Statistics
     */
    calculateInflationStats(allPlayers, leagueSettings) {
        if (!allPlayers || allPlayers.length === 0) return null;

        const isH2H = !!leagueSettings.hitterPitcherSplit;
        const leagueType = isH2H ? 'h2h12' : 'roto5x5';
        const state = this._getState(leagueType);

        const teams = leagueSettings.teams || 12;
        const budgetPerTeam = leagueSettings.budget || 260;
        const totalSpots = teams * ((leagueSettings.rosterHitters || 14) + (leagueSettings.rosterPitchers || 9));
        
        const totalMarketMoney = teams * budgetPerTeam;

        const sortedPlayers = [...allPlayers].sort((a, b) => b.dollarValue - a.dollarValue);
        const draftablePool = sortedPlayers.slice(0, totalSpots);
        const totalSystemValue = draftablePool.reduce((sum, p) => sum + Math.max(0, p.dollarValue), 0);

        let moneySpent = 0;
        let valueGone = 0;
        let playersDraftedCount = 0;

        state.draftLog.forEach(pick => {
            moneySpent += (pick.cost || 0);
            const currentPlayer = allPlayers.find(p => p.name === pick.player.name && p.team === pick.player.team);
            const sysValue = currentPlayer ? currentPlayer.dollarValue : (pick.player.dollarValue || 0);
            
            valueGone += Math.max(0, sysValue);
            playersDraftedCount++;
        });

        const moneyRemaining = totalMarketMoney - moneySpent;
        const valueRemaining = totalSystemValue - valueGone;
        
        let inflationRate = 1.0;
        if (valueRemaining > 0) {
            inflationRate = moneyRemaining / valueRemaining;
        }

        return {
            totalMoney: totalMarketMoney,
            totalValue: totalSystemValue,
            moneySpent,
            valueGone,
            moneyRemaining,
            valueRemaining,
            inflationRate,
            draftProgress: playersDraftedCount / totalSpots
        };
    },

    /**
     * Get Scarcity Data (Remaining Players by Position & Tier)
     * Supports dynamic tiers passed via customTiers array.
     */
    getScarcityData(allPlayers, leagueType = 'h2h12', customTiers = null) {
        if (!allPlayers) return {};
        const state = this._getState(leagueType);

        const isH2H = leagueType === 'h2h12';
        
        // Define Tiers (Descending order assumed)
        let tierVals = customTiers;
        if (!tierVals) {
             tierVals = isH2H
                ? [30, 20, 15, 10, 5, 3]
                : [8, 6, 5, 3, 2, 1, 0];
        }

        const scarcity = {};
        // Base positions for both leagues
        const basePositions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'SP', 'RP', 'DH'];
        // Roto specific aggregates
        const rotoExtras = ['CI', 'MI'];
        
        const activePositions = isH2H ? basePositions : [...basePositions, ...rotoExtras];
        
        // Initialize scarcity object
        activePositions.forEach(pos => {
            scarcity[pos] = {};
            for (let i = 0; i < tierVals.length; i++) {
                scarcity[pos]['t' + (i+1)] = 0;
            }
        });

        allPlayers.forEach(p => {
            const uniqueKey = `${p.name}|${p.team}|${p.type}`;
            if (state.takenPlayers.has(uniqueKey)) return;

            // Map Positions
            let posList = [];
            if (Array.isArray(p.positions)) {
                posList = p.positions;
            } else if (typeof p.positions === 'string') {
                posList = p.positions.split(/,|\||\//).map(s => s.trim());
            } else if (typeof p.positionString === 'string') {
                posList = p.positionString.split(/,|\||\//).map(s => s.trim());
            }

            const val = isH2H ? (p.dollarValue || 0) : (parseFloat(p.zTotal) || 0);
            
            // Optimization: Skip if value is below lowest tier
            if (val < tierVals[tierVals.length - 1]) return;

            const qualifiesFor = new Set();
            
            posList.forEach(pos => {
                // 1. Add Specific Position (e.g., LF, CF, 1B)
                if (scarcity[pos]) qualifiesFor.add(pos);
                
                // 2. Handle OF Aggregates (For both leagues)
                if (['LF', 'CF', 'RF'].includes(pos)) qualifiesFor.add('OF');
                
                // 3. Handle Roto-Only Aggregates (CI/MI)
                if (!isH2H) {
                    if (pos === '1B' || pos === '3B') qualifiesFor.add('CI');
                    if (pos === '2B' || pos === 'SS') qualifiesFor.add('MI');
                }
            });

            // Increment counts
            qualifiesFor.forEach(pos => {
                if (scarcity[pos]) {
                    for (let i = 0; i < tierVals.length; i++) {
                        if (val >= tierVals[i]) scarcity[pos]['t' + (i+1)]++;
                    }
                }
            });
        });

        return scarcity;
    }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DraftManager;
}