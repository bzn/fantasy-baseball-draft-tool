/**
 * Fantasy Baseball Draft Tool - Value Calculator
 * Calculates Z-scores and player values
 */

const Calculator = {
    // League configurations
    LEAGUES: {
        roto5x5: {
            name: 'Roto 5x5',
            hitting: ['r', 'hr', 'rbi', 'sb', 'avg'],
            pitching: ['w', 'sv', 'k', 'era', 'whip'],
            invertedStats: ['era', 'whip'],
            hittingCount: 5,
            pitchingCount: 5
        },
        h2h12: {
            name: 'H2H 6x6',
            hitting: ['r', 'hr', 'rbi', 'sb', 'avg', 'ops'],
            pitching: ['w', 'k', 'era', 'whip', 'qs', 'nsvh'],  // Using 'k' as alias for SO
            invertedStats: ['era', 'whip'],
            hittingCount: 6,
            pitchingCount: 6
        }
    },

    // Volume adjustment configuration for rate stats and K/9 efficiency
    // Rate stats from low-volume players are scaled down; K/9 efficiency provides a bonus to K value
    VOLUME_CONFIG: {
        hitter: {
            rateStats: ['avg', 'ops'],  // Stats where low PA inflates Z-scores
            volumeKey: 'pa'
        },
        pitcher: {
            rateStats: ['era', 'whip'],  // Stats where low IP inflates Z-scores
            volumeKey: 'ip',
            efficiencyBonus: {
                targetCat: 'k',   // Apply bonus to K/SO category
                rateKey: 'k9',    // K/9 rate stat
                factor: 0.2       // 20% of K/9 Z-score added as bonus
            }
        }
    },

    /**
     * Calculate Z-scores for all players with volume adjustments
     * - Rate stats (AVG, OPS, ERA, WHIP) are scaled by playing time volume
     * - Pitcher K category gets a K/9 efficiency bonus (rewards IP-efficient K production)
     * @param {Array} players - Array of player objects
     * @param {string} leagueType - League configuration key
     * @param {string} playerType - 'hitter' or 'pitcher'
     * @param {Object} weights - Optional category weights (key: category, value: multiplier)
     * @param {number} draftableCount - Number of players to use for baseline calculation (0 = use all)
     * @returns {Array} Players with Z-scores added
     */
    calculateZScores(players, leagueType = 'h2h12', playerType = 'hitter', weights = {}, draftableCount = 0) {
        if (!players || players.length === 0) return [];

        const league = this.LEAGUES[leagueType];
        const categories = playerType === 'hitter' ? league.hitting : league.pitching;
        const volConfig = this.VOLUME_CONFIG[playerType];

        // --- Helper to calculate stats for a specific pool of players ---
        const calculatePoolStats = (pool) => {
            const poolStats = {};
            categories.forEach(cat => {
                const values = pool
                    .map(p => this.getStatValue(p, cat))
                    .filter(v => v !== null && !isNaN(v));

                if (values.length > 0) {
                    poolStats[cat] = {
                        mean: this.mean(values),
                        stdDev: this.stdDev(values),
                        isInverted: league.invertedStats.includes(cat)
                    };
                }
            });
            return poolStats;
        };

        // --- Pass 1: Preliminary Calculation (using all players) ---
        // We need this to identify who the "Top N" players are
        let baselineStats = calculatePoolStats(players);

        // Calculate prelim Z-scores to sort players
        const prelimPlayers = players.map(player => {
            let zTotal = 0;
            categories.forEach(cat => {
                const value = this.getStatValue(player, cat);
                const catStats = baselineStats[cat];
                const weight = weights[cat] !== undefined ? weights[cat] : 1.0;

                if (value !== null && !isNaN(value) && catStats && catStats.stdDev > 0) {
                    let z = (value - catStats.mean) / catStats.stdDev;
                    if (catStats.isInverted) z = -z;
                    zTotal += (z * weight);
                }
            });
            return { ...player, zTotal };
        });

        // --- Pass 2: Baseline Calibration (using Top N players) ---
        let baselinePool = prelimPlayers;
        if (draftableCount > 0 && draftableCount < players.length) {
            // Sort by prelim Z-total and take top N
            baselinePool = prelimPlayers
                .sort((a, b) => b.zTotal - a.zTotal)
                .slice(0, draftableCount);

            // Recalculate stats using only the top players
            baselineStats = calculatePoolStats(baselinePool);
        }

        // --- Pass 2.5: Volume & Efficiency Baselines ---
        // Calculate mean volume (PA or IP) from the baseline pool for rate stat scaling
        let meanVolume = 0;
        let efficiencyStats = null; // K/9 mean/stdDev for efficiency bonus

        if (volConfig) {
            const volumeValues = baselinePool
                .map(p => parseFloat(p[volConfig.volumeKey]))
                .filter(v => !isNaN(v) && v > 0);
            if (volumeValues.length > 0) {
                meanVolume = this.mean(volumeValues);
            }

            // Calculate K/9 baseline stats for efficiency bonus (pitchers only)
            if (volConfig.efficiencyBonus) {
                const rateKey = volConfig.efficiencyBonus.rateKey;
                const rateValues = baselinePool
                    .map(p => parseFloat(p[rateKey]))
                    .filter(v => !isNaN(v));
                if (rateValues.length > 1) {
                    efficiencyStats = {
                        mean: this.mean(rateValues),
                        stdDev: this.stdDev(rateValues)
                    };
                }
            }
        }

        // --- Pass 3: Final Calculation (apply baseline + volume adjustments) ---
        return players.map(player => {
            const zScores = {};
            let zTotal = 0;
            let validCategories = 0;

            // Player's volume for rate stat scaling
            // Use sqrt dampening so low-volume pitchers aren't penalized too harshly
            // e.g., 50% of mean IP → factor 0.71 (instead of 0.50 with linear)
            const playerVolume = volConfig ? parseFloat(player[volConfig.volumeKey]) || 0 : 0;
            const volumeFactor = (meanVolume > 0 && playerVolume > 0)
                ? Math.min(1.0, Math.sqrt(playerVolume / meanVolume))
                : 1.0;

            categories.forEach(cat => {
                const value = this.getStatValue(player, cat);
                const catStats = baselineStats[cat];
                const weight = weights[cat] !== undefined ? weights[cat] : 1.0;

                if (value !== null && !isNaN(value) && catStats && catStats.stdDev > 0) {
                    let z = (value - catStats.mean) / catStats.stdDev;

                    // Invert for ERA, WHIP (lower is better)
                    if (catStats.isInverted) {
                        z = -z;
                    }

                    // Volume scaling for rate stats (AVG, OPS, ERA, WHIP)
                    // Low-volume players get their rate stat Z-scores reduced
                    if (volConfig && volConfig.rateStats.includes(cat)) {
                        z = z * volumeFactor;
                    }

                    // K/9 efficiency bonus for K category (pitchers only)
                    // Rewards pitchers who produce high K per IP consumed
                    if (volConfig && volConfig.efficiencyBonus &&
                        cat === volConfig.efficiencyBonus.targetCat && efficiencyStats &&
                        efficiencyStats.stdDev > 0) {
                        const rateKey = volConfig.efficiencyBonus.rateKey;
                        const rateVal = parseFloat(player[rateKey]);
                        if (!isNaN(rateVal)) {
                            const k9z = (rateVal - efficiencyStats.mean) / efficiencyStats.stdDev;
                            z += k9z * volConfig.efficiencyBonus.factor;
                        }
                    }

                    // Store adjusted Z-score
                    zScores[`z_${cat}`] = parseFloat(z.toFixed(2));

                    // Add weighted Z-score to total
                    zTotal += (z * weight);
                    validCategories++;
                } else {
                    zScores[`z_${cat}`] = 0;
                }
            });

            return {
                ...player,
                ...zScores,
                zTotal: parseFloat(zTotal.toFixed(2)),
                zAvg: validCategories > 0 ? parseFloat((zTotal / validCategories).toFixed(2)) : 0
            };
        });
    },

    /**
     * Get stat value from player, handling aliases
     */
    getStatValue(player, stat) {
        // Handle stat aliases
        const aliases = {
            'so': ['so', 'k'],
            'k': ['k', 'so'],
            'nsvh': ['nsvh', 'sv'] // Fallback to SV if NSVH not available
        };

        if (aliases[stat]) {
            for (const alias of aliases[stat]) {
                if (player[alias] !== undefined) {
                    return player[alias];
                }
            }
        }

        return player[stat];
    },

    /**
     * Calculate dollar values based on Z-scores using a non-linear (exponential) curve
     * to prevent mid-tier inflation and reward elite players.
     * @param {Array} players - Array of players with Z-scores
     * @param {number} budget - Total auction budget for this group
     * @param {number} teamCount - Number of teams
     * @param {number} rosterSize - Number of active roster spots for this group
     * @returns {Array} Players with dollar values added
     */
    calculateDollarValues(players, budget, teamCount, rosterSize) {
        if (!players || players.length === 0) return [];

        // Sort by Z-total descending
        const sortedPlayers = [...players].sort((a, b) => b.zTotal - a.zTotal);

        // Determine number of draftable players
        const totalDraftable = teamCount * rosterSize;
        
        // Find replacement level player (the last draftable player)
        // If not enough players, use the last one
        const replacementIndex = Math.min(totalDraftable - 1, sortedPlayers.length - 1);
        const replacementPlayer = sortedPlayers[replacementIndex];
        
        // Replacement level Z-score (floor at 0 to avoid negative values boosting prices)
        // actually, replacement Z can be negative, that's fine.
        const replacementZ = replacementPlayer ? replacementPlayer.zTotal : 0;

        // Calculate total "Adjusted Points" above replacement
        // We use an exponential curve to reward elite players
        // Curve factor: 1.0 = Linear, > 1.0 = Exponential (favor stars)
        // 1.25 = steeper curve, top players more expensive, tail cheaper
        const EXPONENT = 1.25;

        let totalAdjustedPoints = 0;
        
        const playersWithPoints = sortedPlayers.map(player => {
            // Raw difference from replacement
            let zDiff = player.zTotal - replacementZ;
            
            // Only consider positive value above replacement
            if (zDiff < 0) zDiff = 0;

            // Apply exponential curve
            // We use Math.pow but preserve the scale
            const adjustedPoints = Math.pow(zDiff, EXPONENT);

            totalAdjustedPoints += adjustedPoints;

            return {
                ...player,
                _adjustedPoints: adjustedPoints // Store for calculation
            };
        });

        // Calculate price per adjusted point
        // Total Budget = (TeamCount * BudgetPerTeam * Split%) - ($1 * TotalDraftable)
        // We assume $1 minimum bid for every draftable slot, so we distribute the *surplus*
        // Actually the `budget` passed in is the TOTAL pool (e.g. $260 * 12 * 0.65)
        // We should reserve $1 for every player first.
        const minimumBidTotal = totalDraftable * 1;
        const distributeableBudget = Math.max(0, budget - minimumBidTotal);
        
        const pricePerPoint = totalAdjustedPoints > 0 ? distributeableBudget / totalAdjustedPoints : 0;

        // Assign dollar values
        return playersWithPoints.map(player => {
            let dollarValue = 0;
            
            // If player provides value above replacement
            if (player._adjustedPoints > 0) {
                // Base $1 + Surplus Value
                dollarValue = 1 + (player._adjustedPoints * pricePerPoint);
            } else if (sortedPlayers.indexOf(player) < totalDraftable) {
                // If they are in the draftable pool but barely above/at replacement
                dollarValue = 1;
            } else {
                // Below replacement
                dollarValue = 0;
            }

            // Round to nearest integer (or keep decimal for precision if needed, but standard is int)
            // Using Math.round can lead to slight budget overflow/underflow, but it's standard.
            return {
                ...player,
                dollarValue: Math.round(dollarValue)
            };
        });
    },

    /**
     * Rank players within their type
     */
    rankPlayers(players) {
        const hitters = players.filter(p => p.type === 'hitter')
            .sort((a, b) => b.zTotal - a.zTotal)
            .map((p, i) => ({ ...p, valueRank: i + 1 }));

        const pitchers = players.filter(p => p.type === 'pitcher')
            .sort((a, b) => b.zTotal - a.zTotal)
            .map((p, i) => ({ ...p, valueRank: i + 1 }));

        // Also add overall rank
        const all = [...hitters, ...pitchers]
            .sort((a, b) => (b.dollarValue || b.zTotal) - (a.dollarValue || a.zTotal))
            .map((p, i) => ({ ...p, overallRank: i + 1 }));

        return all;
    },

    /**
     * Calculate mean of array
     */
    mean(values) {
        if (values.length === 0) return 0;
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    },

    /**
     * Calculate standard deviation
     */
    stdDev(values) {
        if (values.length < 2) return 0;
        const avg = this.mean(values);
        const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
        return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
    },

    /**
     * Get category breakdown for a player
     */
    getCategoryBreakdown(player, leagueType = 'h2h12') {
        const league = this.LEAGUES[leagueType];
        const categories = player.type === 'hitter' ? league.hitting : league.pitching;

        return categories.map(cat => ({
            category: cat.toUpperCase(),
            value: this.getStatValue(player, cat),
            zScore: player[`z_${cat}`] || 0,
            isStrength: (player[`z_${cat}`] || 0) > 0.5,
            isWeakness: (player[`z_${cat}`] || 0) < -0.5
        }));
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Calculator;
}
