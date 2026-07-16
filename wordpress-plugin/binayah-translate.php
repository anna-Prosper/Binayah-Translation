<?php
/**
 * Plugin Name: Binayah Translate
 * Description: Custom AI Translation System for Binayah.com
 * Version: 1.7.41
 * Author: Binayah Team
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'BT_VERSION',    '1.7.41' );
define( 'BT_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'BT_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once BT_PLUGIN_DIR . 'includes/class-database.php';
require_once BT_PLUGIN_DIR . 'includes/class-languages.php';
require_once BT_PLUGIN_DIR . 'includes/class-api.php';
require_once BT_PLUGIN_DIR . 'includes/class-extractor.php';
require_once BT_PLUGIN_DIR . 'includes/class-frontend.php';
require_once BT_PLUGIN_DIR . 'includes/class-settings.php';

// When plugin is activated → create DB table
register_activation_hook( __FILE__, array( 'BT_Database', 'create_table' ) );

// Strip /ar/ /fr/ etc. from REQUEST_URI BEFORE WordPress parses the request.
// Priority 5 = early, before our own init at priority 10.
add_action( 'plugins_loaded', array( 'BT_Languages', 'strip_language_prefix' ), 5 );

// API URL setting in WP Admin > Settings > General
add_action( 'admin_init', function() {
    register_setting( 'general', 'bt_api_url', array(
        'type'              => 'string',
        'sanitize_callback' => 'esc_url_raw',
        'default'           => '',
    ) );
    add_settings_field(
        'bt_api_url', 'Binayah Translate API URL',
        function() {
            $val = esc_attr( get_option( 'bt_api_url', '' ) );
            echo '<input type="url" name="bt_api_url" value="' . $val . '" class="regular-text" placeholder="http://64.226.98.189/api" />';
            echo '<p class="description">URL of your Binayah Translate API server (no trailing slash)</p>';
        },
        'general', 'default'
    );
} );

// Start the plugin
add_action( 'plugins_loaded', 'bt_init', 10 );

function bt_init() {
    bt_migrate_api_url();
    BT_Languages::init();
    BT_API::init();
    BT_Frontend::init();
    if ( is_admin() ) { BT_Settings::init(); }
}

/**
 * One-time migration: the site used to point at a self-hosted API
 * (64.226.98.189) that still serves a stale 13-language config — which made
 * the plugin advertise hreflang for 11 untranslated languages and tied geoip
 * language detection to an unmanaged box. Repoint to the Render API.
 */
function bt_migrate_api_url() {
    $url = get_option( 'bt_api_url', '' );
    if ( $url && strpos( $url, '64.226.98.189' ) !== false ) {
        update_option( 'bt_api_url', 'https://binayah-translation-api.onrender.com' );
    }
}

/**
 * PHP 8 compatibility shim: mainwp-child's changes-logs module crashes on PHP 8+
 * when it intercepts wp_schedule_event / wp_clear_scheduled_hook calls
 * (get_option('gmt_offset') * HOUR_IN_SECONDS fails because gmt_offset is a string in PHP 8).
 * We unhook the two problematic callbacks before Houzez's init hook triggers them.
 * This runs entirely within our plugin — no other plugin files are modified.
 */
add_action( 'plugins_loaded', 'bt_mainwp_php8_compat', 999 );

function bt_mainwp_php8_compat() {
    if ( ! class_exists( 'MainWP\Child\Changes\Changes_Handle_WP_System' ) ) {
        return;
    }
    // These two callbacks crash on PHP 8+ due to string * int arithmetic.
    // Removing them only disables mainwp-child's cron-event change-logging;
    // all other mainwp-child functionality remains intact.
    remove_action( 'pre_unschedule_event', array( 'MainWP\Child\Changes\Changes_Handle_WP_System', 'callback_change_unschedule_cron_job' ), PHP_INT_MAX );
    remove_action( 'schedule_event',       array( 'MainWP\Child\Changes\Changes_Handle_WP_System', 'callback_change_create_new_cron_job' ) );
    // Also remove the pre_reschedule / pre_schedule variants to be safe
    remove_action( 'pre_reschedule_event', array( 'MainWP\Child\Changes\Changes_Handle_WP_System', 'change_pre_reschedule_event' ), PHP_INT_MAX );
    remove_action( 'pre_schedule_event',   array( 'MainWP\Child\Changes\Changes_Handle_WP_System', 'change_pre_schedule_event' ),   PHP_INT_MAX );
}
