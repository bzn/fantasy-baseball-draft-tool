<?php
/**
 * Fantasy Baseball Draft Tool - FanGraphs Projection Fetcher
 *
 * Proxies requests to FanGraphs internal API to fetch projection data.
 * This avoids CORS issues and provides server-side caching.
 *
 * Endpoints:
 *   ?action=hitters   - Fetch hitter projections (THE BAT X)
 *   ?action=pitchers  - Fetch pitcher projections (THE BAT)
 *   ?action=both      - Fetch both in one call
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$action = isset($_GET['action']) ? $_GET['action'] : '';

// Projection system: thebatx (hitters), thebat (pitchers), steamer, zips, atc
$system = isset($_GET['system']) ? $_GET['system'] : '';

switch ($action) {
    case 'hitters':
        $data = fetchProjections('bat', $system ?: 'thebatx');
        echo json_encode($data);
        break;
    case 'pitchers':
        $data = fetchProjections('pit', $system ?: 'thebat');
        echo json_encode($data);
        break;
    case 'both':
        // THE BAT X is hitters-only; for pitchers use THE BAT as fallback
        $hitterSystem = $system ?: 'thebatx';
        $pitcherSystem = ($hitterSystem === 'thebatx') ? 'thebat' : $hitterSystem;
        $hitters = fetchProjections('bat', $hitterSystem);
        $pitchers = fetchProjections('pit', $pitcherSystem);
        echo json_encode([
            'success' => $hitters['success'] && $pitchers['success'],
            'hitters' => $hitters,
            'pitchers' => $pitchers,
        ]);
        break;
    default:
        echo json_encode(['success' => false, 'error' => 'Use action=hitters, action=pitchers, or action=both']);
}

/**
 * Fetch projection data from FanGraphs
 * Tries JSON API first, falls back to HTML scraping
 */
function fetchProjections($stats, $type) {
    // FanGraphs internal API endpoint (returns JSON when accessed with proper headers)
    $url = "https://www.fangraphs.com/api/projections?"
         . "type={$type}"
         . "&stats={$stats}"
         . "&pos=all"
         . "&team=0"
         . "&players=0"
         . "&lg=all";

    // Try JSON API first
    $result = httpGet($url, [
        'Accept: application/json',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer: https://www.fangraphs.com/projections',
    ]);

    if ($result['http_code'] !== 200 || !$result['body']) {
        return [
            'success' => false,
            'error' => "FanGraphs returned HTTP {$result['http_code']}",
            'url' => $url,
        ];
    }

    // Try to parse as JSON (FanGraphs API returns JSON array)
    $data = json_decode($result['body'], true);
    if ($data && is_array($data)) {
        return processJsonData($data, $stats, $type);
    }

    // Not JSON - the API might have changed or returned HTML
    return [
        'success' => false,
        'error' => 'FanGraphs did not return JSON. The API format may have changed.',
        'response_preview' => substr($result['body'], 0, 500),
    ];
}

/**
 * Process FanGraphs JSON API response into our format
 */
