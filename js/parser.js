/**
 * Fantasy Baseball Draft Tool - Data Parser
 * Parses raw text copied from FanGraphs projection tables
 */

const Parser = {
    // Valid MLB team codes (including all FanGraphs variants)
    VALID_TEAMS: new Set([
        // Standard codes
        'ARI', 'ATL', 'BAL', 'BOS', 'CHC', 'CIN', 'CLE', 'COL',
        'DET', 'HOU', 'LAA', 'LAD', 'MIA', 'MIL', 'MIN', 'NYM',
        'NYY', 'OAK', 'PHI', 'PIT', 'SEA', 'STL', 'TEX', 'TOR',
        // FanGraphs variants
        'KCR', 'KC',      // Kansas City
        'SDP', 'SD',      // San Diego
        'SFG', 'SF',      // San Francisco
        'TBR', 'TB',      // Tampa Bay
        'WSN', 'WSH',     // Washington
        'CHW', 'CWS',     // Chicago White Sox
        // Yahoo variants
        'AZ', 'ATH', 'WAS'
    ]),

    // Column definitions for different data types
    HITTER_COLUMNS: [
        'rank', 'name', 'team', 'g', 'pa', 'hr', 'r', 'rbi', 'sb',
        'bbPct', 'kPct', 'iso', 'babip', 'avg', 'obp', 'slg', 'woba', 'wrcPlus',
        'bsr', 'off', 'def', 'war'
    ],

    // Fantasy Dashboard format (NEW - most common format)
    HITTER_FANTASY_DASHBOARD: [
        'rank', 'name', 'team', 'g', 'pa', 'ab', 'h', 'doubles', 'triples', 'hr',
        'r', 'rbi', 'bb', 'so', 'hbp', 'sb', 'cs',
        'bbPct', 'kPct', 'iso', 'babip', 'avg', 'obp', 'slg', 'ops', 'woba', 'wrcPlus', 'adp'
    ],

    PITCHER_COLUMNS: [
        'rank', 'name', 'team', 'w', 'l', 'sv', 'g', 'gs', 'ip',
        'k9', 'bb9', 'hr9', 'babip', 'lobPct', 'gbPct', 'era', 'fip', 'war'
    ],

    // Fantasy Dashboard format (NEW - most common format)
    // Matches FanGraphs Fantasy Dashboard exactly
    PITCHER_FANTASY_DASHBOARD: [
        'rank', 'name', 'team', 'gs', 'g', 'ip', 'w', 'l', 'qs', 'sv', 'hld',
        'h', 'er', 'hr', 'so', 'bb', 'k9', 'bb9', 'kbb', 'hr9',
        'avg', 'whip', 'babip', 'lobPct', 'era', 'fip', 'adp'
    ],

    // Alternative pitcher columns (Fantasy view - with HLD)
    PITCHER_FANTASY_COLUMNS: [
        'rank', 'name', 'team', 'w', 'l', 'sv', 'hld', 'g', 'gs', 'ip',
        'k', 'bb', 'era', 'whip', 'k9', 'bb9', 'hr9', 'war'
    ],

    // Detailed pitcher columns (Fantasy view with full stats)
    PITCHER_FANTASY_DETAILED_COLUMNS: [
        'rank', 'name', 'team', 'w', 'l', 'era', 'g', 'gs', 'sv', 'hld', 'bs',
        'ip', 'tbf', 'h', 'r', 'er', 'hr', 'bb', 'ibb', 'hbp', 'so'
    ],

    /**
     * Auto-detect if data is hitter or pitcher based on column content
     * @param {string} rawText - Raw text to analyze
     * @returns {string} 'hitter' or 'pitcher'
     */
    autoDetectDataType(rawText) {
        const lowerText = rawText.toLowerCase();

        // Count hitter-specific indicators
        let hitterScore = 0;
        const hitterIndicators = [
            'pa', 'plate appearances', 'avg', 'ops', 'obp', 'slg', 'wrc+',
            '\trbi\t', '\tsb\t', ' rbi ', ' sb ', '\trbi\n', '\tsb\n'
        ];
        hitterIndicators.forEach(indicator => {
            if (lowerText.includes(indicator)) hitterScore++;
        });

        // Count pitcher-specific indicators (only pitcher-exclusive stats)
        let pitcherScore = 0;
        const pitcherIndicators = [
            'ip', 'innings pitched', 'whip', 'k/9', 'bb/9', 'qs',
            '\tsv\t', '\thld\t', '\ttbf\t', '\ter\t', '\tibb\t',
            ' sv ', ' hld ', ' tbf ', ' er ', ' ibb ',
            '\tsv\n', '\thld\n', '\ttbf\n', '\ter\n', '\tibb\n'
        ];
        pitcherIndicators.forEach(indicator => {
            if (lowerText.includes(indicator)) pitcherScore++;
        });

        // Check header line for strong pitcher indicators
        const lines = rawText.trim().split('\n');
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
            const line = lines[i].toLowerCase().trim();

            // Check for header patterns - very strong indicators
            if (line.includes('name') || line.includes('team')) {
                // This looks like a header line

                // Hitter-only indicators
                if (line.includes('pa') || line.includes('plate')) {
                    hitterScore += 10; // PA only for hitters
                }
                if (line.includes('rbi')) {
                    hitterScore += 10; // RBI only for hitters
                }
                if (line.includes('sb') && !line.includes('bs')) {
                    hitterScore += 10; // SB (stolen bases) only for hitters, but not BS (blown saves)
                }
                if (line.includes('ops') || line.includes('obp')) {
                    hitterScore += 10; // OPS/OBP only for hitters
                }

                // Pitcher-only indicators
                if (line.includes('sv') && line.includes('ip')) {
                    pitcherScore += 10; // Very strong pitcher indicator
                }
                if (line.includes('hld')) {
                    pitcherScore += 10; // HLD only exists for pitchers
                }
                if (line.includes('tbf') || line.includes('batters faced')) {
                    pitcherScore += 10; // TBF only for pitchers
                }
                if (line.includes('whip')) {
                    pitcherScore += 10; // WHIP only for pitchers
                }
            }
        }

        // Additional check: look at first data line values
        for (let i = 0; i < Math.min(lines.length, 15); i++) {
            const line = lines[i].trim();
            if (!line || this.isHeaderLine(line)) continue;

            const values = line.split(/[\t\s]{2,}/).map(v => v.trim()).filter(v => v);

            // Check for AVG-like values (0.200 - 0.400) - strong hitter indicator
            const hasAvgValue = values.some(v => {
                const num = parseFloat(v);
                return num >= 0.150 && num <= 0.450;
            });
            if (hasAvgValue) hitterScore += 3;

            // Check for IP values (20-250) - strong pitcher indicator
            const hasIpValue = values.some(v => {
                const num = parseFloat(v);
                return num >= 15 && num <= 300 && v.includes('.');
            });
            if (hasIpValue) pitcherScore += 3;

            // Check for ERA values (0-10) - pitcher indicator
            const hasEraValue = values.some((v, idx) => {
                const num = parseFloat(v);
                return num >= 0 && num <= 15 && idx > 5; // ERA usually in later columns
            });
            if (hasEraValue) pitcherScore += 2;

            break; // Only check first valid data line
        }

        console.log(`Auto-detect: Hitter score=${hitterScore}, Pitcher score=${pitcherScore}`);

        return pitcherScore > hitterScore ? 'pitcher' : 'hitter';
    },

    /**
     * Detect pitcher data format to choose correct column definition
     * @param {string} rawText - Raw text to analyze
     * @returns {Array} Column definition array
     */
    detectPitcherFormat(rawText) {
        const lowerText = rawText.toLowerCase();

        // Check for key indicators
        const hasHLD = lowerText.includes('hld');
        const hasQS = lowerText.includes('\tqs\t') || lowerText.includes(' qs ');
        const hasTBF = lowerText.includes('tbf');
        const hasBS = lowerText.includes('\tbs\t') || lowerText.includes(' bs ');
        const hasSO = lowerText.includes('\tso\t') || lowerText.includes(' so ') || lowerText.includes('\tso\n');
        const hasKBB = lowerText.includes('k/bb');
        const hasADP = lowerText.includes('adp');
        const hasGS = lowerText.includes('\tgs\t') || lowerText.includes(' gs ');

        // Check header line more carefully
        const lines = rawText.trim().split('\n');
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
            const line = lines[i].toLowerCase();

            // Fantasy Dashboard format (NEW - priority check)
            // Has: GS, G, IP, QS, SV, HLD, K/9, BB/9, K/BB, WHIP, ERA, FIP, ADP
            // User provided format: Name Team GS G IP W L QS SV HLD ...
            // We check for the sequence or presence of key distinct columns
            if ((line.includes('gs') && line.includes('ip') && line.includes('qs') && line.includes('hld')) || 
                (line.includes('gs') && line.includes('qs') && line.includes('k/bb'))) {
                console.log('✓ Detected Fantasy Dashboard format (GS, IP, QS, HLD)');
                return this.PITCHER_FANTASY_DASHBOARD;
            }

            // Detailed fantasy format (has HLD, TBF, SO)
            if (line.includes('sv') && line.includes('hld') && line.includes('so') && hasTBF) {
                console.log('✓ Detected Fantasy Detailed format (with HLD, TBF, SO)');
                return this.PITCHER_FANTASY_DETAILED_COLUMNS;
            }
        }

        // Standard fantasy format (has HLD but not as detailed)
        if (hasHLD && !hasTBF && !hasQS && !hasGS) {
            console.log('✓ Detected Fantasy format (with HLD)');
            return this.PITCHER_FANTASY_COLUMNS;
        }

        // Default to dashboard format if GS is present, as it's the most common projection format
        if (hasGS || (hasQS && hasHLD)) {
            console.log('✓ Detected Dashboard format (fallback to Fantasy Dashboard)');
            return this.PITCHER_FANTASY_DASHBOARD;
        }

        // Fallback
        console.log('✓ Detected Standard format (fallback)');
        return this.PITCHER_COLUMNS;
    },

    /**
     * Detect hitter data format to choose correct column definition
     * @param {string} rawText - Raw text to analyze
     * @returns {Array} Column definition array
     */
    detectHitterFormat(rawText) {
        const lowerText = rawText.toLowerCase();

        // Check for Fantasy Dashboard indicators
        const hasAB = lowerText.includes('\tab\t') || lowerText.includes(' ab ');
        const hasDoubles = lowerText.includes('\t2b\t') || lowerText.includes(' 2b ');
        const hasTriples = lowerText.includes('\t3b\t') || lowerText.includes(' 3b ');
        const hasCS = lowerText.includes('\tcs\t') || lowerText.includes(' cs ');
        const hasADP = lowerText.includes('adp');

        // Check header line
        const lines = rawText.trim().split('\n');
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
            const line = lines[i].toLowerCase();

            // Fantasy Dashboard format (NEW)
            // Has: G, PA, AB, H, 2B, 3B, HR, R, RBI, BB, SO, SB, CS, OPS, wOBA, wRC+, ADP
            if (hasAB && hasDoubles && hasTriples && hasCS && hasADP) {
                console.log('✓ Detected Hitter Fantasy Dashboard format (AB, 2B, 3B, CS, ADP)');
                return this.HITTER_FANTASY_DASHBOARD;
            }
        }

        // Default to standard dashboard format
        console.log('✓ Detected Hitter Dashboard format');
        return this.HITTER_COLUMNS;
    },

    /**
     * Parse raw text data from FanGraphs
     * @param {string} rawText - Raw text copied from FanGraphs table
     * @param {string} dataType - 'hitter', 'pitcher', or 'auto' for auto-detection
     * @returns {Object} Parsed data with players array and metadata
     */
    parse(rawText, dataType = 'auto') {
        // Track if auto-detection was used
        const wasAutoDetected = (dataType === 'auto' || !dataType);

        // Auto-detect if needed
        if (wasAutoDetected) {
            dataType = this.autoDetectDataType(rawText);
            console.log(`✓ Auto-detected data type: ${dataType}`);
        }

        const lines = rawText.trim().split('\n');
        const players = [];
        const errors = [];

        // Choose column definition based on data type and format
        let columns;
        if (dataType === 'hitter') {
            // Detect hitter format (Fantasy Dashboard vs regular Dashboard)
            columns = this.detectHitterFormat(rawText);
        } else {
            // For pitchers, detect which format is being used
            columns = this.detectPitcherFormat(rawText);
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines and header-like lines
            if (!line || this.isHeaderLine(line)) {
                continue;
            }

            try {
                const player = this.parseLine(line, columns, dataType);
                if (player) {
                    players.push(player);
                }
            } catch (e) {
                errors.push({ line: i + 1, text: line.substring(0, 50), error: e.message });
            }
        }

        return {
            success: players.length > 0,
            dataType,
            autoDetected: wasAutoDetected,
            players,
            count: players.length,
            errors,
            timestamp: new Date().toISOString()
        };
    },

    /**
     * Check if a line is a header or non-data line
     */
    isHeaderLine(line) {
        const headerPatterns = [
            /^#\s+Name\s+Team/i,
            /^Player/i,
            /^ZiPS/i,
            /^Steamer/i,
            /^Updated:/i,
            /^\d+\s+of\s+\d+/i,
            /^Page Size/i,
            /results$/i,
            /^Dashboard/i,
            /^Standard/i,
            /^Advanced/i,
            /^Fantasy/i,
            /^Data Export/i,
            /FanGraphs/i,
            /copyright/i
        ];

        return headerPatterns.some(pattern => pattern.test(line));
    },

    /**
     * Parse a single line of player data
     */
    parseLine(line, columns, dataType) {
        // Split by tabs (preserve empty columns)
        let values = line.split(/\t/);

        // If tab split doesn't work well (e.g. spaces used), try splitting by multiple spaces
        // But be careful: strict tab splitting is safer for empty columns
        if (values.length < 5) {
            values = line.split(/\s{2,}/);
        }

        // Clean up values but keep empty strings for index alignment
        values = values.map(v => v.trim());

        // Need at least rank, name, team
        if (values.length < 3) {
            return null;
        }

        // Check if first value is a valid rank number
        const rank = parseInt(values[0]);
        if (isNaN(rank) || rank <= 0) {
            return null;
        }

        const player = { type: dataType };

        // Map values to columns
        for (let i = 0; i < Math.min(values.length, columns.length); i++) {
            let col = columns[i];
            let value = values[i];

            // Column name mapping (normalize FanGraphs names to internal names)
            const columnMap = {
                'doubles': '2b',      // FanGraphs uses 2B
                'triples': '3b',      // FanGraphs uses 3B
                'kbb': 'k/bb',        // FanGraphs uses K/BB
                'wrcPlus': 'wrc+'     // FanGraphs uses wRC+
            };

            // Reverse lookup: if we expect 'doubles' but FanGraphs gives '2b'
            // (this shouldn't happen, but handle it anyway)
            const reverseMap = Object.fromEntries(
                Object.entries(columnMap).map(([k, v]) => [v, k])
            );

            // Use mapped name if exists
            col = reverseMap[col] || col;

            // Parse based on column type
            if (col === 'name' || col === 'team') {
                player[col] = value;
            } else if (col.endsWith('Pct') || col === 'lobPct' || col === 'gbPct') {
                // Percentage columns - remove % and convert to decimal
                player[col] = this.parsePercentage(value);
            } else if (col === 'avg' || col === 'obp' || col === 'slg' || col === 'ops' || col === 'iso' ||
                       col === 'babip' || col === 'woba' || col === 'era' || col === 'whip' || col === 'fip') {
                // Decimal stats
                player[col] = this.parseFloat(value);
            } else {
                // Integer or other numeric values
                player[col] = this.parseNumber(value);
            }
        }

        // Validate and fix team code (handles empty or invalid team fields from FanGraphs)
        if (!player.team || !this.VALID_TEAMS.has(player.team.toUpperCase())) {
            console.warn(`⚠️ Invalid team code for ${player.name}: "${player.team}" - marking as UNKNOWN`);
            player.teamOriginal = player.team; // Preserve original value for debugging
            player.team = 'UNKNOWN';          // Mark as unknown team
            player.hasInvalidTeam = true;     // Flag for special handling
        }

        // Calculate derived stats
        if (dataType === 'hitter') {
            this.calculateHitterDerived(player);
        } else {
            this.calculatePitcherDerived(player);
        }

        return player;
    },

    /**
     * Calculate derived stats for hitters
     */
    calculateHitterDerived(player) {
        // Calculate OPS if we have OBP and SLG
        if (player.obp !== undefined && player.slg !== undefined) {
            player.ops = parseFloat((player.obp + player.slg).toFixed(3));
        }
    },

    /**
     * Calculate derived stats for pitchers
     */
    calculatePitcherDerived(player) {
        // === Handle SO/K (Strikeouts) ===
        if (player.so !== undefined) {
            // New format has SO directly
            player.k = player.so; // Alias
        } else if (player.k9 !== undefined && player.ip !== undefined) {
            // Old format - calculate from K/9
            player.k = Math.round(player.k9 * player.ip / 9);
            player.so = player.k; // Alias
        }

        // === Handle BB (Walks) ===
        if (player.bb9 !== undefined && player.bb === undefined && player.ip !== undefined) {
            // Old format - calculate from BB/9
            player.bb = Math.round(player.bb9 * player.ip / 9);
        }

        // === Handle Rate Stats (K/9, BB/9, HR/9) ===
        // If new format has SO/BB/HR but not rate stats, calculate them
        if (player.ip !== undefined && player.ip > 0) {
            if (player.k9 === undefined && player.so !== undefined) {
                player.k9 = parseFloat((player.so * 9 / player.ip).toFixed(2));
            }
            if (player.bb9 === undefined && player.bb !== undefined) {
                player.bb9 = parseFloat((player.bb * 9 / player.ip).toFixed(2));
            }
            if (player.hr9 === undefined && player.hr !== undefined) {
                player.hr9 = parseFloat((player.hr * 9 / player.ip).toFixed(2));
            }
        }

        // === Handle WHIP ===
        if (player.whip === undefined && player.ip !== undefined) {
            if (player.h !== undefined && player.bb !== undefined) {
                // New format has H - calculate accurate WHIP
                player.whip = parseFloat(((player.h + player.bb) / player.ip).toFixed(2));
            } else if (player.bb !== undefined && player.babip !== undefined && player.era !== undefined) {
                // Old format - rough estimate
                const estimatedHits = player.ip * (player.babip / 0.300) * 0.9;
                player.whip = parseFloat(((estimatedHits + player.bb) / player.ip).toFixed(2));
            }
        }

        // === Handle QS (Quality Starts) ===
        if (player.qs === undefined && player.gs !== undefined && player.gs > 0 && player.era !== undefined && player.ip !== undefined) {
            const ipPerStart = player.ip / player.gs;
            let qsRate;
            if (ipPerStart >= 6.0 && player.era <= 3.00) {
                qsRate = 0.75;
            } else if (ipPerStart >= 5.5 && player.era <= 3.50) {
                qsRate = 0.60;
            } else if (ipPerStart >= 5.0 && player.era <= 4.00) {
                qsRate = 0.45;
            } else if (ipPerStart >= 4.5 && player.era <= 4.50) {
                qsRate = 0.30;
            } else {
                qsRate = 0.15;
            }
            player.qs = Math.round(player.gs * qsRate);
        }

        // === Handle NSVH (Saves + Holds) ===
        if (player.sv !== undefined) {
            if (player.hld !== undefined && player.hld > 0) {
                // New format with HLD - calculate accurate NSVH
                player.nsvh = player.sv + player.hld;
            } else {
                // Old format without HLD - use SV only
                player.nsvh = player.sv;
                if (player.hld === undefined) {
                    player.hld = 0; // Placeholder
                }
            }
        }
    },

    /**
     * Parse percentage string to decimal
     */
    parsePercentage(value) {
        if (typeof value === 'string') {
            value = value.replace('%', '').trim();
        }
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num / 100;
    },

    /**
     * Parse float value
     */
    parseFloat(value) {
        if (typeof value === 'string') {
            value = value.replace(/[^\d.-]/g, '');
        }
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    },

    /**
     * Parse number (int or float)
     */
    parseNumber(value) {
        if (typeof value === 'string') {
            value = value.replace(/[^\d.-]/g, '');
        }
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    },

    /**
     * Convert parsed data to CSV format
     */
    toCSV(data) {
        if (!data.players || data.players.length === 0) {
            return '';
        }

        const columns = data.dataType === 'hitter'
            ? ['rank', 'name', 'team', 'g', 'pa', 'hr', 'r', 'rbi', 'sb', 'avg', 'obp', 'slg', 'ops', 'war']
            : ['rank', 'name', 'team', 'w', 'l', 'sv', 'hld', 'gs', 'ip', 'k', 'era', 'whip', 'qs', 'nsvh', 'war'];

        const header = columns.join(',');
        const rows = data.players.map(player => {
            return columns.map(col => {
                const value = player[col];
                if (typeof value === 'string' && value.includes(',')) {
                    return `"${value}"`;
                }
                return value !== undefined ? value : '';
            }).join(',');
        });

        return [header, ...rows].join('\n');
    },

    /**
     * Save parsed data to CSV file via API
     * @param {Object} data - Parsed data object
     * @returns {Promise} API response
     */
    async saveToFile(data) {
        const payload = {
            type: data.dataType,
            players: data.players
        };

        try {
            const response = await fetch('api/save.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Failed to save to file:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Load data from CSV file via API
     * @param {string} dataType - 'hitter' or 'pitcher'
     * @returns {Promise<Object>} Parsed data object or null
     */
    async loadFromFile(dataType) {
        const type = dataType === 'hitter' ? 'hitters' : 'pitchers';

        try {
            const response = await fetch(`api/load.php?type=${type}`);
            const result = await response.json();

            if (result.success && result.players.length > 0) {
                return {
                    dataType: dataType,
                    players: result.players,
                    count: result.count,
                    success: true,
                    autoDetected: false,
                    errors: []
                };
            }

            return null;
        } catch (error) {
            console.error(`Failed to load ${type} from file:`, error);
            return null;
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Parser;
}
