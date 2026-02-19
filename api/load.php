<?php
/**
 * Fantasy Baseball Draft Tool - Load CSV Data API
 * Reads CSV files and returns data as JSON
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Get the data type from query parameter
$type = isset($_GET['type']) ? $_GET['type'] : '';

// Validate type
$validTypes = ['hitters', 'pitchers', 'positions', 'merged'];
if (!in_array($type, $validTypes)) {
    echo json_encode([
        'success' => false,
        'error' => 'Invalid type. Must be: hitters, pitchers, positions, or merged'
    ]);
    exit;
}

// Determine file path
$filename = "../data/{$type}.csv";

// Check if file exists
if (!file_exists($filename)) {
    echo json_encode([
        'success' => false,
        'error' => "File not found: {$type}.csv",
        'players' => []
    ]);
    exit;
}

// Read CSV file
$players = [];
$headers = [];

if (($handle = fopen($filename, 'r')) !== false) {
    $rowIndex = 0;

    while (($row = fgetcsv($handle, 0, ',')) !== false) {
        if ($rowIndex === 0) {
            // First row is headers
            // Remove BOM from first header if present
            if (isset($row[0])) {
                $row[0] = str_replace("\xEF\xBB\xBF", '', $row[0]);
            }
            $headers = $row;
        } else {
            // Convert row to associative array
            $player = [];
            foreach ($headers as $index => $header) {
                $value = isset($row[$index]) ? $row[$index] : '';

                // Convert numeric strings to numbers
                if (is_numeric($value)) {
                    $player[$header] = strpos($value, '.') !== false
                        ? (float)$value
                        : (int)$value;
                } else {
                    $player[$header] = $value;
                }
            }

            // Convert comma-separated positions back to array (for positions/merged data)
            if (isset($player['positions']) && is_string($player['positions'])) {
                $player['positions'] = array_filter(
                    array_map('trim', explode(',', $player['positions'])),
                    function($pos) { return $pos !== ''; }
                );
            }

            // Convert boolean strings to boolean
            if (isset($player['isPitcherSP'])) {
                $player['isPitcherSP'] = filter_var($player['isPitcherSP'], FILTER_VALIDATE_BOOLEAN);
            }
            if (isset($player['isPitcherRP'])) {
                $player['isPitcherRP'] = filter_var($player['isPitcherRP'], FILTER_VALIDATE_BOOLEAN);
            }

            $players[] = $player;
        }
        $rowIndex++;
    }

    fclose($handle);
}

// Return success response
echo json_encode([
    'success' => true,
    'type' => $type,
    'count' => count($players),
    'players' => $players
]);
