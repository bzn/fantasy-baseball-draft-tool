<?php
/**
 * Fantasy Baseball Draft Tool - Yahoo Fantasy API Proxy
 *
 * Endpoints:
 *   ?action=leagues       - Get user's fantasy baseball leagues
 *   ?action=settings&league_key=XXX - Get league settings
 *   ?action=players&league_key=XXX&start=0&count=25 - Get league players with positions
 *   ?action=draftresults&league_key=XXX  - Get draft results
 *   ?action=teams&league_key=XXX  - Get league teams
 *   ?action=roster&league_key=XXX&team_key=XXX - Get team roster
 *   ?action=draftanalysis_adp&league_key=XXX&start=0&count=25 - Get draft analysis (ADP) data
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Load config - priority: GET/POST params > config file
$clientId = $_GET['client_id'] ?? $_POST['client_id'] ?? null;
$clientSecret = $_GET['client_secret'] ?? $_POST['client_secret'] ?? null;

$configFile = __DIR__ . '/yahoo-config.php';
$serverConfigExists = file_exists($configFile);

// If no credentials from frontend, try loading from server config
if (!$clientId || !$clientSecret) {
    if ($serverConfigExists) {
        $tempConfig = require $configFile;
        if (isset($tempConfig['client_id']) && $tempConfig['client_id'] !== 'YOUR_YAHOO_CLIENT_ID') {
            $clientId = $tempConfig['client_id'];
            $clientSecret = $tempConfig['client_secret'];
        }
    }
}

// Build config array
$config = [];
if ($serverConfigExists) {
    $config = require $configFile;
}

// Override with provided credentials
if ($clientId && $clientSecret) {
    $config['client_id'] = $clientId;
    $config['client_secret'] = $clientSecret;
}

// Set defaults
$config['redirect_uri'] = $config['redirect_uri'] ?? 'https://localhost/fantasy-baseball-draft-tool/api/callback.php';
$config['auth_url'] = $config['auth_url'] ?? 'https://api.login.yahoo.com/oauth2/request_auth';
$config['token_url'] = $config['token_url'] ?? 'https://api.login.yahoo.com/oauth2/get_token';
$config['api_base'] = $config['api_base'] ?? 'https://fantasysports.yahooapis.com/fantasy/v2';
$config['token_file'] = $config['token_file'] ?? __DIR__ . '/../data/yahoo_token.json';
$config['game_key'] = $config['game_key'] ?? 'mlb';

// Load tokens
$tokenFile = $config['token_file'];
if (!file_exists($tokenFile)) {
    echo json_encode(['success' => false, 'error' => 'Not authenticated. Please login first.', 'auth_required' => true]);
    exit;
}

$tokens = json_decode(file_get_contents($tokenFile), true);
if (!$tokens || !isset($tokens['access_token'])) {
    echo json_encode(['success' => false, 'error' => 'Invalid token. Please login again.', 'auth_required' => true]);
    exit;
}

// Auto-refresh if expired
if (isset($tokens['expires_at']) && time() >= $tokens['expires_at']) {
    $refreshResult = refreshToken($config, $tokens);
    if ($refreshResult) {
        $tokens = $refreshResult;
    } else {
        echo json_encode(['success' => false, 'error' => 'Token expired and refresh failed. Please login again.', 'auth_required' => true]);
        exit;
    }
}

$action = isset($_GET['action']) ? $_GET['action'] : '';
$apiBase = $config['api_base'];
$gameKey = $config['game_key'];

switch ($action) {
    case 'leagues':
        handleLeagues($apiBase, $gameKey, $tokens);
        break;
    case 'settings':
        handleSettings($apiBase, $tokens);
        break;
    case 'players':
        handlePlayers($apiBase, $tokens);
        break;
    case 'draftresults':
        handleDraftResults($apiBase, $tokens);
        break;
    case 'teams':
        handleTeams($apiBase, $tokens);
        break;
    case 'roster':
        handleRoster($apiBase, $tokens);
        break;
    case 'draftanalysis_adp':
        handleDraftAnalysisADP($apiBase, $tokens);
        break;
    case 'debug_players':
        handleDebugPlayers($apiBase, $tokens);
        break;
    default:
        echo json_encode(['success' => false, 'error' => 'Invalid action']);
}

// =================== Action Handlers ===================

/**
 * Get user's fantasy baseball leagues for the current season
 */
