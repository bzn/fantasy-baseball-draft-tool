<?php
/**
 * Yahoo Fantasy API Configuration (Sample)
 *
 * Instructions:
 * 1. Go to https://developer.yahoo.com/apps/ and create a new app
 * 2. Set Application Type to "Installed Application"
 * 3. Set Redirect URI to: https://localhost/fantasy-baseball-draft-tool/api/callback.php
 * 4. Select "Fantasy Sports" API permission (Read)
 * 5. Copy your Client ID and Client Secret below
 * 6. Save this file as yahoo-config.php
 */

return [
    'client_id'     => 'YOUR_YAHOO_CLIENT_ID',
    'client_secret' => 'YOUR_YAHOO_CLIENT_SECRET',
    'redirect_uri'  => 'https://localhost/fantasy-baseball-draft-tool/api/callback.php',

    // Yahoo OAuth 2.0 endpoints
    'auth_url'      => 'https://api.login.yahoo.com/oauth2/request_auth',
    'token_url'     => 'https://api.login.yahoo.com/oauth2/get_token',
    'api_base'      => 'https://fantasysports.yahooapis.com/fantasy/v2',

    // Token storage path (relative to this file)
    'token_file'    => __DIR__ . '/../data/yahoo_token.json',

    // Fantasy Baseball game key
    // Use 'mlb' to auto-resolve current season, or a specific number (e.g. 449=2025)
    'game_key'      => 'mlb',
];
