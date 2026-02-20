/**
 * Fantasy Baseball Draft Tool - Draft Manager
 * Handles live draft tracking, parsing Yahoo draft logs, and managing team state.
 * Single active league state (no more dual roto5x5/h2h12).
 */

const DraftManager = {
    // Single state for active league
    state: {
        myTeamName: 'bluezhin',
        takenPlayers: new Set(), // Set of player keys (name|team|type)
        myTeam: [], // Array of player objects
        draftLog: [], // History of picks
        lastProcessedText: ''
    },

    /**
     * Initialize Draft Manager
     */
    init() {
        this.loadState();
    },

    /**
     * Load state from localStorage
     */
    loadState() {
        const stored = localStorage.getItem('fantasy_draft_state_v3');
        if (stored) {
            const data = JSON.parse(stored);
            this.state = {
                ...data,
                takenPlayers: new Set(data.takenPlayers || [])
            };
        } else {
            // Migration from v2 (dual state) if exists
            const oldStored = localStorage.getItem('fantasy_draft_state_v2');
            if (oldStored) {
                const oldData = JSON.parse(oldStored);
                // Pick whichever league had data
                const source = (oldData.h2h12 && oldData.h2h12.draftLog && oldData.h2h12.draftLog.length > 0)
                    ? oldData.h2h12
                    : (oldData.roto5x5 || {});
                this.state = {
                    myTeamName: source.myTeamName || 'bluezhin',
                    takenPlayers: new Set(source.takenPlayers || []),
                    myTeam: source.myTeam || [],
                    draftLog: source.draftLog || [],
                    lastProcessedText: source.lastProcessedText || ''
                };
            } else {
                // Migration from v1
                const v1Stored = localStorage.getItem('fantasy_draft_state');
                if (v1Stored) {
                    const v1Data = JSON.parse(v1Stored);
                    this.state = {
                        myTeamName: v1Data.myTeamName || 'bluezhin',
                        takenPlayers: new Set(v1Data.takenPlayers || []),
                        myTeam: v1Data.myTeam || [],
                        draftLog: v1Data.draftLog || [],
                        lastProcessedText: ''
                    };
                }
            }
        }
    },

    /**
     * Save state to localStorage
     */
    saveState() {
        const data = {
            ...this.state,
            takenPlayers: Array.from(this.state.takenPlayers)
        };
        localStorage.setItem('fantasy_draft_state_v3', JSON.stringify(data));
    },

    /**
     * Set user's team name
     * @param {string} name
     */
    setTeamName(name) {
        this.state.myTeamName = name;
        this.saveState();
    },

    /**
     * Clear all draft history
     */
    clearDraft() {
        this.state.takenPlayers.clear();
        this.state.myTeam = [];
        this.state.draftLog = [];
        this.state.lastProcessedText = '';
        this.saveState();
        return true;
    },

    /**
     * Process draft log text pasted from Yahoo
     * @param {string} text - Raw text from Yahoo Draft interface
     * @param {Array} allPlayers - Master list of all players (hitters + pitchers)
     */
    processDraftLog(text, allPlayers) {
        if (!text || !text.trim()) return { success: false, message: 'Empty text' };

        const savedTeamName = this.state.myTeamName;
        this.state.lastProcessedText = text;
        const lines = text.trim().split('\n');

        // Clear existing state before reprocessing (full paste = source of truth)
        this.state.takenPlayers.clear();
        this.state.myTeam = [];
        this.state.draftLog = [];
        this.state.myTeamName = savedTeamName; // Preserve team name

        // 0. Attempt to auto-detect team name (only if current name is default/empty)
        const isDefaultName = !savedTeamName || savedTeamName === 'bluezhin';
        if (isDefaultName) {
            const detectedName = this.detectTeamName(lines);
            if (detectedName) {
                this.state.myTeamName = detectedName;
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
                        matched = true;
                    }
                }
            }

            if (matched) {
                // If manager is detected, check if it's me
                let isMyPick = false;
                if (manager && this.state.myTeamName) {
                    const managerLower = manager.toLowerCase().trim();
                    const myNameLower = this.state.myTeamName.toLowerCase().trim();
                    const namePattern = new RegExp('^' + myNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)', 'i');
                    isMyPick = managerLower === myNameLower || namePattern.test(managerLower);
                }

                this.markPlayerAsTaken(rawName, teamCode, allPlayers, isMyPick, pickNum, cost);
                processedCount++;
            }
        }

        // 2. Process "My Team" section (Fallback only if no picks matched via Draft Results)
        if (this.state.myTeam.length === 0) {
            const myTeamIndex = lines.findIndex(l => l.includes('My Team') && l.includes('of'));
            if (myTeamIndex !== -1) {
                this.parseMyTeamSection(lines, myTeamIndex + 1, allPlayers);
            }
        }

        this.saveState();
        return { success: true, count: this.state.takenPlayers.size };
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
    parseMyTeamSection(lines, startIndex, allPlayers) {
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

                    if (!this.state.takenPlayers.has(uniqueKey)) {
                        this.state.takenPlayers.add(uniqueKey);
                    }

                    if (!this.state.myTeam.some(p => p.name === player.name && p.team === player.team)) {
                        this.state.myTeam.push(player);
                    }
                }
            }
        }
    },

    /**
     * Mark a player as taken
     */
    markPlayerAsTaken(name, team, allPlayers, isMyTeam, pickNum = null, cost = 0) {
        const player = this.findPlayerInMasterList(name, team, allPlayers);

        if (player) {
            const uniqueKey = `${player.name}|${player.team}|${player.type}`;

            if (!this.state.takenPlayers.has(uniqueKey)) {
                this.state.takenPlayers.add(uniqueKey);
                this.state.draftLog.push({
                    pick: pickNum,
                    player: player,
                    isMyTeam: isMyTeam,
                    cost: cost
                });
            }

            if (isMyTeam) {
                 const alreadyInTeam = this.state.myTeam.some(p => p.name === player.name && p.team === player.team && p.type === player.type);
                 if (!alreadyInTeam) {
                     this.state.myTeam.push({
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
        const players = Array.isArray(allPlayers) ? allPlayers : [];

        // --- SPECIAL HANDLING: SHOHEI OHTANI ---
        if (yahooName.includes('Ohtani')) {
            let targetType = null;
            if (yahooName.includes('(Batter)') || yahooName.includes('Util')) targetType = 'hitter';
            else if (yahooName.includes('(Pitcher)') || yahooName.includes('SP')) targetType = 'pitcher';

            if (targetType) {
                const match = players.find(p => p.name.includes('Ohtani') && p.type === targetType);
                if (match) return match;
            }
        }

        const normYahooName = this.normalizeNameForMatching(this.cleanYahooName(yahooName));

        // 1. Try Exact Normalized Match
        let match = players.find(p => this.normalizeNameForMatching(p.name) === normYahooName);

        // 2. Try "FirstInitial. LastName" (D. Dingler vs Dillon Dingler)
        if (!match && yahooName.includes('.')) {
            const cleanName = this.cleanYahooName(yahooName);
            const parts = cleanName.split('.');
            if (parts.length > 1) {
                const initial = parts[0].trim().toLowerCase();
                const lastName = this.normalizeNameForMatching(parts[1]);

                match = players.find(p => {
                    const pParts = p.name.split(' ');
                    const pLast = this.normalizeNameForMatching(pParts[pParts.length - 1]);
                    const pFirst = pParts[0].toLowerCase();

                    return pLast === lastName && pFirst.startsWith(initial);
                });
            }
        }

        // 3. Fallback: Check if one name contains the other
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
     * Check if a player is taken
     */
    isPlayerTaken(player) {
        const key = `${player.name}|${player.team}|${player.type}`;
        return this.state.takenPlayers.has(key);
    },

    /**
     * Get My Team Stats
     */
    getMyTeamStats() {
        const stats = {
            count: this.state.myTeam.length,
            spent: 0,
            hitters: 0, pitchers: 0,
            // Hitting
            r: 0, hr: 0, rbi: 0, sb: 0,
            avg: 0, ops: 0,
            ab: 0, h: 0, bb_hit: 0,
            // Pitching
            w: 0, k: 0,
            era: 0, whip: 0,
            qs: 0, nsvh: 0, sv: 0,
            ip: 0, er: 0, bb_pitch: 0, h_pitch: 0
        };

        this.state.myTeam.forEach(p => {
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
                stats.sv += (p.sv || 0);
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
     * @param {Array} allPlayers - All combined players
     * @param {Object} leagueSettings - Active league settings
     */
    calculateInflationStats(allPlayers, leagueSettings) {
        if (!allPlayers || allPlayers.length === 0) return null;

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

        this.state.draftLog.forEach(pick => {
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
     * @param {Array} allPlayers - All combined players
     * @param {string} scoringType - 'roto' or 'head' (for position list)
     * @param {Array} customTiers - Tier thresholds
     */
    getScarcityData(allPlayers, scoringType = 'roto', customTiers = null) {
        if (!allPlayers) return {};

        const isH2H = scoringType === 'head';
        const isAuction = App.leagueSettings.active.draftType === 'auction';

        // Define Tiers (Descending order assumed)
        let tierVals = customTiers;
        if (!tierVals) {
             tierVals = isAuction
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
            if (this.state.takenPlayers.has(uniqueKey)) return;

            // Map Positions
            let posList = [];
            if (Array.isArray(p.positions)) {
                posList = p.positions;
            } else if (typeof p.positions === 'string') {
                posList = p.positions.split(/,|\||\//).map(s => s.trim());
            } else if (typeof p.positionString === 'string') {
                posList = p.positionString.split(/,|\||\//).map(s => s.trim());
            }

            const val = isAuction ? (p.dollarValue || 0) : (parseFloat(p.zTotal) || 0);

            // Optimization: Skip if value is below lowest tier
            if (val < tierVals[tierVals.length - 1]) return;

            const qualifiesFor = new Set();

            posList.forEach(pos => {
                if (scarcity[pos]) qualifiesFor.add(pos);
                if (['LF', 'CF', 'RF'].includes(pos)) qualifiesFor.add('OF');
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