function handleLeagues($apiBase, $gameKey, $tokens) {
    // Try current season first
    $url = "{$apiBase}/users;use_login=1/games;game_keys={$gameKey}/leagues?format=json";
    $data = yahooApiGet($url, $tokens['access_token']);

    // If 'mlb' key fails or returns no leagues, try fetching all games
    if (!$data) {
        // Fallback: get all fantasy games for this user
        $url = "{$apiBase}/users;use_login=1/games?format=json";
        $data = yahooApiGet($url, $tokens['access_token']);

        if (!$data) {
            echo json_encode(['success' => false, 'error' => 'Failed to fetch leagues from Yahoo API']);
            return;
        }

        // Return raw so we can debug the game keys
        echo json_encode(['success' => false, 'error' => 'Could not find MLB leagues. Check game_key.', 'raw' => $data]);
        return;
    }

    // Parse league data from Yahoo's nested JSON structure
    $leagues = [];
    try {
        $users = $data['fantasy_content']['users'];
        $user = $users['0']['user'];
        $gamesData = $user[1]['games'];
        $gameCount = isset($gamesData['count']) ? (int)$gamesData['count'] : 0;

        for ($g = 0; $g < $gameCount; $g++) {
            $game = $gamesData[$g]['game'] ?? null;
            if (!$game) continue;

            // game[0] = game info, game[1] = leagues
            $gameInfo = $game[0] ?? [];
            $leaguesWrapper = $game[1] ?? null;

            if (!$leaguesWrapper || !isset($leaguesWrapper['leagues'])) continue;

            $leaguesData = $leaguesWrapper['leagues'];
            $leagueCount = isset($leaguesData['count']) ? (int)$leaguesData['count'] : 0;

            for ($i = 0; $i < $leagueCount; $i++) {
                $leagueArr = $leaguesData[$i]['league'] ?? null;
                if (!$leagueArr) continue;

                $league = $leagueArr[0] ?? [];
                $leagues[] = [
                    'league_key'    => $league['league_key'] ?? '',
                    'league_id'     => $league['league_id'] ?? '',
                    'name'          => $league['name'] ?? 'Unknown',
                    'num_teams'     => (int)($league['num_teams'] ?? 0),
                    'scoring_type'  => $league['scoring_type'] ?? '',
                    'draft_status'  => $league['draft_status'] ?? '',
                    'current_week'  => $league['current_week'] ?? '',
                    'season'        => $league['season'] ?? '',
                    'game_code'     => $gameInfo['code'] ?? '',
                ];
            }
        }
    } catch (Exception $e) {
        // Parsing failed, return raw for debugging
        echo json_encode(['success' => false, 'error' => 'Parse error: ' . $e->getMessage(), 'raw' => $data]);
        return;
    }

    // If no leagues found, return raw data for debugging
    if (empty($leagues)) {
        echo json_encode(['success' => false, 'error' => 'No leagues found', 'raw' => $data]);
        return;
    }

    echo json_encode(['success' => true, 'leagues' => $leagues]);
}

/**
 * Get league settings (categories, roster, draft type)
 */
