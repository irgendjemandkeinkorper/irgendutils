<?php
/** Sample wp-config.php with correct utf8mb4 settings. */
define('DB_NAME', 'wp_site');
define('DB_USER', 'wpuser');
define('DB_HOST', '127.0.0.1');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

$table_prefix = 'wp_';
require_once ABSPATH . 'wp-settings.php';
