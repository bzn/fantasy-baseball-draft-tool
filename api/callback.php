<?php
/**
 * Yahoo OAuth 2.0 Callback Handler
 * Dedicated endpoint so redirect_uri has no query parameters
 */

// Load config: try config file first, then pending OAuth temp file
$configFile = __DIR__ . '/yahoo-config.php';
$pendingFile = __DIR__ . '/../data/yahoo_oauth_pending.json';

if (file_exists($configFile)) {
    $config = require $configFile;
} elseif (file_exists($pendingFile)) {
    $config = json_decode(file_get_contents($pendingFile), true);
    if (!$config || !isset($config['client_id'])) {
        die('Invalid pending OAuth config');
    }
    // Set defaults that the config file would normally provide
    $config['redirect_uri'] = $config['redirect_uri'] ?? 'https://localhost/fantasy-baseball-draft-tool/api/callback.php';
    $config['token_url'] = $config['token_url'] ?? 'https://api.login.yahoo.com/oauth2/get_token';
    $config['token_file'] = $config['token_file'] ?? __DIR__ . '/../data/yahoo_token.json';
} else {
    die('Config not found. Please enter Yahoo API credentials in the Setup tab and try again.');
}

// Check for authorization code
$code = isset($_GET['code']) ? $_GET['code'] : null;

if (!$code) {
    $error = isset($_GET['error_description']) ? $_GET['error_description']
           : (isset($_GET['error']) ? $_GET['error'] : 'No authorization code received');
    header('Content-Type: text/html');
    echo "<html><body><h2>Authorization Failed</h2><p>" . htmlspecialchars($error) . "</p></body></html>";
    exit;
}

// Exchange code for tokens
$postData = http_build_query([
    'grant_type'   => 'authorization_code',
    'code'         => $code,
    'redirect_uri' => $config['redirect_uri'],
]);

$headers = [
    'Authorization: Basic ' . base64_encode($config['client_id'] . ':' . $config['client_secret']),
    'Content-Type: application/x-www-form-urlencoded',
];

$ch = curl_init($config['token_url']);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $postData,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// Debug: show what happened if something went wrong
if ($httpCode !== 200) {
    header('Content-Type: text/html');
    $responseData = json_decode($response, true);
    $errorMsg = isset($responseData['error_description']) ? $responseData['error_description'] : 'Unknown error';
    echo "<html><body>";
    echo "<h2>Login Failed</h2>";
    echo "<p><strong>Error:</strong> " . htmlspecialchars($errorMsg) . "</p>";
    echo "<p><strong>HTTP Code:</strong> {$httpCode}</p>";
    echo "<p><strong>redirect_uri sent:</strong> " . htmlspecialchars($config['redirect_uri']) . "</p>";
    if ($curlError) {
        echo "<p><strong>cURL Error:</strong> " . htmlspecialchars($curlError) . "</p>";
    }
    echo "<p style='margin-top:20px;color:#666;'>Make sure the Redirect URI in Yahoo Developer Dashboard matches exactly:<br><code>" . htmlspecialchars($config['redirect_uri']) . "</code></p>";
    echo "</body></html>";
    exit;
}

$tokenData = json_decode($response, true);

if (isset($tokenData['access_token'])) {
    // Save tokens
    $tokenFile = $config['token_file'];
    $dir = dirname($tokenFile);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    if (isset($tokenData['expires_in'])) {
        $tokenData['expires_at'] = time() + (int)$tokenData['expires_in'];
    }
    $tokenData['saved_at'] = time();
    file_put_contents($tokenFile, json_encode($tokenData, JSON_PRETTY_PRINT));

    // Clean up pending OAuth temp file
    if (file_exists($pendingFile)) {
        unlink($pendingFile);
    }

    // Success page
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
    echo "<html><body><h2>Login Failed</h2><p>Token exchange failed (no access_token in response)</p></body></html>";
}
