<?php
/** Sample wp-config.php with the classic 3-byte utf8 misconfiguration. */
define( 'DB_NAME', 'wp_legacy' );
define( 'DB_USER', 'wpuser' );
define( 'DB_HOST', 'localhost' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', 'utf8_general_ci' );

$table_prefix = 'wp_';
require_once ABSPATH . 'wp-settings.php';