function handleSettings($apiBase, $tokens) {
    $leagueKey = isset($_GET['league_key']) ? $_GET['league_key'] : '';
    if (!$leagueKey) {
        echo json_encode(['success' => false, 'error' => 'league_key required']);
        return;
    }

    $url = "{$apiBase}/league/{$leagueKey}/settings?format=json";
    $data = yahooApiGet($url, $tokens['access_token']);

    if (!$data) {
        echo json_encode(['success' => false, 'error' => 'Failed to fetch settings']);
        return;
    }

    // Parse settings
    try {
        $leagueData = $data['fantasy_content']['league'];
        $leagueInfo = $leagueData[0];
        $settingsData = $leagueData[1]['settings'][0];

        // Extract stat categories
        $statCategories = [];
        $statModifiers = [];
        if (isset($settingsData['stat_categories']['stats'])) {
            foreach ($settingsData['stat_categories']['stats'] as $stat) {
                $s = $stat['stat'];
                $isDisplayOnly = 0;
                // Yahoo may flag display-only stats at stat level or category level
                if (isset($s['is_only_display_stat'])) {
                    $isDisplayOnly = (int)$s['is_only_display_stat'];
                } elseif (isset($stat['is_only_display_stat'])) {
                    $isDisplayOnly = (int)$stat['is_only_display_stat'];
                }
                $statCategories[] = [
                    'stat_id'   => (int)$s['stat_id'],
                    'name'      => $s['display_name'],
                    'sort_order' => $s['sort_order'] ?? '1', // 1=desc (higher is better), 0=asc (lower is better)
                    'position_type' => $s['position_type'] ?? '', // B=batter, P=pitcher
                    'is_only_display_stat' => $isDisplayOnly,
                ];
            }
        }

        // Extract stat modifiers (for points leagues, not used for roto/h2h cat)
        if (isset($settingsData['stat_modifiers']['stats'])) {
            foreach ($settingsData['stat_modifiers']['stats'] as $stat) {
                $s = $stat['stat'];
                $statModifiers[] = [
                    'stat_id' => (int)$s['stat_id'],
                    'value'   => (float)$s['value'],
                ];
            }
        }

        // Extract roster positions
        $rosterPositions = [];
        if (isset($settingsData['roster_positions'])) {
            foreach ($settingsData['roster_positions'] as $rp) {
                $pos = $rp['roster_position'];
                $rosterPositions[] = [
                    'position'      => $pos['position'],
                    'position_type' => $pos['position_type'] ?? '',
                    'count'         => (int)$pos['count'],
                ];
            }
        }

        // Auction detection: is_auction_draft is the definitive field
        $isAuction = !empty($settingsData['is_auction_draft']);
        $salaryCap = isset($settingsData['salary_cap']) ? (int)$settingsData['salary_cap'] : 260;
        $usesFaab = !empty($settingsData['uses_faab']);

        $settings = [
            'league_key'       => $leagueInfo['league_key'],
            'name'             => $leagueInfo['name'],
            'scoring_type'     => $leagueInfo['scoring_type'], // "head" or "roto"
            'num_teams'        => (int)$leagueInfo['num_teams'],
            'draft_method'     => $settingsData['draft_type'] ?? 'live',
            'is_auction_draft' => $isAuction,
            'season'           => $leagueInfo['season'],
            'draft_status'     => $leagueInfo['draft_status'] ?? '',
            'stat_categories'  => $statCategories,
            'stat_modifiers'   => $statModifiers,
            'roster_positions' => $rosterPositions,
            'max_teams'        => (int)($settingsData['max_teams'] ?? 0),
            'salary_cap'       => $isAuction ? $salaryCap : 0,
            'uses_faab'        => $usesFaab,
            'trade_end_date'   => $settingsData['trade_end_date'] ?? '',
            'start_date'       => $leagueInfo['start_date'] ?? '',
            'end_date'         => $leagueInfo['end_date'] ?? '',
        ];

        echo json_encode(['success' => true, 'settings' => $settings]);
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => 'Parse error: ' . $e->getMessage(), 'raw' => $data]);
    }
}

/**
 * Get players with position eligibility from the league
 * Supports pagination: ?start=0&count=25&position=C
 */
