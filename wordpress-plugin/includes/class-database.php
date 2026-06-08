<?php
// Stop direct access
if ( ! defined( 'ABSPATH' ) ) exit;

class BT_Database {

    // This runs when plugin is activated
    // Creates our custom translations table in WordPress database
    public static function create_table() {
        global $wpdb;

        // Our table name (uses WordPress prefix like wp_)
        $table = $wpdb->prefix . 'binayah_translations';

        // Get WordPress charset (utf8mb4 supports Arabic, Chinese etc)
        $charset = $wpdb->get_charset_collate();

        // The SQL to create our table
        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            id              BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            post_id         BIGINT(20) UNSIGNED NOT NULL,
            field_key       VARCHAR(500)        NOT NULL,
            field_type      VARCHAR(50)         NOT NULL DEFAULT 'text',
            language_code   VARCHAR(10)         NOT NULL,
            original_text   LONGTEXT,
            translated_text LONGTEXT,
            word_count      INT(11)             DEFAULT 0,
            translated_by   VARCHAR(20)         DEFAULT 'pending',
            status          VARCHAR(20)         DEFAULT 'pending',
            quality_score   TINYINT(1)          DEFAULT NULL,
            hash            VARCHAR(32)         DEFAULT NULL,
            created_at      DATETIME            DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME            DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            translated_at   DATETIME            DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY unique_translation (post_id, field_key(200), language_code),
            KEY idx_post_lang   (post_id, language_code),
            KEY idx_status_lang (status, language_code),
            KEY idx_field_type  (field_type, language_code)
        ) {$charset};";

        // WordPress function that safely runs CREATE TABLE
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $sql );

        // Save plugin version in WordPress settings
        update_option( 'bt_version', BT_VERSION );

        // Generate and save a random API key (used to secure REST API)
        if ( ! get_option( 'bt_api_key' ) ) {
            update_option( 'bt_api_key', bin2hex( random_bytes( 32 ) ) );
        }

        // bt_api_url is set manually by admin (e.g. http://64.226.98.189/api)
        // We only create the option if it doesn't exist yet
        if ( ! get_option( 'bt_api_url' ) ) {
            add_option( 'bt_api_url', '' );
        }
    }

    // Helper: get our table name
    public static function table() {
        global $wpdb;
        return $wpdb->prefix . 'binayah_translations';
    }

    // Save a translation to the database
    public static function save_translation( $post_id, $field_key, $field_type, $lang, $original, $translated, $by = 'api' ) {
        global $wpdb;
        $table = self::table();
        $wpdb->query( $wpdb->prepare(
            "INSERT INTO {$table}
                (post_id, field_key, field_type, language_code, original_text, translated_text, translated_by, status, hash, translated_at)
             VALUES (%d, %s, %s, %s, %s, %s, %s, 'done', %s, %s)
             ON DUPLICATE KEY UPDATE
                field_type      = VALUES(field_type),
                original_text   = VALUES(original_text),
                translated_text = VALUES(translated_text),
                translated_by   = VALUES(translated_by),
                status          = 'done',
                hash            = VALUES(hash),
                translated_at   = VALUES(translated_at)",
            $post_id, $field_key, $field_type, $lang,
            $original, $translated, $by,
            md5( $original ), current_time( 'mysql' )
        ) );
    }

    // Get one translation
    public static function get_translation( $post_id, $field_key, $lang ) {
        global $wpdb;

        return $wpdb->get_var( $wpdb->prepare(
            "SELECT translated_text FROM " . self::table() .
            " WHERE post_id = %d AND field_key = %s AND language_code = %s AND status = 'done'",
            $post_id, $field_key, $lang
        ) );
    }

    // Get ALL translations for one post in one language
    public static function get_all_for_post( $post_id, $lang ) {
        global $wpdb;

        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT field_key, translated_text FROM " . self::table() .
            " WHERE post_id = %d AND language_code = %s AND status = 'done'",
            $post_id, $lang
        ), ARRAY_A );

        // Return as simple key => value array
        $result = array();
        foreach ( $rows as $row ) {
            $result[ $row['field_key'] ] = $row['translated_text'];
        }
        return $result;
    }
}