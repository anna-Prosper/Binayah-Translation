<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BT_Languages {

    public static $current       = 'en';
    public static $original_path = '';
    public static $languages     = array(); // keyed by code, loaded from API

    // Minimal fallback if API unreachable and no transient yet
    private static $fallback = array(
        'en' => array( 'name' => 'English', 'native' => 'English', 'dir' => 'ltr', 'flag' => 'gb', 'countries' => array() ),
        'ar' => array( 'name' => 'Arabic',  'native' => 'العربية', 'dir' => 'rtl', 'flag' => 'sa', 'countries' => array() ),
    );

    // ── Load from /api/languages/config (transient-cached 6h) ───────────────

    public static function load() {
        // Keyed by BT_VERSION so a plugin deploy busts a stale language list
        // (an old unversioned transient once pinned 13 languages for days).
        $cached = get_transient( 'bt_languages_' . BT_VERSION );
        if ( is_array( $cached ) && ! empty( $cached ) ) {
            self::$languages = $cached;
            return;
        }

        $api_url = get_option( 'bt_api_url', '' );
        if ( $api_url ) {
            $resp = wp_remote_get( rtrim( $api_url, '/' ) . '/languages/config', array( 'timeout' => 5 ) );
            if ( ! is_wp_error( $resp ) && 200 === wp_remote_retrieve_response_code( $resp ) ) {
                $data = json_decode( wp_remote_retrieve_body( $resp ), true );
                if ( is_array( $data ) && ! empty( $data ) ) {
                    // API returns array of objects — convert to code-keyed map
                    $languages = array();
                    foreach ( $data as $lang ) {
                        if ( empty( $lang['code'] ) ) continue;
                        if ( isset( $lang['enabled'] ) && $lang['enabled'] === false ) continue;
                        $code = $lang['code'];
                        $languages[ $code ] = array(
                            'name'      => $lang['name']      ?? $code,
                            'native'    => $lang['native']    ?? $lang['name'] ?? $code,
                            'dir'       => $lang['dir']       ?? 'ltr',
                            'flag'      => $lang['flag']      ?? $code,
                            'countries' => $lang['countries'] ?? array(),
                        );
                    }
                    if ( ! empty( $languages ) ) {
                        self::$languages = $languages;
                        set_transient( 'bt_languages_' . BT_VERSION, $languages, 6 * HOUR_IN_SECONDS );
                        return;
                    }
                }
            }
        }

        // Fallback
        self::$languages = self::$fallback;
    }

    // ── plugins_loaded priority 5 — strip /ar/ prefix before WP routing ─────

    public static function strip_language_prefix() {
        $uri   = isset( $_SERVER['REQUEST_URI'] ) ? $_SERVER['REQUEST_URI'] : '';
        $path  = trim( parse_url( $uri, PHP_URL_PATH ), '/' );
        $parts = explode( '/', $path );
        $first = isset( $parts[0] ) ? $parts[0] : '';

        if ( strlen( $first ) !== 2 || $first === 'en' || ! preg_match( '/^[a-z]{2}$/', $first ) ) return;

        if ( empty( self::$languages ) ) self::load();

        if ( ! array_key_exists( $first, self::$languages ) ) return;

        self::$current       = $first;
        self::$original_path = $path;

        array_shift( $parts );
        $clean = '/' . implode( '/', $parts );
        $query = parse_url( $uri, PHP_URL_QUERY );
        $_SERVER['REQUEST_URI'] = $clean . ( $query ? '?' . $query : '' );
    }

    // ── plugins_loaded (bt_init) ─────────────────────────────────────────────

    public static function init() {
        if ( empty( self::$languages ) ) self::load();

        add_action( 'wp_head',             array( __CLASS__, 'add_hreflang_tags' ) );
        add_filter( 'language_attributes', array( __CLASS__, 'add_dir_attribute' ) );
    }

    public static function add_dir_attribute( $output ) {
        $lang = self::$current;
        if ( isset( self::$languages[ $lang ]['dir'] ) && self::$languages[ $lang ]['dir'] === 'rtl' ) {
            $output .= ' dir="rtl"';
        }
        return $output;
    }

    public static function add_hreflang_tags() {
        if ( ! is_singular() ) return;
        $post = get_post();
        if ( ! $post ) return;

        $permalink = get_permalink( $post->ID );
        $base_path = trim( str_replace( home_url(), '', $permalink ), '/' );

        // The EN page is also the fallback for unmatched languages (x-default).
        echo '<link rel="alternate" hreflang="en" href="' . esc_url( home_url( '/' . $base_path ) ) . '" />' . "\n";
        echo '<link rel="alternate" hreflang="x-default" href="' . esc_url( home_url( '/' . $base_path ) ) . '" />' . "\n";
        foreach ( self::$languages as $code => $info ) {
            if ( $code === 'en' ) continue;
            echo '<link rel="alternate" hreflang="' . esc_attr( $code ) . '" href="' . esc_url( home_url( '/' . $code . '/' . $base_path ) ) . '" />' . "\n";
        }
    }

    public static function is_active() {
        return self::$current !== 'en';
    }
}