function handlePlayers($apiBase, $tokens) {
    $leagueKey = isset($_GET['league_key']) ? $_GET['league_key'] : '';
    if (!$leagueKey) {
        echo json_encode(['success' => false, 'error' => 'league_key required']);
        return;
    }

    $start = isset($_GET['start']) ? (int)$_GET['start'] : 0;
    $count = isset($_GET['count']) ? min((int)$_GET['count'], 25) : 25;
    $position = isset($_GET['position']) ? $_GET['position'] : '';

    // Build URL with optional position filter
    $filters = "start={$start};count={$count}";
    if ($position) {
        $filters .= ";position={$position}";
    }
    $filters .= ";sort=OR";

    $url = "{$apiBase}/league/{$leagueKey}/players;{$filters}?format=json";
    $data = yahooApiGet($url, $tokens['access_token']);

    if (!$data) {
        $lastError = isset($GLOBALS['_yahoo_last_error']) ? $GLOBALS['_yahoo_last_error'] : null;
        $errorInfo = [
            'success' => false,
            'error' => 'Failed to fetch players from Yahoo API',
            'url' => $url,
        ];
        if ($lastError) {
            $errorInfo['http_code'] = $lastError['http_code'];
            $errorInfo['yahoo_response'] = $lastError['response_body'];
        }
        echo json_encode($errorInfo);
        return;
    }

    // Parse player data - return raw structure on first call for debugging
    $players = [];
    $debugKeys = [];

    // Navigate Yahoo's nested JSON
    $leagueData = isset($data['fantasy_content']['league']) ? $data['fantasy_content']['league'] : null;
    if (!$leagueData) {
        echo json_encode([
            'success' => false,
            'error' => 'Unexpected API response structure',
            'raw_keys' => array_keys($data),
            'fantasy_content_keys' => isset($data['fantasy_content']) ? array_keys($data['fantasy_content']) : 'missing',
        ]);
        return;
    }

    // league is an array: [0] = league info, [1] = players wrapper
    $playersWrapper = isset($leagueData[1]) ? $leagueData[1] : null;
    if (!$playersWrapper || !isset($playersWrapper['players'])) {
        echo json_encode([
            'success' => false,
            'error' => 'No players data in response',
            'league_data_keys' => is_array($leagueData) ? array_keys($leagueData) : gettype($leagueData),
            'wrapper_keys' => $playersWrapper ? array_keys($playersWrapper) : 'null',
            'raw_first_100' => substr(json_encode($leagueData), 0, 500),
        ]);
        return;
    }

    $playersData = $playersWrapper['players'];
    $playerCount = isset($playersData['count']) ? (int)$playersData['count'] : 0;

    for ($i = 0; $i < $playerCount; $i++) {
        if (!isset($playersData[$i]['player'])) continue;

        $playerInfo = $playersData[$i]['player'][0];

        // Extract basic info from the nested arrays
        $player = extractPlayerInfo($playerInfo);
        if ($player) {
            $players[] = $player;
        }
    }

    echo json_encode([
        'success' => true,
        'players' => $players,
        'start'   => $start,
        'count'   => count($players),
        'total'   => $playerCount,
    ]);
}

/**
 * Get draft results
 */
function handleDraftResults($apiBase, $tokens) {
    $leagueKey = isset($_GET['league_key']) ? $_GET['league_key'] : '';
    if (!$leagueKey) {
        echo json_encode(['success' => false, 'error' => 'league_key required']);
        return;
    }

    $url = "{$apiBase}/league/{$leagueKey}/draftresults?format=json";
    $data = yahooApiGet($url, $tokens['access_token']);

    if (!$data) {
        echo json_encode(['success' => false, 'error' => 'Failed to fetch draft results']);
        return;
    }

    $picks = [];
    try {
        $leagueData = $data['fantasy_content']['league'];
        $draftData = $leagueData[1]['draft_results'];
        $pickCount = $draftData['count'];

        for ($i = 0; $i < $pickCount; $i++) {
            $pick = $draftData[$i]['draft_result'];
            $picks[] = [
                'pick'       => (int)$pick['pick'],
                'round'      => (int)$pick['round'],
                'cost'       => isset($pick['cost']) ? (int)$pick['cost'] : 0,
                'team_key'   => $pick['team_key'],
                'player_key' => $pick['player_key'],
            ];
        }
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => 'Parse error']);
        return;
    }

    echo json_encode(['success' => true, 'picks' => $picks]);
}

/**
 * Get league teams
 */
