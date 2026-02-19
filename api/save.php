<?php
/**
 * Fantasy Baseball Draft Tool - Data Save API
 * Saves parsed player data to CSV files only
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data || !isset($data['type']) || !isset($data['players'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid data format']);
    exit;
}

$type = $data['type']; // 'hitter', 'pitcher', or 'position'
$players = $data['players'];

if (!in_array($type, ['hitter', 'pitcher', 'position', 'merged'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid type. Must be hitter, pitcher, position, or merged']);
    exit;
}

$dataDir = __DIR__ . '/../data';

// Ensure data directory exists
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0755, true);
}

// Determine filename based on type
if ($type === 'position') {
    $filename = 'positions';
} elseif ($type === 'merged') {
    $filename = 'merged';
} else {
    $filename = $type . 's'; // hitters or pitchers
}

// Save CSV only (no JSON)
$csvPath = $dataDir . '/' . $filename . '.csv';

if (count($players) > 0) {
    $csvFile = fopen($csvPath, 'w');

    // Write BOM for Excel UTF-8 compatibility
    fprintf($csvFile, chr(0xEF).chr(0xBB).chr(0xBF));

    // Define proper column order based on data type
    if ($type === 'hitter') {
        // Hitter Fantasy Dashboard format
        $headers = [
            'type', 'rank', 'name', 'team', 'g', 'pa', 'ab', 'h', 'doubles', 'triples', 'hr',
            'r', 'rbi', 'bb', 'so', 'hbp', 'sb', 'cs',
            'bbPct', 'kPct', 'iso', 'babip', 'avg', 'obp', 'slg', 'ops', 'woba', 'wrcPlus',
            'bsr', 'off', 'def', 'war', 'adp'
        ];
    } elseif ($type === 'pitcher') {
        // Pitcher Fantasy Dashboard format
        $headers = [
            'type', 'rank', 'name', 'team', 'gs', 'g', 'ip', 'w', 'l', 'qs', 'sv', 'hld',
            'h', 'er', 'hr', 'so', 'bb', 'k9', 'bb9', 'kbb', 'hr9',
            'avg', 'whip', 'babip', 'lobPct', 'gbPct', 'era', 'fip',
            'k', 'nsvh', 'war', 'adp'
        ];
    } elseif ($type === 'position') {
        // Yahoo position data
        $headers = ['name', 'team', 'positions', 'playerType', 'isPitcherSP', 'isPitcherRP', 'injuryStatus'];
    } elseif ($type === 'merged') {
        // Merged data - use canonical field order
        // This order MUST match the order defined in app.js saveMergedDataToFile()
        $headers = [
            // Common fields
            'type', 'rank', 'name', 'team',

            // Hitter fields (empty for pitchers)
            'g', 'pa', 'ab', 'h', 'doubles', 'triples', 'hr', 'r', 'rbi', 'bb', 'so', 'hbp', 'sb', 'cs',
            'bbPct', 'kPct', 'iso', 'babip', 'avg', 'obp', 'slg', 'ops', 'woba', 'wrcPlus',
            'bsr', 'off', 'def',

            // Common/Yahoo fields
            'war', 'adp', 'positions', 'playerType', 'positionString', 'injuryStatus',

            // Pitcher fields (empty for hitters)
            'gs', 'ip', 'w', 'l', 'qs', 'sv', 'hld', 'er', 'k9', 'bb9', 'kbb', 'hr9',
            'whip', 'lobPct', 'gbPct', 'era', 'fip', 'k', 'nsvh',

            // Pitcher Yahoo fields
            'isPitcherSP', 'isPitcherRP'
        ];
    } else {
        // Fallback: extract from first player
        $headers = array_keys($players[0]);
    }

    fputcsv($csvFile, $headers);

    // Write each player row
    foreach ($players as $player) {
        $row = [];
        foreach ($headers as $header) {
            $row[] = isset($player[$header]) ? $player[$header] : '';
        }
        fputcsv($csvFile, $row);
    }

    fclose($csvFile);
    $csvResult = true;
} else {
    $csvResult = file_put_contents($csvPath, '');
}

if ($csvResult) {
    echo json_encode([
        'success' => true,
        'message' => "Saved {$filename} data",
        'file' => $filename . '.csv',
        'count' => count($players)
    ]);
} else {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Failed to save CSV file']);
}
