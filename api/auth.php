<?php
/**
 * Fantasy Baseball Draft Tool - Yahoo OAuth 2.0 Authentication
 *
 * Endpoints:
 *   ?action=login    - Redirect user to Yahoo login
 *   ?action=callback - Handle OAuth callback from Yahoo
 *   ?action=refresh  - Refresh expired access token
 *   ?action=status   - Check current auth status
 *   ?action=logout   - Clear stored tokens
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight
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
        $config = require $configFile;
        if ($config['client_id'] !== 'YOUR_YAHOO_CLIENT_ID') {
            $clientId = $config['client_id'];
            $clientSecret = $config['client_secret'];
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

// Set defaults for missing config values
$config['redirect_uri'] = $config['redirect_uri'] ?? 'https://localhost/fantasy-baseball-draft-tool/api/callback.php';
$config['auth_url'] = $config['auth_url'] ?? 'https://api.login.yahoo.com/oauth2/request_auth';
$config['token_url'] = $config['token_url'] ?? 'https://api.login.yahoo.com/oauth2/get_token';
$config['api_base'] = $config['api_base'] ?? 'https://fantasysports.yahooapis.com/fantasy/v2';
$config['token_file'] = $config['token_file'] ?? __DIR__ . '/../data/yahoo_token.json';
$config['game_key'] = $config['game_key'] ?? 'mlb';

$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {
    case 'login':
        handleLogin($config);
        break;
    case 'callback':
        handleCallback($config);
        break;
    case 'refresh':
        handleRefresh($config);
        break;
    case 'status':
        handleStatus($config);
        break;
    case 'logout':
        handleLogout($config);
        break;
    default:
        echo json_encode(['success' => false, 'error' => 'Invalid action. Use: login, callback, refresh, status, logout']);
}

/**
 * Redirect user to Yahoo OAuth login page
 */
function handleLogin($config) {
    // Save credentials to temp file so callback.php can use them
    // (needed when user enters credentials via UI instead of config file)
    $tempConfigFile = __DIR__ . '/../data/yahoo_oauth_pending.json';
    $dir = dirname($tempConfigFile);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    file_put_contents($tempConfigFile, json_encode([
        'client_id'     => $config['client_id'],
        'client_secret' => $config['client_secret'],
        'redirect_uri'  => $config['redirect_uri'],
        'token_url'     => $config['token_url'],
        'token_file'    => $config['token_file'],
        'created_at'    => time(),
    ]));

    $params = http_build_query([
        'client_id'     => $config['client_id'],
        'redirect_uri'  => $config['redirect_uri'],
        'response_type' => 'code',
        'language'      => 'en-us',
    ]);

    $url = $config['auth_url'] . '?' . $params;

    // Redirect instead of JSON response
    header('Content-Type: text/html');
    header('Location: ' . $url);
    exit;
}

/**
 * Handle OAuth callback - exchange code for tokens
 */
function handleCallback($config) {
    if (!isset($_GET['code'])) {
        // Show error page
        header('Content-Type: text/html');
        $error = isset($_GET['error']) ? htmlspecialchars($_GET['error']) : 'No authorization code received';
        echo "<html><body><h2>Authorization Failed</h2><p>{$error}</p><script>setTimeout(function(){window.close();},3000);</script></body></html>";
        exit;
    }

    $code = $_GET['code'];

    // Exchange authorization code for tokens
    $tokenData = exchangeCodeForToken($config, $code);

    if ($tokenData && isset($tokenData['access_token'])) {
        // Save tokens
        saveTokens($config, $tokenData);

        // Show success page that communicates back to opener
        header('Content-Type: text/html');
        echo '<!DOCTYPE html><html><body>
        <h2>Yahoo Login Successful!</h2>
        <p>You can close this window.</p>
        <script>
            if (window.opener) {
                window.opener.postMessage({type: "yahoo_auth_success"}, "*");
                setTimeout(function() { window.close(); }, 1500);
            }
        </script>
        </body></html>';
    } else {
        header('Content-Type: text/html');
        $err = isset($tokenData['error_description']) ? htmlspecialchars($tokenData['error_description']) : 'Token exchange failed';
        echo "<html><body><h2>Login Failed</h2><p>{$err}</p></body></html>";
    }
}

/**
 * Refresh expired access token
 */
function handleRefresh($config) {
    $tokens = loadTokens($config);

    if (!$tokens || !isset($tokens['refresh_token'])) {
        echo json_encode(['success' => false, 'error' => 'No refresh token available. Please login again.']);
        return;
    }

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
        $tokenData = json_decode($response, true);
        if (isset($tokenData['access_token'])) {
            saveTokens($config, $tokenData);
            echo json_encode(['success' => true, 'message' => 'Token refreshed']);
            return;
        }
    }

    echo json_encode(['success' => false, 'error' => 'Token refresh failed. Please login again.']);
}

/**
 * Check current authentication status
 */
function handleStatus($config) {
    // Check if configured (has valid credentials)
    $configured = isset($config['client_id']) &&
                  $config['client_id'] !== 'YOUR_YAHOO_CLIENT_ID' &&
                  $config['client_id'] !== '';

    $tokens = loadTokens($config);

    if (!$tokens || !isset($tokens['access_token'])) {
        echo json_encode([
            'success' => true,
            'authenticated' => false,
            'configured' => $configured,
        ]);
        return;
    }

    // Check if token is expired
    $isExpired = false;
    if (isset($tokens['expires_at'])) {
        $isExpired = time() >= $tokens['expires_at'];
    }

    echo json_encode([
        'success' => true,
        'authenticated' => !$isExpired,
        'configured' => $configured,
        'expired' => $isExpired,
        'has_refresh' => isset($tokens['refresh_token']),
    ]);
}

/**
 * Clear stored tokens (logout)
 */
function handleLogout($config) {
    $tokenFile = $config['token_file'];
    if (file_exists($tokenFile)) {
        unlink($tokenFile);
    }
    echo json_encode(['success' => true, 'message' => 'Logged out']);
}

// =================== Helper Functions ===================

/**
 * Exchange authorization code for access + refresh tokens
 */
function exchangeCodeForToken($config, $code) {
    $postData = [
        'grant_type'   => 'authorization_code',
        'code'         => $code,
        'redirect_uri' => $config['redirect_uri'],
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
        return json_decode($response, true);
    }

    return json_decode($response, true) ?: ['error_description' => "HTTP {$httpCode}"];
}

/**
 * Save tokens to file
 */
function saveTokens($config, $tokenData) {
    $tokenFile = $config['token_file'];
    $dir = dirname($tokenFile);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    // Add expiry timestamp
    if (isset($tokenData['expires_in'])) {
        $tokenData['expires_at'] = time() + (int)$tokenData['expires_in'];
    }
    $tokenData['saved_at'] = time();

    file_put_contents($tokenFile, json_encode($tokenData, JSON_PRETTY_PRINT));
}

/**
 * Load tokens from file
 */
function loadTokens($config) {
    $tokenFile = $config['token_file'];
    if (!file_exists($tokenFile)) {
        return null;
    }
    return json_decode(file_get_contents($tokenFile), true);
}