function handleTeams($apiBase, $tokens) {
    $leagueKey = isset($_GET['league_key']) ? $_GET['league_key'] : '';
    if (!$leagueKey) {
        echo json_encode(['success' => false, 'error' => 'league_key required']);
        return;
    }

    $url = "{$apiBase}/league/{$leagueKey}/teams?format=json";
    $data = yahooApiGet($url, $tokens['access_token']);

    if (!$data) {
        echo json_encode(['success' => false, 'error' => 'Failed to fetch teams']);
        return;
    }

    $teams = [];
    try {
        $leagueData = $data['fantasy_content']['league'];
        $teamsData = $leagueData[1]['teams'];
        $teamCount = $teamsData['count'];

        for ($i = 0; $i < $teamCount; $i++) {
            $teamInfo = $teamsData[$i]['team'][0];
            $team = [];
            foreach ($teamInfo as $item) {
                if (is_array($item)) {
                    foreach ($item as $key => $value) {
                        if (!is_numeric($key)) {
                            $team[$key] = $value;
                        }
                    }
                }
            }
            $teams[] = [
                'team_key'  => $team['team_key'] ?? '',
                'team_id'   => $team['team_id'] ?? '',
                'name'      => $team['name'] ?? '',
                'is_owned_by_current_login' => isset($team['is_owned_by_current_login']) ? (bool)$team['is_owned_by_current_login'] : false,
                'managers'  => $team['managers'] ?? [],
            ];
        }
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => 'Parse error']);
        return;
    }

    echo json_encode(['success' => true, 'teams' => $teams]);
}

/**
 * Get team roster
 */
function handleRoster($apiBase, $tokens) {
    $teamKey = isset($_GET['team_key']) ? $_GET['team_key'] : '';
    if (!$teamKey) {
        echo json_encode(['success' => false, 'error' => 'team_key required']);
        return;
    }

    $url = "{$apiBase}/team/{$teamKey}/roster/players?format=json";
    $data = yahooApiGet($url, $tokens['access_token']);

    if (!$data) {
        echo json_encode(['success' => false, 'error' => 'Failed to fetch roster']);
        return;
    }

    echo json_encode(['success' => true, 'data' => $data]);
}

/**
 * Get draft analysis (ADP) data for league players
 * Returns average_pick, average_round, average_cost, percent_drafted
 */
