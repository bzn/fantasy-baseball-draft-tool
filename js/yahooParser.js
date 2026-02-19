/**
 * Fantasy Baseball Draft Tool - Yahoo Position Parser
 * Parses position eligibility data from Yahoo Fantasy player lists
 */

const YahooParser = {
    // Valid MLB team codes (including Yahoo-specific abbreviations)
    VALID_TEAMS: new Set([
        'ARI', 'AZ',   // Arizona Diamondbacks (ARI standard, AZ Yahoo variant)
        'ATL',         // Atlanta Braves
        'BAL',         // Baltimore Orioles
        'BOS',         // Boston Red Sox
        'CHC',         // Chicago Cubs
        'CWS',         // Chicago White Sox
        'CIN',         // Cincinnati Reds
        'CLE',         // Cleveland Guardians
        'COL',         // Colorado Rockies
        'DET',         // Detroit Tigers
        'HOU',         // Houston Astros
        'KC',          // Kansas City Royals
        'LAA',         // Los Angeles Angels
        'LAD',         // Los Angeles Dodgers
        'MIA',         // Miami Marlins
        'MIL',         // Milwaukee Brewers
        'MIN',         // Minnesota Twins
        'NYM',         // New York Mets
        'NYY',         // New York Yankees
        'OAK', 'ATH',  // Oakland Athletics (OAK standard, ATH Yahoo variant)
        'PHI',         // Philadelphia Phillies
        'PIT',         // Pittsburgh Pirates
        'SD',          // San Diego Padres
        'SF',          // San Francisco Giants
        'SEA',         // Seattle Mariners
        'STL',         // St. Louis Cardinals
        'TB',          // Tampa Bay Rays
        'TEX',         // Texas Rangers
        'TOR',         // Toronto Blue Jays
        'WSH', 'WAS'   // Washington Nationals (WSH/WAS variants)
    ]),

    // Valid baseball positions (all uppercase for matching)
    VALID_POSITIONS: new Set([
        'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH', 'UTIL',
        'SP', 'RP', 'P'
    ]),

    // Unified team code normalization map (Yahoo → Standard)
    // This must match the TEAM_CODE_MAP in app.js for consistent matching
    TEAM_NORMALIZE_MAP: {
        // Yahoo-specific codes → Standard
        'AZ': 'ARI',
        'ATH': 'OAK',
        'WAS': 'WSH',

        // Standard codes (no change needed, but listed for clarity)
        'KC': 'KC',        // Not KCR
        'SD': 'SD',        // Not SDP
        'SF': 'SF',        // Not SFG
        'TB': 'TB',        // Not TBR
        'WSH': 'WSH',      // Not WSN
        'CWS': 'CWS'       // Not CHW
    },

    /**
     * Normalize team code to standard abbreviation
     * This ensures Yahoo codes match the same standard as FanGraphs codes
     */
    normalizeTeamCode(team) {
        const upperTeam = team.toUpperCase();
        return this.TEAM_NORMALIZE_MAP[upperTeam] || upperTeam;
    },

    // Accumulated position data
    positionData: {
        players: new Map(), // key: "name|team", value: player object
        stats: {
            hitters: { total: 0, C: 0, '1B': 0, '2B': 0, '3B': 0, SS: 0, OF: 0, LF: 0, CF: 0, RF: 0 },
            pitchers: { total: 0, SP: 0, RP: 0, 'SP,RP': 0 },
            twoWay: 0
        }
    },

    /**
     * Parse raw text from Yahoo Fantasy Players page
     * @param {string} rawText - Raw text copied from Yahoo
     * @returns {Object} Parse result with players and stats
     */
    parse(rawText, debugMode = true) {
        const lines = rawText.trim().split('\n');
        const newPlayers = [];
        const errors = [];

        if (debugMode) {
            console.log('=== Yahoo Parser Debug Mode ===');
            console.log('Total lines to parse:', lines.length);
        }

        let i = 0;
        while (i < lines.length) {
            const result = this.parsePlayerBlock(lines, i, debugMode);
            if (result.player) {
                newPlayers.push(result.player);
                if (debugMode) {
                    console.log(`✓ Parsed player #${newPlayers.length}: ${result.player.name} (${result.player.team}) - ${result.player.positions.join(',')}${result.player.injuryStatus ? ' [' + result.player.injuryStatus + ']' : ''}`);
                }
                i = result.nextIndex;
            } else {
                i++;
            }
        }

        // Add new players to accumulated data
        newPlayers.forEach(player => {
            this.addPlayer(player);
        });

        if (debugMode) {
            console.log(`=== Parse Complete: ${newPlayers.length} new players added ===`);
            console.log('Total accumulated players:', this.positionData.players.size);
        }

        return {
            success: newPlayers.length > 0,
            newCount: newPlayers.length,
            totalPlayers: this.positionData.players.size,
            stats: this.getStats(),
            errors
        };
    },

    /**
     * Parse a single player block from Yahoo data
     */
    parsePlayerBlock(lines, startIndex, debugMode = false) {
        // Look for pattern: Name line, then "TEAM - POSITION" line
        for (let i = startIndex; i < Math.min(startIndex + 10, lines.length); i++) {
            const line = lines[i].trim();

            // Look for team-position pattern: "SEA - C" or "NYY - C,1B" or "DET - SP"
            const teamPosMatch = line.match(/^([A-Z]{2,3})\s*-\s*([A-Z0-9,]+)(?:\s|$)/i);

            if (teamPosMatch) {
                const rawTeam = teamPosMatch[1].toUpperCase();
                const positionsStr = teamPosMatch[2];
                const positions = positionsStr.split(',').map(p => p.trim().toUpperCase());

                if (debugMode) {
                    console.log(`  → Found team-pos pattern at line ${i}: "${line}"`);
                    console.log(`    Team: ${rawTeam}, Positions: ${positions.join(',')}`);
                }

                // Validate team code
                if (!this.VALID_TEAMS.has(rawTeam)) {
                    if (debugMode) console.log(`    ✗ Invalid team code: ${rawTeam}`);
                    continue; // Skip non-MLB team codes
                }

                // Normalize team code for consistency (AZ → ARI, ATH → OAK, etc.)
                const team = this.normalizeTeamCode(rawTeam);

                // Validate all positions
                const validPositions = positions.filter(p => this.VALID_POSITIONS.has(p));
                if (validPositions.length === 0) {
                    if (debugMode) console.log(`    ✗ No valid positions found`);
                    continue; // Skip if no valid positions
                }

                // Find player name (should be a few lines before)
                let playerName = null;
                let rawNameLine = null;
                if (debugMode) console.log(`    Searching for name (lines ${i-1} to ${Math.max(0, i-5)}):`);

                for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
                    const nameLine = lines[j].trim();

                    if (debugMode) console.log(`      Line ${j}: "${nameLine.substring(0, 60)}${nameLine.length > 60 ? '...' : ''}"`);

                    // Skip obvious non-name lines
                    if (!nameLine || nameLine.length < 3 || nameLine.length > 100) {
                        if (debugMode) console.log(`        → Skip (length: ${nameLine.length})`);
                        continue;
                    }

                    if (nameLine.match(/^(FA|W\s*\(|Waivers|NWT|\d+|--|News|Stats|Opp:|Roster Status|GP\*)/i)) {
                        if (debugMode) console.log(`        → Skip (status/number line)`);
                        continue;
                    }

                    if (nameLine.includes(' - ')) {
                        if (debugMode) console.log(`        → Skip (contains ' - ')`);
                        continue;
                    }

                    if (nameLine.match(/^(Player|Roster|Status|Pre-Season|Current|Batters|Pitchers)/i)) {
                        if (debugMode) console.log(`        → Skip (header keyword)`);
                        continue;
                    }

                    // Accept lines with player names (even with suffixes like "No new player Notes")
                    // Clean them using cleanPlayerName
                    const cleaned = this.cleanPlayerName(nameLine);

                    if (debugMode) console.log(`        → Cleaned: "${cleaned}"`);

                    // Validate cleaned name: should have at least 2 words (first and last name)
                    if (cleaned && cleaned.split(' ').length >= 2) {
                        playerName = cleaned;
                        rawNameLine = nameLine;
                        if (debugMode) console.log(`        ✓ ACCEPTED as player name`);
                        break;
                    } else {
                        if (debugMode) console.log(`        → Skip (not 2+ words)`);
                    }
                }

                if (playerName) {
                    const injuryStatus = this.extractInjuryStatus(rawNameLine);
                    const player = {
                        name: playerName,
                        team: team,
                        positions: validPositions,
                        playerType: this.determinePlayerType(validPositions),
                        isPitcherSP: validPositions.includes('SP'),
                        isPitcherRP: validPositions.includes('RP'),
                        injuryStatus: injuryStatus
                    };

                    return { player, nextIndex: i + 1 };
                }
            }
        }

        return { player: null, nextIndex: startIndex + 1 };
    },

    /**
     * Extract injury status from raw Yahoo player name string
     * e.g., "Carlos RodónDTDPlayer Note" → "DTD"
     * e.g., "Reese OlsonIL60Player Note" → "IL60"
     */
    extractInjuryStatus(rawName) {
        const match = rawName.match(/(DTD|IL\d+|SUSP)/);
        return match ? match[1] : '';
    },

    /**
     * Clean player name
     * Uses case-sensitive matching for abbreviations to avoid removing parts of names
     */
    cleanPlayerName(name) {
        return name
            // Remove long phrases (case insensitive - these are safe)
            .replace(/No new player Notes$/i, '')        // "Randy ArozarenaNo new player Notes"
            .replace(/New Player Note$/i, '')            // "Mookie BettsNew Player Note"
            .replace(/Player Note$/i, '')                // "Byron BuxtonPlayer Note"
            .replace(/Contest Eligible Player$/i, '')    // "PlayerNameContest Eligible Player"

            // Remove ALL-CAPS abbreviations ONLY (case sensitive to protect names)
            .replace(/DTD$/, '')                         // "PlayerNameDTD" (must be uppercase)
            .replace(/IL\d+$/, '')                       // "PlayerNameIL10" (must be uppercase IL + digit)
            .replace(/NA$/, '')                          // "PlayerNameNA" (must be uppercase, won't match "Arozarena")
            .replace(/NWT$/, '')                         // "PlayerNameNWT" (must be uppercase)

            // Remove parentheses content
            .replace(/\(Batter\)$/i, '')                 // "Shohei Ohtani (Batter)"
            .replace(/\(Pitcher\)$/i, '')                // "Shohei Ohtani (Pitcher)"

            .trim();
    },

    /**
     * Determine player type from positions
     */
    determinePlayerType(positions) {
        const pitcherPositions = ['SP', 'RP', 'P'];
        const hitterPositions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH', 'Util'];

        const hasPitcher = positions.some(p => pitcherPositions.includes(p));
        const hasHitter = positions.some(p => hitterPositions.includes(p));

        if (hasPitcher && hasHitter) {
            return 'two-way';
        } else if (hasPitcher) {
            return 'pitcher';
        } else {
            return 'hitter';
        }
    },

    /**
     * Add player to accumulated data (handles duplicates and merges positions)
     * Note: Players like Ohtani who have both hitter and pitcher versions
     * are stored separately (hitter-Ohtani and pitcher-Ohtani)
     */
    addPlayer(player) {
        // Use name + team + playerType as key to keep hitter/pitcher versions separate
        const key = this.getPlayerKey(player.name, player.team, player.playerType);
        const existing = this.positionData.players.get(key);

        if (existing) {
            // Merge positions only within same player type
            const allPositions = [...new Set([...existing.positions, ...player.positions])];
            existing.positions = allPositions;
            existing.playerType = this.determinePlayerType(allPositions);
            existing.isPitcherSP = allPositions.includes('SP');
            existing.isPitcherRP = allPositions.includes('RP');
            // Always update injury status (clear old DTD/IL if player is now healthy)
            existing.injuryStatus = player.injuryStatus || '';
        } else {
            this.positionData.players.set(key, { ...player });
        }

        this.updateStats();
    },

    /**
     * Generate player key for matching
     * @param {string} name - Player name
     * @param {string} team - Team code
     * @param {string} playerType - 'hitter' or 'pitcher' (optional, for separating two-way players)
     */
    getPlayerKey(name, team, playerType = null) {
        // Normalize: lowercase, remove periods, apostrophes, hyphens, Jr/Sr, accents, and extra spaces
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

        // Include playerType in key to keep hitter/pitcher versions separate (for Ohtani-type players)
        if (playerType) {
            return `${normalizedName}|${team.toUpperCase()}|${playerType}`;
        }
        return `${normalizedName}|${team.toUpperCase()}`;
    },

    /**
     * Find potential duplicate players (similar names, different keys)
     */
    findPotentialDuplicates() {
        const players = this.getAllPlayers();
        const duplicates = [];

        for (let i = 0; i < players.length; i++) {
            for (let j = i + 1; j < players.length; j++) {
                const p1 = players[i];
                const p2 = players[j];

                // Check if names are similar (same first 5 chars of last name)
                const name1Parts = p1.name.toLowerCase().split(' ');
                const name2Parts = p2.name.toLowerCase().split(' ');

                if (name1Parts.length > 0 && name2Parts.length > 0) {
                    const lastName1 = name1Parts[name1Parts.length - 1].substring(0, 5);
                    const lastName2 = name2Parts[name2Parts.length - 1].substring(0, 5);
                    const firstName1 = name1Parts[0].substring(0, 3);
                    const firstName2 = name2Parts[0].substring(0, 3);

                    if (lastName1 === lastName2 && firstName1 === firstName2) {
                        duplicates.push({
                            player1: `${p1.name} (${p1.team})`,
                            player2: `${p2.name} (${p2.team})`,
                            positions1: p1.positions.join(','),
                            positions2: p2.positions.join(',')
                        });
                    }
                }
            }
        }

        return duplicates;
    },

    /**
     * Update statistics
     */
    updateStats() {
        const stats = {
            hitters: { total: 0, C: 0, '1B': 0, '2B': 0, '3B': 0, SS: 0, OF: 0, LF: 0, CF: 0, RF: 0 },
            pitchers: { total: 0, SP: 0, RP: 0, 'SP,RP': 0 },
            twoWay: 0
        };

        // Track players to detect two-way players (same name+team with both hitter and pitcher entries)
        const playersByNameTeam = new Map();

        this.positionData.players.forEach(player => {
            const baseKey = this.getPlayerKey(player.name, player.team); // without playerType
            if (!playersByNameTeam.has(baseKey)) {
                playersByNameTeam.set(baseKey, []);
            }
            playersByNameTeam.get(baseKey).push(player.playerType);

            if (player.playerType === 'pitcher') {
                stats.pitchers.total++;
                if (player.isPitcherSP && player.isPitcherRP) {
                    stats.pitchers['SP,RP']++;
                } else if (player.isPitcherSP) {
                    stats.pitchers.SP++;
                } else if (player.isPitcherRP) {
                    stats.pitchers.RP++;
                }
            } else {
                stats.hitters.total++;
                player.positions.forEach(pos => {
                    if (stats.hitters.hasOwnProperty(pos)) {
                        stats.hitters[pos]++;
                    }
                    // Count OF variants
                    if (['LF', 'CF', 'RF'].includes(pos)) {
                        stats.hitters.OF++;
                    }
                });
            }
        });

        // Count two-way players (players with both hitter and pitcher entries)
        playersByNameTeam.forEach(types => {
            if (types.includes('hitter') && types.includes('pitcher')) {
                stats.twoWay++;
            }
        });

        this.positionData.stats = stats;
    },

    /**
     * Get current statistics
     */
    getStats() {
        return { ...this.positionData.stats };
    },

    /**
     * Get all players as array
     */
    getAllPlayers() {
        return Array.from(this.positionData.players.values());
    },

    /**
     * Clear all accumulated data
     */
    clear() {
        this.positionData.players.clear();
        this.positionData.stats = {
            hitters: { total: 0, C: 0, '1B': 0, '2B': 0, '3B': 0, SS: 0, OF: 0, LF: 0, CF: 0, RF: 0 },
            pitchers: { total: 0, SP: 0, RP: 0, 'SP,RP': 0 },
            twoWay: 0
        };
    },

    /**
     * Save position data to CSV file via API
     */
    async saveToFile() {
        const players = this.getAllPlayers();

        // Convert positions array to comma-separated string for CSV compatibility
        const playersForExport = players.map(p => ({
            name: p.name,
            team: p.team,
            positions: p.positions.join(','),  // Convert array to string
            playerType: p.playerType,
            isPitcherSP: p.isPitcherSP,
            isPitcherRP: p.isPitcherRP,
            injuryStatus: p.injuryStatus || ''
        }));

        try {
            const response = await fetch('api/save.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'position',
                    players: playersForExport
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to save positions to file:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Load position data from CSV file via API
     * @returns {Promise<boolean>} True if loaded successfully
     */
    async loadFromFile() {
        try {
            const response = await fetch('api/load.php?type=positions');

            if (!response.ok) {
                console.error(`HTTP error loading positions: ${response.status}`);
                return false;
            }

            const result = await response.json();

            if (!result.success) {
                console.error('API returned error:', result.error);
                return false;
            }

            if (!result.players || result.players.length === 0) {
                console.warn('positions.csv is empty or not found');
                return false;
            }

            // Clear existing data
            this.clear();

            // Load each player
            result.players.forEach(player => {
                // Reconstruct player object with proper types
                // Apply cleanPlayerName to strip suffixes like "(Batter)"/"(Pitcher)" from CSV-stored names
                const reconstructedPlayer = {
                    name: this.cleanPlayerName(player.name),
                    team: player.team,
                    positions: Array.isArray(player.positions)
                        ? player.positions
                        : (typeof player.positions === 'string' && player.positions)
                            ? player.positions.split(',').map(p => p.trim()).filter(p => p)
                            : [],
                    playerType: player.playerType || 'hitter',
                    isPitcherSP: player.isPitcherSP === true || player.isPitcherSP === 'true' || player.isPitcherSP === '1',
                    isPitcherRP: player.isPitcherRP === true || player.isPitcherRP === 'true' || player.isPitcherRP === '1',
                    injuryStatus: player.injuryStatus || ''
                };

                this.addPlayer(reconstructedPlayer);
            });

            console.log(`  → Successfully loaded ${result.players.length} position records`);
            return true;

        } catch (error) {
            console.error('Failed to load positions from file:', error);
            return false;
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YahooParser;
}
