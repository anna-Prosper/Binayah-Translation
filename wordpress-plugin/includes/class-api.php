<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BT_API {

    public static function init() {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
        add_filter( 'rest_authentication_errors', array( __CLASS__, 'bypass_auth_for_our_routes' ), 20 );

        // Allow render bypass: when our API key is in a render header,
        // auto-set the current user so staging login walls don't block page rendering
        add_action( 'init', array( __CLASS__, 'maybe_bypass_login_for_render' ), 1 );
    }

    // Used by /page/{id}/html endpoint — bypasses staging login wall
    public static function maybe_bypass_login_for_render() {
        $header = isset( $_SERVER['HTTP_X_BT_RENDER'] ) ? $_SERVER['HTTP_X_BT_RENDER'] : '';
        if ( ! $header ) return;
        $stored = get_option( 'bt_api_key', '' );
        if ( empty( $stored ) || ! hash_equals( $stored, $header ) ) return;

        // Auto-authenticate as first admin so page renders fully
        if ( ! is_user_logged_in() ) {
            $admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ids' ) );
            if ( $admins ) wp_set_current_user( $admins[0] );
        }
    }

    public static function bypass_auth_for_our_routes( $result ) {
        $uri = isset( $_SERVER['REQUEST_URI'] ) ? $_SERVER['REQUEST_URI'] : '';
        if ( strpos( $uri, '/btranslate/v1' ) === false ) return $result;
        if ( strpos( $uri, '/btranslate/v1/health' ) !== false ) return true;

        $api_key = '';
        if ( ! empty( $_SERVER['HTTP_X_BINAYAH_API_KEY'] ) ) {
            $api_key = sanitize_text_field( $_SERVER['HTTP_X_BINAYAH_API_KEY'] );
        }
        $headers = function_exists( 'getallheaders' ) ? getallheaders() : array();
        if ( ! $api_key && ! empty( $headers['X-Binayah-API-Key'] ) )   $api_key = sanitize_text_field( $headers['X-Binayah-API-Key'] );
        if ( ! $api_key && ! empty( $headers['x-binayah-api-key'] ) )   $api_key = sanitize_text_field( $headers['x-binayah-api-key'] );

        if ( empty( $api_key ) ) return $result;
        $stored = get_option( 'bt_api_key', '' );
        if ( ! empty( $stored ) && hash_equals( $stored, $api_key ) ) return true;
        return new WP_Error( 'rest_forbidden', 'Invalid API key.', array( 'status' => 403 ) );
    }

    public static function check_auth( $request ) {
        $key = $request->get_header( 'X-Binayah-API-Key' );
        return $key === get_option( 'bt_api_key' );
    }

    public static function register_routes() {

        register_rest_route( 'btranslate/v1', '/health', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'health_check' ),
            'permission_callback' => '__return_true',
        ) );

        register_rest_route( 'btranslate/v1', '/post-types', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_post_types' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );

        register_rest_route( 'btranslate/v1', '/pages', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_pages' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );

        register_rest_route( 'btranslate/v1', '/page/(?P<id>\d+)/content', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_page_content' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );

        // NEW: returns text extracted from the actual rendered HTML of the page
        register_rest_route( 'btranslate/v1', '/page/(?P<id>\d+)/html', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_page_html_fields' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );

        register_rest_route( 'btranslate/v1', '/page/(?P<id>\d+)/save', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'save_translations' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );

        register_rest_route( 'btranslate/v1', '/page/(?P<id>\d+)/translations', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_translations' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );

        register_rest_route( 'btranslate/v1', '/stats', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_stats' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );
    }

    // ── Post types ──────────────────────────────────────────────────────────

    public static function get_post_types( $request ) {
        global $wpdb;
        $post_types = get_post_types( array( 'public' => true ), 'objects' );
        unset( $post_types['attachment'] );
        $result = array();
        foreach ( $post_types as $slug => $obj ) {
            $count = (int) $wpdb->get_var( $wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s AND post_status = 'publish'", $slug
            ) );
            if ( $count === 0 ) continue;
            $result[] = array( 'slug' => $slug, 'label' => $obj->labels->name, 'count' => $count );
        }
        usort( $result, function( $a, $b ) { return $b['count'] - $a['count']; } );
        return rest_ensure_response( $result );
    }

    // ── Pages list ──────────────────────────────────────────────────────────

    public static function get_pages( $request ) {
        global $wpdb;
        $post_type = $request->get_param( 'post_type' ) ?: 'all';
        $per_page  = min( (int) ( $request->get_param( 'per_page' ) ?: 50 ), 200 );
        $page      = max( (int) ( $request->get_param( 'page' )     ?: 1  ), 1  );
        $search    = sanitize_text_field( $request->get_param( 'search' ) ?: '' );
        $offset    = ( $page - 1 ) * $per_page;

        if ( $post_type === 'all' ) {
            $all_types = get_post_types( array( 'public' => true ) );
            unset( $all_types['attachment'] );
            $type_list = array_values( $all_types );
        } else {
            $type_list = array( $post_type );
        }

        $args = array(
            'post_status'    => 'publish',
            'posts_per_page' => $per_page,
            'offset'         => $offset,
            'post_type'      => $type_list,
            'orderby'        => 'post_type',
            'order'          => 'ASC',
        );
        if ( ! empty( $search ) ) $args['s'] = $search;

        $posts = get_posts( $args );
        $table = BT_Database::table();
        $data  = array();

        foreach ( $posts as $post ) {
            $translated_languages = $wpdb->get_col( $wpdb->prepare(
                "SELECT DISTINCT language_code FROM {$table} WHERE post_id = %d AND status = 'done'",
                $post->ID
            ) );
            $data[] = array(
                'id'                   => $post->ID,
                'post_id'              => $post->ID,
                'post_type'            => $post->post_type,
                'title'                => $post->post_title ?: '(no title)',
                'slug'                 => $post->post_name,
                'url'                  => get_permalink( $post->ID ),
                'modified'             => $post->post_modified,
                'translated_languages' => $translated_languages ?: array(),
                'status'               => count( $translated_languages ) >= 10 ? 'complete'
                                          : ( count( $translated_languages ) > 0 ? 'partial' : 'not_started' ),
            );
        }

        $count_args = $args;
        $count_args['fields'] = 'ids';
        unset( $count_args['posts_per_page'], $count_args['offset'] );
        $count_args['posts_per_page'] = -1;
        $total       = count( get_posts( $count_args ) );
        $total_pages = (int) ceil( $total / $per_page );

        return rest_ensure_response( array(
            'page' => $page, 'per_page' => $per_page,
            'total' => $total, 'total_pages' => $total_pages,
            'post_type' => $post_type, 'data' => $data,
        ) );
    }

    // ── Page content (field extraction) ─────────────────────────────────────

    public static function get_page_content( $request ) {
        $post_id = (int) $request['id'];
        $post    = get_post( $post_id );
        if ( ! $post ) return new WP_Error( 'not_found', 'Post not found', array( 'status' => 404 ) );
        $fields = BT_Extractor::extract( $post );
        return rest_ensure_response( array(
            'post_id'    => $post_id,
            'post_type'  => $post->post_type,
            'post_title' => $post->post_title,
            'fields'     => $fields,
        ) );
    }

    // ── Page HTML — renders actual page and extracts ALL text from it ────────

    public static function get_page_html_fields( $request ) {
        $post_id = (int) $request['id'];
        $post    = get_post( $post_id );
        if ( ! $post ) return new WP_Error( 'not_found', 'Post not found', array( 'status' => 404 ) );

        $url = get_permalink( $post_id );

        // Fetch rendered HTML with bypass header (our plugin auto-logs in when this header is set)
        $resp = wp_remote_get( $url, array(
            'timeout'   => 30,
            'sslverify' => false,
            'headers'   => array(
                'X-BT-Render'       => get_option( 'bt_api_key', '' ),
                'X-Binayah-API-Key' => get_option( 'bt_api_key', '' ),
            ),
        ) );

        // Fall back to extractor if fetch fails
        if ( is_wp_error( $resp ) || wp_remote_retrieve_response_code( $resp ) !== 200 ) {
            $fields = BT_Extractor::extract( $post );
            return rest_ensure_response( array(
                'post_id' => $post_id, 'post_title' => $post->post_title,
                'fields'  => $fields, 'source' => 'extractor_fallback',
            ) );
        }

        $html   = wp_remote_retrieve_body( $resp );
        $fields = self::extract_text_nodes_from_html( $html );

        // Always include post_title explicitly
        if ( $post->post_title && ! isset( $fields['post_title'] ) ) {
            $fields = array( 'post_title' => array( 'value' => $post->post_title, 'type' => 'text' ) ) + $fields;
        }

        return rest_ensure_response( array(
            'post_id'    => $post_id,
            'post_title' => $post->post_title,
            'fields'     => $fields,
            'source'     => 'html',
        ) );
    }

    private static function extract_text_nodes_from_html( $html ) {
        // Remove elements that should never be translated
        $html = preg_replace( '/<script[^>]*>.*?<\/script>/si',   '', $html );
        $html = preg_replace( '/<style[^>]*>.*?<\/style>/si',     '', $html );
        $html = preg_replace( '/<noscript[^>]*>.*?<\/noscript>/si', '', $html );
        $html = preg_replace( '/<!--.*?-->/s',                     '', $html );

        // Extract text content between tags
        preg_match_all( '/>([^<]{3,})</u', $html, $matches );

        $fields = array();
        $seen   = array();
        $i      = 0;

        foreach ( $matches[1] as $raw ) {
            $text = trim( html_entity_decode( $raw, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
            if ( mb_strlen( $text ) < 3 )                               continue;
            if ( is_numeric( $text ) )                                   continue;
            if ( filter_var( $text, FILTER_VALIDATE_URL ) )             continue;
            if ( preg_match( '/^[\d\s.,\-+%()\/]+$/', $text ) )         continue;
            // Skip slug/code-like tokens (all-lowercase with optional hyphens/underscores — CSS classes, IDs, slugs).
            // Allow capitalized or mixed-case words like "Sale", "Rent", "Search", "Bedrooms".
            if ( preg_match( '/^[a-z][a-z0-9_\-]{1,29}$/', $text ) )      continue; // lowercase slug
            if ( mb_strlen( $text ) <= 2 )                                 continue; // 1–2 char tokens
            if ( isset( $seen[ $text ] ) )                               continue; // deduplicate

            $seen[ $text ] = true;
            $key = 'html:' . $i;
            $fields[ $key ] = array( 'value' => $text, 'type' => 'text' );
            $i++;
        }

        return $fields;
    }

    // ── Save translations — FIXED: gets original_text from extractor ─────────

    public static function save_translations( $request ) {
        $post_id = (int) $request['id'];
        $body    = $request->get_json_params();
        $lang    = sanitize_text_field( $body['language_code'] ?? '' );
        $fields  = $body['fields'] ?? array();
        $by      = sanitize_text_field( $body['translated_by'] ?? 'api' );

        if ( ! $lang || empty( $fields ) ) {
            return new WP_Error( 'bad_request', 'Missing language_code or fields', array( 'status' => 400 ) );
        }

        // Extract original field values from the post — this is the CORRECT original_text
        $post      = get_post( $post_id );
        $extracted = $post ? BT_Extractor::extract( $post ) : array();

        $saved = 0; $failed = 0;
        foreach ( $fields as $field_key => $translated_text ) {
            // Get the actual original English text for this field
            if ( isset( $extracted[ $field_key ] ) ) {
                $orig_data = $extracted[ $field_key ];
                $original  = is_array( $orig_data ) ? ( $orig_data['value'] ?? '' ) : (string) $orig_data;
                $ftype     = is_array( $orig_data ) ? ( $orig_data['type']  ?? 'text' ) : 'text';
            } elseif ( $field_key === 'post_title' && $post ) {
                $original = $post->post_title;
                $ftype    = 'text';
            } elseif ( str_starts_with( $field_key, 'html:' ) ) {
                // HTML-source fields: original_text is in the field key hint from translation server
                $original = $body['originals'][ $field_key ] ?? '';
                $ftype    = 'text';
            } else {
                $original = '';
                $ftype    = 'text';
            }

            try {
                BT_Database::save_translation(
                    $post_id,
                    sanitize_text_field( $field_key ),
                    sanitize_text_field( $ftype ),
                    $lang,
                    $original,
                    wp_kses_post( $translated_text ),
                    $by
                );
                $saved++;
            } catch ( Exception $e ) {
                $failed++;
            }
        }

        return rest_ensure_response( array( 'saved' => $saved, 'failed' => $failed, 'status' => 'success' ) );
    }

    // ── Translations for a post ──────────────────────────────────────────────

    public static function get_translations( $request ) {
        global $wpdb;
        $post_id = (int) $request['id'];
        $lang    = sanitize_text_field( $request->get_param( 'lang' ) ?: 'ar' );
        $table   = BT_Database::table();

        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT field_key, translated_text FROM {$table} WHERE post_id = %d AND language_code = %s",
            $post_id, $lang
        ), ARRAY_A );

        $result = array();
        foreach ( $rows as $row ) {
            $result[ $row['field_key'] ] = $row['translated_text'];
        }
        return rest_ensure_response( $result );
    }

    // ── Stats ────────────────────────────────────────────────────────────────

    public static function get_stats( $request ) {
        global $wpdb;
        $table     = BT_Database::table();
        $all_types = get_post_types( array( 'public' => true ) );
        unset( $all_types['attachment'] );
        $placeholders = implode( ',', array_fill( 0, count( $all_types ), '%s' ) );
        $total = (int) $wpdb->get_var( $wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_type IN ($placeholders)",
            array_values( $all_types )
        ) );

        $rows = $wpdb->get_results(
            "SELECT language_code, COUNT(DISTINCT post_id) as done_posts
             FROM {$table} WHERE status = 'done' GROUP BY language_code", ARRAY_A
        );

        $by_language = array(); $translated_count = 0;
        foreach ( $rows as $row ) {
            $by_language[ $row['language_code'] ] = (int) $row['done_posts'];
            $translated_count += (int) $row['done_posts'];
        }

        return rest_ensure_response( array(
            'total_pages'      => $total,
            'total_posts'      => $total,
            'translated_count' => $translated_count,
            'pending_count'    => max( 0, ( $total * 10 ) - $translated_count ),
            'by_language'      => $by_language,
        ) );
    }

    // ── Health ───────────────────────────────────────────────────────────────

    public static function health_check() {
        global $wpdb;
        $table  = BT_Database::table();
        $exists = $wpdb->get_var( "SHOW TABLES LIKE '{$table}'" ) === $table;
        return rest_ensure_response( array(
            'status'       => 'ok',
            'plugin'       => defined( 'BT_VERSION' ) ? BT_VERSION : '1.0.0',
            'table_exists' => $exists,
            'api_key_set'  => (bool) get_option( 'bt_api_key' ),
        ) );
    }
}