function processJsonData($rows, $stats, $type) {
    if (empty($rows)) {
        return ['success' => false, 'error' => 'No projection data returned'];
    }

    $players = [];

    // FanGraphs JSON uses field names like "PlayerName", "Team", "HR", "R", etc.
    foreach ($rows as $row) {
        $name = $row['PlayerName'] ?? $row['playerName'] ?? $row['Name'] ?? '';
        $team = $row['Team'] ?? $row['team'] ?? '';
        if (!$name) continue;

        // Normalize team codes
        $team = normalizeTeam($team);

        if ($stats === 'bat') {
            $players[] = [
                'name'    => $name,
                'team'    => $team,
                'type'    => 'hitter',
                'g'       => intval($row['G'] ?? 0),
                'pa'      => intval($row['PA'] ?? 0),
                'ab'      => intval($row['AB'] ?? 0),
                'h'       => intval($row['H'] ?? 0),
                'doubles' => intval($row['2B'] ?? 0),
                'triples' => intval($row['3B'] ?? 0),
                'hr'      => intval($row['HR'] ?? 0),
                'r'       => intval($row['R'] ?? 0),
                'rbi'     => intval($row['RBI'] ?? 0),
                'bb'      => intval($row['BB'] ?? 0),
                'so'      => intval($row['SO'] ?? 0),
                'hbp'     => intval($row['HBP'] ?? 0),
                'sb'      => intval($row['SB'] ?? 0),
                'cs'      => intval($row['CS'] ?? 0),
                'avg'     => round(floatval($row['AVG'] ?? 0), 3),
                'obp'     => round(floatval($row['OBP'] ?? 0), 3),
                'slg'     => round(floatval($row['SLG'] ?? 0), 3),
                'ops'     => round(floatval($row['OPS'] ?? 0), 3),
                'iso'     => round(floatval($row['ISO'] ?? 0), 3),
                'babip'   => round(floatval($row['BABIP'] ?? 0), 3),
                'woba'    => round(floatval($row['wOBA'] ?? 0), 3),
                'wrcPlus' => intval($row['wRC+'] ?? $row['wRCp'] ?? 0),
                'bbPct'   => round(floatval($row['BB%'] ?? $row['BBpct'] ?? 0) * 100, 1),
                'kPct'    => round(floatval($row['K%'] ?? $row['Kpct'] ?? 0) * 100, 1),
                'adp'     => round(floatval($row['ADP'] ?? 0), 1),
            ];
        } else {
            $players[] = [
                'name'    => $name,
                'team'    => $team,
                'type'    => 'pitcher',
                'g'       => intval($row['G'] ?? 0),
                'gs'      => intval($row['GS'] ?? 0),
                'ip'      => round(floatval($row['IP'] ?? 0), 1),
                'w'       => intval($row['W'] ?? 0),
                'l'       => intval($row['L'] ?? 0),
                'qs'      => intval($row['QS'] ?? 0),
                'sv'      => intval($row['SV'] ?? 0),
                'hld'     => intval($row['HLD'] ?? 0),
                'h'       => intval($row['H'] ?? 0),
                'er'      => intval($row['ER'] ?? 0),
                'hr'      => intval($row['HR'] ?? 0),
                'so'      => intval($row['SO'] ?? 0),
                'bb'      => intval($row['BB'] ?? 0),
                'k9'      => round(floatval($row['K/9'] ?? $row['K9'] ?? 0), 2),
                'bb9'     => round(floatval($row['BB/9'] ?? $row['BB9'] ?? 0), 2),
                'hr9'     => round(floatval($row['HR/9'] ?? $row['HR9'] ?? 0), 2),
                'avg'     => round(floatval($row['AVG'] ?? 0), 3),
                'whip'    => round(floatval($row['WHIP'] ?? 0), 2),
                'babip'   => round(floatval($row['BABIP'] ?? 0), 3),
                'lobPct'  => round(floatval($row['LOB%'] ?? $row['LOBpct'] ?? 0) * 100, 1),
                'era'     => round(floatval($row['ERA'] ?? 0), 2),
                'fip'     => round(floatval($row['FIP'] ?? 0), 2),
                'adp'     => round(floatval($row['ADP'] ?? 0), 1),
            ];
        }
    }

    return [
        'success' => true,
        'count'   => count($players),
        'system'  => $type,
        'players' => $players,
    ];
}

/**
 * HTTP GET request
 */
function httpGet($url, $headers = []) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER     => $headers,
    ]);

    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    return [
        'http_code' => $httpCode,
        'body'      => $body,
        'error'     => $error,
    ];
}

/**
 * Normalize FanGraphs team codes to standard
 */
function normalizeTeam($team) {
    $map = [
        'KCR' => 'KC',
        'SDP' => 'SD',
        'SFG' => 'SF',
        'TBR' => 'TB',
        'WSN' => 'WSH',
        'CHW' => 'CWS',
        'AZ'  => 'ARI',
    ];
    $team = strtoupper(trim($team));
    return $map[$team] ?? $team;
}