function handleDraftAnalysisADP($apiBase, $tokens) {
    $leagueKey = isset($_GET['league_key']) ? $_GET['league_key'] : '';
    if (!$leagueKey) {
        echo json_encode(['success' => false, 'error' => 'league_key required']);
        return;
    }

    $start = isset($_GET['start']) ? (int)$_GET['start'] : 0;
    $count = isset($_GET['count']) ? min((int)$_GET['count'], 25) : 25;

    $url = "{$apiBase}/league/{$leagueKey}/players;start={$start};count={$count};sort=OR/draft_analysis?format=json";
    $data = yahooApiGet($url, $tokens['access_token']);

    if (!$data) {
        $lastError = isset($GLOBALS['_yahoo_last_error']) ? $GLOBALS['_yahoo_last_error'] : null;
        $errorInfo = [
            'success' => false,
            'error' => 'Failed to fetch draft analysis from Yahoo API',
            'url' => $url,
        ];
        if ($lastError) {
            $errorInfo['http_code'] = $lastError['http_code'];
            $errorInfo['yahoo_response'] = $lastError['response_body'];
        }
        echo json_encode($errorInfo);
        return;
    }

    // Parse player + draft_analysis data
    $players = [];

    $leagueData = isset($data['fantasy_content']['league']) ? $data['fantasy_content']['league'] : null;
    if (!$leagueData) {
        echo json_encode(['success' => false, 'error' => 'Unexpected API response structure']);
        return;
    }

    $playersWrapper = isset($leagueData[1]) ? $leagueData[1] : null;
    if (!$playersWrapper || !isset($playersWrapper['players'])) {
        echo json_encode([
            'success' => true,
            'players' => [],
            'start' => $start,
            'count' => 0,
            'total' => 0,
        ]);
        return;
    }

    $playersData = $playersWrapper['players'];
    $playerCount = isset($playersData['count']) ? (int)$playersData['count'] : 0;

    // Debug mode: return raw structure of first player to inspect
    $debug = isset($_GET['debug']) && $_GET['debug'] === '1';
    $debugSample = null;

    for ($i = 0; $i < $playerCount; $i++) {
        if (!isset($playersData[$i]['player'])) continue;

        $playerArr = $playersData[$i]['player'];

        // Capture first player's raw structure for debugging
        if ($debug && $i === 0) {
            $debugSample = $playerArr;
        }

        // player[0] = player info array
        $playerInfo = $playerArr[0];
        $player = extractPlayerInfo($playerInfo);
        if (!$player) continue;

        // Extract draft_analysis - search through all indices beyond [0]
        // Yahoo returns draft_analysis as an array of single-key objects:
        //   [{"average_pick":"1.5"}, {"average_round":"1.0"}, ...]
        $draftAnalysis = [];
        for ($j = 1; $j < count($playerArr); $j++) {
            if (is_array($playerArr[$j]) && isset($playerArr[$j]['draft_analysis'])) {
                $daArr = $playerArr[$j]['draft_analysis'];
                // Flatten array of single-key objects into one associative array
                $da = [];
                if (is_array($daArr)) {
                    foreach ($daArr as $item) {
                        if (is_array($item)) {
                            foreach ($item as $key => $val) {
                                $da[$key] = $val;
                            }
                        }
                    }
                }
                $draftAnalysis = [
                    'average_pick' => isset($da['average_pick']) ? (float)$da['average_pick'] : null,
                    'average_round' => isset($da['average_round']) ? (float)$da['average_round'] : null,
                    'average_cost' => isset($da['average_cost']) ? (float)$da['average_cost'] : null,
                    'percent_drafted' => isset($da['percent_drafted']) ? (float)$da['percent_drafted'] : null,
                ];
                break;
            }
        }

        $players[] = [
            'name' => $player['name'],
            'team' => $player['team'],
            'player_key' => $player['player_key'],
            'positions' => $player['positions'],
            'position_type' => $player['position_type'],
            'average_pick' => $draftAnalysis['average_pick'] ?? null,
            'average_round' => $draftAnalysis['average_round'] ?? null,
            'average_cost' => $draftAnalysis['average_cost'] ?? null,
            'percent_drafted' => $draftAnalysis['percent_drafted'] ?? null,
        ];
    }

    $result = [
        'success' => true,
        'players' => $players,
        'start' => $start,
        'count' => count($players),
        'total' => $playerCount,
    ];

    if ($debug && $debugSample !== null) {
        $result['_debug_first_player_raw'] = $debugSample;
        $result['_debug_player_keys'] = array_keys($playersData);
    }

    echo json_encode($result);
}

/**
 * Debug endpoint - returns raw Yahoo API response for players
 * Usage: ?action=debug_players&league_key=XXX
 */
function handleDebugPlayers($apiBase, $tokens) {
    $leagueKey = isset($_GET['league_key']) ? $_GET['league_key'] : '';
    if (!$leagueKey) {
        echo json_encode(['error' => 'league_key required']);
        return;
    }

    // Try multiple URL formats to see which works
    $urls = [
        'with_status_A' => "{$apiBase}/league/{$leagueKey}/players;start=0;count=5;status=A?format=json",
        'no_status'     => "{$apiBase}/league/{$leagueKey}/players;start=0;count=5?format=json",
        'with_sort'     => "{$apiBase}/league/{$leagueKey}/players;start=0;count=5;sort=OR?format=json",
    ];

    $results = [];
    foreach ($urls as $label => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER     => ["Authorization: Bearer {$tokens['access_token']}"],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_FOLLOWLOCATION => true,
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode($response, true);
        $results[$label] = [
            'url'       => $url,
            'http_code' => $httpCode,
            'response'  => $decoded ? $decoded : substr($response, 0, 1000),
        ];
    }

    echo json_encode(['debug' => true, 'results' => $results], JSON_PRETTY_PRINT);
}

// =================== Helper Functions ===================

/**
 * Make authenticated GET request to Yahoo API
 * Returns ['data' => parsed JSON, 'http_code' => int, 'error' => string|null]
 */
function yahooApiGet($url, $accessToken) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ["Authorization: Bearer {$accessToken}"],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_FOLLOWLOCATION => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode === 200) {
        return json_decode($response, true);
    }

    // Store last error for debugging
    $GLOBALS['_yahoo_last_error'] = [
        'http_code' => $httpCode,
        'curl_error' => $curlError,
        'response_body' => substr($response, 0, 2000),
        'url' => $url,
    ];

    return null;
}

