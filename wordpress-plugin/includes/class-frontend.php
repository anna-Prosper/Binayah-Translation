<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BT_Frontend {

    private static $tx_cache    = array();
    private static $post_id_map = null;

    public static function init() {
        // Never run translations inside admin or AJAX calls
        if ( is_admin() || wp_doing_ajax() ) return;

        // Never run in Elementor editor / preview context
        if ( isset( $_GET['elementor-preview'] ) || isset( $_GET['et_fb'] ) ) return;

        // Never run when this is an internal render request (we are rendering for extraction)
        if ( isset( $_SERVER['HTTP_X_BT_RENDER'] ) ) return;

        add_action( 'init',               array( __CLASS__, 'detect_and_set_language' ) );
        add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
        add_shortcode( 'bt_lang_switcher', array( __CLASS__, 'language_switcher_shortcode' ) );
        add_action( 'template_redirect',  array( __CLASS__, 'maybe_geo_redirect' ), 0 );
        add_action( 'template_redirect',  array( __CLASS__, 'start_buffer' ), 1 );

        add_filter( 'the_title',            array( __CLASS__, 'filter_title' ), 20, 2 );
        add_filter( 'the_excerpt',          array( __CLASS__, 'filter_excerpt' ), 20 );
        add_filter( 'document_title_parts', array( __CLASS__, 'filter_doc_title' ), 20 );
        // Nav menu labels are translated here (scoped to real menu items) rather than
        // via whole-page substring replacement, which corrupted body text (H1).
        add_filter( 'nav_menu_item_title',  array( __CLASS__, 'filter_nav_menu_item_title' ), 20, 2 );

        if ( function_exists( 'acf_add_filter_modifiers' ) || class_exists( 'ACF' ) ) {
            add_filter( 'acf/load_value', array( __CLASS__, 'filter_acf_value' ), 20, 3 );
        }
    }

    // ── Language detection ──────────────────────────────────────────────────

    public static function detect_and_set_language() {
        // ── URL prefix is the ONLY source of content language ──────────────────
        // BT_Languages::strip_language_prefix() (priority 5) already parsed
        // /ar/, /ru/, /fr/ etc. from REQUEST_URI and set $current accordingly.

        if ( BT_Languages::$current !== 'en' ) {
            // Visiting /ru/page/ or /ar/page/ → use the URL language.
            // Persist it as a cookie only for the switcher's "selected" state.
            self::persist_cookie( BT_Languages::$current );
            return;
        }

        // ── Plain URL (no /lang/ prefix) → ALWAYS serve English ────────────────
        BT_Languages::$current = 'en';
        self::clear_cookie(); // clear any stale bt_lang cookie
        // GeoIP redirect is handled later at template_redirect (maybe_geo_redirect)
        // so that we can check whether the page has translations before redirecting.
    }

    // ── GeoIP redirect — fires at template_redirect (after WP query is parsed) ─

    public static function maybe_geo_redirect() {
        // Only applies to plain URL visits (no language prefix)
        if ( BT_Languages::$current !== 'en' ) return;
        if ( is_admin() || wp_doing_ajax() ) return;

        // User explicitly chose English via the language switcher → respect that choice
        if ( isset( $_COOKIE['bt_pref'] ) && $_COOKIE['bt_pref'] === 'en' ) return;

        // Detect visitor country → mapped language
        $geo_lang = self::lang_from_country();
        if ( ! $geo_lang || $geo_lang === 'en' ) return;

        $known = array_keys( BT_Languages::$languages );
        if ( ! in_array( $geo_lang, $known, true ) ) return;

        // ── Only redirect if this page actually has translations ───────────────
        // get_queried_object_id() is reliable here (template_redirect fires after
        // the main WP query is fully resolved).
        $post_id = get_queried_object_id();
        if ( $post_id ) {
            global $wpdb;
            $table = BT_Database::table();
            $count = (int) $wpdb->get_var( $wpdb->prepare(
                "SELECT COUNT(*) FROM {$table} WHERE post_id = %d AND language_code = %s AND status = 'done'",
                $post_id, $geo_lang
            ) );
            if ( $count === 0 ) return; // page not translated yet → stay on English
        }

        // Redirect to the geo-detected language URL (e.g. /ar/ or /ru/)
        $path    = parse_url( $_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH );
        $new_url = home_url( '/' . $geo_lang . rtrim( $path, '/' ) . '/' );
        wp_safe_redirect( $new_url, 302 );
        exit;
    }

    private static function persist_cookie( $lang ) {
        if ( $lang === 'en' ) {
            self::clear_cookie();
            return;
        }
        if ( ! isset( $_COOKIE['bt_lang'] ) || $_COOKIE['bt_lang'] !== $lang ) {
            setcookie( 'bt_lang', $lang, time() + 7 * DAY_IN_SECONDS, COOKIEPATH, COOKIE_DOMAIN, is_ssl(), false );
        }
    }

    private static function clear_cookie() {
        if ( isset( $_COOKIE['bt_lang'] ) ) {
            setcookie( 'bt_lang', '', time() - 3600, COOKIEPATH, COOKIE_DOMAIN, is_ssl(), false );
            unset( $_COOKIE['bt_lang'] );
        }
    }

    private static function lang_from_country() {
        // 1. Cloudflare sets this header automatically when site is proxied through CF
        $country = isset( $_SERVER['HTTP_CF_IPCOUNTRY'] )
            ? strtoupper( sanitize_text_field( $_SERVER['HTTP_CF_IPCOUNTRY'] ) ) : '';

        // 2. Fallback: ask our translation server to GeoIP the visitor's IP
        if ( ! $country || $country === 'XX' ) {
            $country = self::geoip_lookup();
        }

        if ( ! $country || $country === 'XX' ) return '';

        $map = get_transient( 'bt_country_map' );
        if ( false === $map ) {
            $map = self::fetch_country_map();
            set_transient( 'bt_country_map', $map, 6 * HOUR_IN_SECONDS );
        }
        return isset( $map[ $country ] ) ? $map[ $country ] : '';
    }

    private static function geoip_lookup() {
        // Determine real visitor IP (handle proxies / load balancers)
        $ip = '';
        foreach ( array( 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR' ) as $hdr ) {
            if ( ! empty( $_SERVER[ $hdr ] ) ) {
                $ip = trim( explode( ',', $_SERVER[ $hdr ] )[0] );
                break;
            }
        }
        // Skip private / reserved ranges — FILTER_FLAG_NO_RES_RANGE removed in PHP 8.0, use NO_PRIV_RANGE only
        if ( ! $ip || filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE ) === false ) {
            return '';
        }

        $cache_key = 'bt_geoip_' . md5( $ip );
        $cached    = get_transient( $cache_key );
        if ( $cached !== false ) return $cached;

        $api_url = get_option( 'bt_api_url', '' );
        if ( ! $api_url ) return '';

        $resp = wp_remote_get( rtrim( $api_url, '/' ) . '/languages/geoip/' . urlencode( $ip ), array( 'timeout' => 3 ) );
        if ( is_wp_error( $resp ) || wp_remote_retrieve_response_code( $resp ) !== 200 ) {
            set_transient( $cache_key, '', HOUR_IN_SECONDS );
            return '';
        }

        $data    = json_decode( wp_remote_retrieve_body( $resp ), true );
        $country = strtoupper( $data['country'] ?? '' );
        set_transient( $cache_key, $country, HOUR_IN_SECONDS );
        return $country;
    }

    private static function fetch_country_map() {
        $api_url = get_option( 'bt_api_url', '' );
        if ( ! $api_url ) return array();
        $resp = wp_remote_get( rtrim( $api_url, '/' ) . '/languages/country-map', array( 'timeout' => 5 ) );
        if ( is_wp_error( $resp ) || 200 !== wp_remote_retrieve_response_code( $resp ) ) return array();
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );
        return is_array( $data ) ? $data : array();
    }

    // ── Output buffer ───────────────────────────────────────────────────────

    public static function start_buffer() {
        if ( BT_Languages::$current === 'en' ) return;

        $lang    = BT_Languages::$current;
        $post_id = get_queried_object_id();

        // Redirect to English if singular page has no translations
        if ( is_singular() && $post_id ) {
            global $wpdb;
            $table = BT_Database::table();
            $has = (int) $wpdb->get_var( $wpdb->prepare(
                "SELECT COUNT(*) FROM {$table} WHERE post_id=%d AND language_code=%s AND status='done'",
                $post_id, $lang
            ) );
            if ( $has === 0 ) {
                wp_redirect( get_permalink( $post_id ), 302 );
                exit;
            }
        }

        ob_start( function( $html ) use ( $post_id, $lang ) {
            if ( $post_id > 0 ) {
                $html = self::apply_text_translations( $html, $post_id, $lang );
            }
            // Always apply global translations (nav menus, post_id = 0)
            $html = self::apply_text_translations( $html, 0, $lang );
            $html = self::rewrite_translated_links( $html, $lang );
            $html = self::add_lang_attributes( $html, $lang );
            return $html;
        } );
    }

    // ── Text replacement — the heart of frontend delivery ──────────────────

    // Bumped whenever a translation is saved (see class-api.php) so cached
    // replacement maps invalidate immediately after an edit.
    private static function tx_version() { return (int) get_option( 'bt_tx_ver', 0 ); }

    /**
     * Apply translations to the rendered HTML in a SINGLE strtr() pass using a
     * cached replacement map. strtr replaces the longest matching key at each
     * position, left-to-right, and never re-scans already-replaced output — so
     * one pass is both far faster than the old up-to-5N str_replace passes and
     * safer (a translated value that happens to contain an English word won't be
     * re-translated).
     */
    private static function apply_text_translations( $html, $post_id, $lang ) {
        $map = self::get_replacement_map( $post_id, $lang );
        if ( empty( $map ) ) return $html;
        return strtr( $html, $map );
    }

    /**
     * Build (and cache) the search→replace map for a post+language. Cached in a
     * transient keyed by post_id, lang, post_modified and the global tx version,
     * so it is rebuilt only when the page content or a translation actually
     * changes — not on every request (the previous code re-queried the DB and
     * re-parsed the whole Elementor tree on every non-English page view).
     */
    private static function get_replacement_map( $post_id, $lang ) {
        $modified = 0;
        if ( $post_id > 0 ) {
            $p = get_post( $post_id );
            $modified = $p ? strtotime( $p->post_modified_gmt ) : 0;
        }
        $cache_key = 'bt_map_' . $post_id . '_' . $lang . '_' . $modified . '_' . self::tx_version();
        $cached = get_transient( $cache_key );
        if ( is_array( $cached ) ) return $cached;

        $map = self::build_replacement_map( $post_id, $lang );
        set_transient( $cache_key, $map, 12 * HOUR_IN_SECONDS );
        return $map;
    }

    private static function build_replacement_map( $post_id, $lang ) {
        global $wpdb;
        $table = BT_Database::table();

        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT field_key, original_text, translated_text FROM {$table}
             WHERE post_id=%d AND language_code=%s AND status='done'
             AND translated_text IS NOT NULL AND CHAR_LENGTH(translated_text) > 0",
            $post_id, $lang
        ), ARRAY_A );

        if ( empty( $rows ) ) return array();

        // Live extracted values for this post (ensures we match against current HTML content).
        if ( $post_id === 0 ) {
            $extracted = BT_Extractor::extract_nav_menus();
        } else {
            $post      = get_post( $post_id );
            $extracted = $post ? BT_Extractor::extract( $post ) : array();
        }

        $current_by_field = array();
        foreach ( $rows as $row ) $current_by_field[ $row['field_key'] ] = $row['translated_text'];

        // ── Cross-language safety net ────────────────────────────────────────
        $other_rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT field_key, original_text, translated_text FROM {$table}
             WHERE post_id=%d AND language_code != %s AND status='done'
             AND translated_text IS NOT NULL AND CHAR_LENGTH(translated_text) > 0",
            $post_id, $lang
        ), ARRAY_A );

        $orig_english = array();
        foreach ( $other_rows as $orow ) {
            $fk = $orow['field_key'];
            if ( ! isset( $orig_english[ $fk ] ) && ! empty( $orow['original_text'] ) ) $orig_english[ $fk ] = $orow['original_text'];
        }

        $cross_pairs = array();
        foreach ( $other_rows as $orow ) {
            $fk = $orow['field_key']; $other = $orow['translated_text'];
            if ( empty( $other ) ) continue;
            if ( isset( $current_by_field[ $fk ] ) ) {
                if ( $other !== $current_by_field[ $fk ] ) $cross_pairs[] = array( $other, $current_by_field[ $fk ] );
            } elseif ( isset( $orig_english[ $fk ] ) ) {
                if ( $other !== $orig_english[ $fk ] ) $cross_pairs[] = array( $other, $orig_english[ $fk ] );
            }
        }

        // ── Primary pairs (English original → current lang) ─────────────────
        $pairs_p1 = array(); $pairs_p2 = array();
        foreach ( $rows as $row ) {
            $field_key  = $row['field_key'];
            $translated = $row['translated_text'];
            if ( empty( $translated ) ) continue;

            // H1: nav menu items (post_id=0, key nav:*:title) are translated directly
            // via the nav_menu_item_title filter (scoped to actual menu items). Applying
            // them here as whole-page substring replacements corrupted body text
            // (e.g. "Townhouse for Sale in Dubai" → "Townhouse for Продажа in Dubai").
            if ( $post_id === 0 && strpos( $field_key, 'nav:' ) === 0 ) continue;

            if ( isset( $extracted[ $field_key ] ) ) {
                $orig_data = $extracted[ $field_key ];
                $orig = is_array( $orig_data ) ? ( $orig_data['value'] ?? '' ) : (string) $orig_data;
                if ( ! empty( $orig ) && $orig !== $translated ) { $pairs_p1[] = array( $orig, $translated ); continue; }
            }
            if ( ! empty( $row['original_text'] ) && $row['original_text'] !== $translated ) {
                $pairs_p2[] = array( $row['original_text'], $translated );
            }
        }

        // Merge P1 first (manual/live wins), then P2, then cross-language fallback.
        // Dedup by orig so an earlier (higher-priority) pair is not overwritten.
        $map  = array();
        $seen = array();
        foreach ( array_merge( $pairs_p1, $pairs_p2, $cross_pairs ) as $pair ) {
            list( $orig, $trans ) = $pair;
            if ( $orig === '' || $orig === $trans ) continue;
            $k = md5( $orig );
            if ( isset( $seen[ $k ] ) ) continue;
            $seen[ $k ] = true;
            // Add every rendered variant of the original as a strtr key → translation.
            foreach ( self::orig_variants( $orig ) as $variant ) {
                if ( $variant !== '' && ! isset( $map[ $variant ] ) ) $map[ $variant ] = $trans;
            }
        }
        return $map;
    }

    /**
     * All the forms a stored original can take once WordPress renders it, so the
     * single strtr pass matches regardless: raw, HTML-entity-encoded, smart quotes,
     * and full wptexturize (ASCII quotes/dashes → curly-quote entities).
     */
    private static function orig_variants( $orig ) {
        $out = array( $orig );
        $encoded = htmlspecialchars( $orig, ENT_QUOTES | ENT_HTML5, 'UTF-8', false );
        if ( $encoded !== $orig ) $out[] = $encoded;
        $smartMap = array(
            array( "\u{2018}", "\u{2019}", "\u{201C}", "\u{201D}", "\u{2013}", "\u{2014}", "\u{2026}", "\u{00A0}" ),
            array( '&#8216;',  '&#8217;',  '&#8220;',  '&#8221;',  '&#8211;',  '&#8212;',  '&#8230;', '&nbsp;' ),
        );
        $smart = str_replace( $smartMap[0], $smartMap[1], $orig );
        if ( $smart !== $orig ) $out[] = $smart;
        if ( function_exists( 'wptexturize' ) ) {
            $textured = wptexturize( $orig );
            if ( $textured !== $orig ) $out[] = $textured;
            $textured_ent = str_replace( $smartMap[0], $smartMap[1], $textured );
            if ( $textured_ent !== $textured ) $out[] = $textured_ent;
        }
        return $out;
    }

    // ── H1: translate nav menu item titles directly (scoped, no leakage) ────
    private static $nav_map = array(); // lang => { itemID: translated }

    private static function nav_titles( $lang ) {
        if ( isset( self::$nav_map[ $lang ] ) ) return self::$nav_map[ $lang ];
        global $wpdb;
        $table = BT_Database::table();
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT field_key, translated_text FROM {$table}
             WHERE post_id=0 AND language_code=%s AND status='done'
             AND field_key LIKE 'nav:%%:title'
             AND translated_text IS NOT NULL AND CHAR_LENGTH(translated_text) > 0",
            $lang
        ), ARRAY_A );
        $map = array();
        foreach ( $rows as $row ) {
            // field_key format: nav:{location}:{itemID}:title  → grab the itemID segment
            $parts = explode( ':', $row['field_key'] );
            $n = count( $parts );
            if ( $n >= 3 ) $map[ $parts[ $n - 2 ] ] = $row['translated_text'];
        }
        self::$nav_map[ $lang ] = $map;
        return $map;
    }

    public static function filter_nav_menu_item_title( $title, $item ) {
        $lang = BT_Languages::$current ?? 'en';
        if ( $lang === 'en' || ! is_object( $item ) || empty( $item->ID ) ) return $title;
        $map = self::nav_titles( $lang );
        return isset( $map[ (string) $item->ID ] ) ? $map[ (string) $item->ID ] : $title;
    }

    // Add dir attribute to the <html> tag if not already set
    private static function add_lang_attributes( $html, $lang ) {
        if ( empty( BT_Languages::$languages[ $lang ] ) ) return $html;
        $info = BT_Languages::$languages[ $lang ];

        // Set lang attribute
        $html = preg_replace( '/<html([^>]*)lang="[^"]*"/', '<html$1lang="' . esc_attr( $lang ) . '"', $html, 1 );

        // Set dir attribute for RTL languages
        if ( isset( $info['dir'] ) && $info['dir'] === 'rtl' ) {
            if ( strpos( $html, 'dir="rtl"' ) === false ) {
                $html = preg_replace( '/<html([^>]*)>/', '<html$1 dir="rtl">', $html, 1 );
            }
        }
        return $html;
    }

    // ── Link rewriting — only for pages that HAVE translations ─────────────

    private static function rewrite_translated_links( $html, $lang ) {
        $translated_paths = self::get_translated_paths( $lang );
        if ( empty( $translated_paths ) ) return $html;

        $home = rtrim( home_url(), '/' );

        return preg_replace_callback(
            '/(href=["\'])(' . preg_quote( $home, '/' ) . ')(\/[^"\'#?]*)(["\'"])/i',
            function( $m ) use ( $lang, $home, $translated_paths ) {
                $path = rtrim( $m[3], '/' );
                if ( preg_match( '#^/[a-z]{2}($|/)#', $path ) ) return $m[0];
                if ( preg_match( '#^/(wp-admin|wp-content|wp-includes|wp-json|wp-login|wp-cron)#', $path ) ) return $m[0];

                $path_norm = '/' . trim( $path, '/' );
                if ( ! in_array( $path_norm, $translated_paths, true ) ) return $m[0];

                return $m[1] . $home . '/' . $lang . $path . $m[4];
            },
            $html
        );
    }

    private static function get_translated_paths( $lang ) {
        if ( self::$post_id_map !== null ) return self::$post_id_map;

        global $wpdb;
        $table = BT_Database::table();

        $ids = $wpdb->get_col( $wpdb->prepare(
            "SELECT DISTINCT post_id FROM {$table} WHERE language_code=%s AND status='done'", $lang
        ) );

        $paths = array();
        foreach ( $ids as $id ) {
            $permalink = get_permalink( (int) $id );
            if ( $permalink ) {
                $path = '/' . trim( str_replace( home_url(), '', $permalink ), '/' );
                $paths[] = $path;
            }
        }

        self::$post_id_map = $paths;
        return $paths;
    }

    // ── Language switcher shortcode ─────────────────────────────────────────

    public static function enqueue_assets() {
        wp_enqueue_style( 'flag-icons',
            'https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/css/flag-icons.min.css',
            array(), '7.2.3' );
    }

    public static function language_switcher_shortcode( $atts ) {
        $atts = shortcode_atts( array( 'show_native' => 'yes' ), $atts );

        // Ensure languages are loaded (not loaded on plain English URL visits)
        if ( empty( BT_Languages::$languages ) ) {
            BT_Languages::load();
        }

        $base_path = '';
        $post = get_post();
        if ( $post ) {
            $base_path = trim( str_replace( home_url(), '', get_permalink( $post->ID ) ), '/' );
        } else {
            $path  = trim( parse_url( $_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH ), '/' );
            $parts = explode( '/', $path );
            if ( isset( $parts[0] ) && array_key_exists( $parts[0], BT_Languages::$languages ) ) array_shift( $parts );
            $base_path = implode( '/', $parts );
        }

        $current     = BT_Languages::$current;
        $langs       = BT_Languages::$languages;
        $show_native = $atts['show_native'] === 'yes';

        $post_id = $post ? $post->ID : get_queried_object_id();

        // Fetch language codes that have at least one translation for this page
        $translated_langs = array();
        if ( $post_id ) {
            global $wpdb;
            $translated_langs = $wpdb->get_col( $wpdb->prepare(
                "SELECT DISTINCT language_code FROM " . BT_Database::table() .
                " WHERE post_id=%d AND status='done'", $post_id
            ) );
        }

        // Build the list: English is always first, then ONLY languages with translations for this page
        $display_langs = array(
            'en' => array( 'name' => 'English', 'native' => 'English', 'dir' => 'ltr', 'flag' => 'gb' ),
        );
        foreach ( $langs as $code => $info ) {
            if ( in_array( $code, $translated_langs, true ) ) {
                $display_langs[ $code ] = $info;
            }
        }

        ob_start();
        ?>
        <div class="bt-lang-switcher" style="display:inline-flex;align-items:center;">
            <select id="bt-lang-select"
                style="padding:8px 14px;border-radius:6px;border:1px solid #ccc;font-size:14px;cursor:pointer;background:#fff;"
                onchange="btSwitchLang(this)">
                <?php foreach ( $display_langs as $code => $info ) :
                    $url      = $code !== 'en'
                        ? home_url( '/' . $code . '/' . $base_path )
                        : home_url( '/' . $base_path );
                    $selected = $code === $current ? ' selected' : '';
                    $label    = $show_native ? ( $info['native'] ?? $info['name'] ) : $info['name'];
                ?>
                <option value="<?php echo esc_url( $url ); ?>"
                        data-code="<?php echo esc_attr( $code ); ?>"
                        <?php echo $selected; ?>>
                    <?php echo esc_html( $label ); ?>
                </option>
                <?php endforeach; ?>
            </select>
        </div>
        <script>
        (function() {
            var sel = document.getElementById('bt-lang-select');
            if (!sel) return;
            var path = window.location.pathname;
            var match = path.match(/^\/([a-z]{2})(\/|$)/);
            var urlLang = match ? match[1] : 'en';
            // Verify the URL lang matches a known option in this switcher
            var found = false;
            for (var i = 0; i < sel.options.length; i++) {
                if (sel.options[i].dataset.code === urlLang) {
                    sel.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            // If URL lang not found (e.g. unknown prefix), default to English
            if (!found) {
                for (var j = 0; j < sel.options.length; j++) {
                    if (sel.options[j].dataset.code === 'en') {
                        sel.selectedIndex = j;
                        break;
                    }
                }
            }
        })();
        function btSwitchLang(sel) {
            var code = sel.options[sel.selectedIndex].dataset.code;
            if (code === 'en') {
                // Delete the language cookie when switching to English
                document.cookie = 'bt_lang=;path=/;max-age=0;samesite=lax';
                // Remember user explicitly chose English → don't auto-redirect via GeoIP
                document.cookie = 'bt_pref=en;path=/;max-age=7776000;samesite=lax'; // 90 days
            } else {
                document.cookie = 'bt_lang=' + code + ';path=/;max-age=604800;samesite=lax';
                // Clear the "prefer English" flag so GeoIP can redirect again if needed
                document.cookie = 'bt_pref=;path=/;max-age=0;samesite=lax';
            }
            window.location.href = sel.value;
        }
        </script>
        <?php
        return ob_get_clean();
    }

    // ── WordPress-level filters ─────────────────────────────────────────────

    private static function get_translations( $post_id ) {
        $lang = BT_Languages::$current;
        if ( $lang === 'en' || ! $post_id ) return array();
        $ckey = $post_id . '_' . $lang;
        if ( ! isset( self::$tx_cache[ $ckey ] ) ) {
            self::$tx_cache[ $ckey ] = BT_Database::get_all_for_post( $post_id, $lang );
        }
        return self::$tx_cache[ $ckey ];
    }

    public static function filter_title( $title, $post_id = 0 ) {
        if ( BT_Languages::$current === 'en' || ! $post_id ) return $title;
        $tx = self::get_translations( $post_id );
        return isset( $tx['post_title'] ) ? $tx['post_title'] : $title;
    }

    public static function filter_doc_title( $parts ) {
        if ( BT_Languages::$current === 'en' || ! is_singular() ) return $parts;
        $post_id = get_the_ID();
        if ( ! $post_id ) return $parts;
        $tx = self::get_translations( $post_id );
        if ( isset( $tx['post_title'] ) ) $parts['title'] = $tx['post_title'];
        return $parts;
    }

    public static function filter_excerpt( $excerpt ) {
        if ( BT_Languages::$current === 'en' ) return $excerpt;
        $post_id = get_the_ID();
        if ( ! $post_id ) return $excerpt;
        $tx = self::get_translations( $post_id );
        return isset( $tx['post_excerpt'] ) ? $tx['post_excerpt'] : $excerpt;
    }

    public static function filter_acf_value( $value, $post_id, $field ) {
        if ( BT_Languages::$current === 'en' || empty( $field['name'] ) || ! is_string( $value ) ) return $value;
        $tx = self::get_translations( $post_id );
        return isset( $tx[ 'acf:' . $field['name'] ] ) ? $tx[ 'acf:' . $field['name'] ] : $value;
    }
}