/**
 * Refresh access token using refresh token
 */
function refreshToken($config, $tokens) {
    $postData = [
        'grant_type'    => 'refresh_token',
        'refresh_token' => $tokens['refresh_token'],
        'redirect_uri'  => $config['redirect_uri'],
    ];

    $headers = [
        'Authorization: Basic ' . base64_encode($config['client_id'] . ':' . $config['client_secret']),
        'Content-Type: application/x-www-form-urlencoded',
    ];

    $ch = curl_init($config['token_url']);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($postData),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $newTokens = json_decode($response, true);
        if (isset($newTokens['access_token'])) {
            // Preserve refresh token if not returned
            if (!isset($newTokens['refresh_token'])) {
                $newTokens['refresh_token'] = $tokens['refresh_token'];
            }
            $newTokens['expires_at'] = time() + (int)$newTokens['expires_in'];
            $newTokens['saved_at'] = time();

            $tokenFile = $config['token_file'];
            file_put_contents($tokenFile, json_encode($newTokens, JSON_PRETTY_PRINT));
            return $newTokens;
        }
    }

    return null;
}

/**
 * Extract player info from Yahoo's nested array structure
 *
 * Yahoo returns player[0] as an array of single-key objects, e.g.:
 *   [{"player_key":"469.p.9877"}, {"player_id":"9877"}, {"name":{"full":"Aaron Judge",...}}, ...]
 */
function extractPlayerInfo($playerInfo) {
    $player = [];

    // Yahoo returns player data as an array of objects with different structures
    foreach ($playerInfo as $item) {
        if (!is_array($item)) continue;

        // Name object - nested: {"name": {"full": "Aaron Judge", ...}}
        if (isset($item['name']) && is_array($item['name'])) {
            $player['name'] = $item['name']['full'] ?? '';
            $player['first_name'] = $item['name']['first'] ?? '';
            $player['last_name'] = $item['name']['last'] ?? '';
        }

        // Editorial team abbreviation
        if (isset($item['editorial_team_abbr'])) {
            $player['team'] = strtoupper($item['editorial_team_abbr']);
        }

        // Player key
        if (isset($item['player_key'])) {
            $player['player_key'] = $item['player_key'];
        }

        // Position type
        if (isset($item['position_type'])) {
            $player['position_type'] = $item['position_type']; // B or P
        }

        // Display position
        if (isset($item['display_position'])) {
            $player['display_position'] = $item['display_position'];
        }

        // Eligible positions (array)
        if (isset($item['eligible_positions']) && is_array($item['eligible_positions'])) {
            $positions = [];
            foreach ($item['eligible_positions'] as $pos) {
                if (is_array($pos) && isset($pos['position'])) {
                    $positions[] = $pos['position'];
                }
            }
            $player['positions'] = $positions;
        }

        // Status (injury) - {"status": "IL10", "status_full": "Injured List (10-Day)"}
        if (isset($item['status']) && is_string($item['status'])) {
            $player['injury_status'] = $item['status']; // DTD, IL10, IL60, etc.
        }

        // Player ID
        if (isset($item['player_id'])) {
            $player['player_id'] = $item['player_id'];
        }
    }

    if (!empty($player['name'])) {
        return [
            'name'          => $player['name'] ?? '',
            'team'          => normalizeTeamCode($player['team'] ?? ''),
            'player_key'    => $player['player_key'] ?? '',
            'positions'     => $player['positions'] ?? [$player['display_position'] ?? ''],
            'position_type' => $player['position_type'] ?? '',
            'injury_status' => $player['injury_status'] ?? '',
        ];
    }

    return null;
}

/**
 * Normalize Yahoo team codes to standard
 */
function normalizeTeamCode($team) {
    $map = [
        'AZ'  => 'ARI',
        'ATH' => 'OAK',
        'WAS' => 'WSH',
    ];
    return $map[strtoupper($team)] ?? strtoupper($team);
}
