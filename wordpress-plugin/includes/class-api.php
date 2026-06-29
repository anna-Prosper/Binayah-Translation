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

                register_rest_route( 'btranslate/v1', '/page/(?P<id>\d+)/urls', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_page_language_urls' ),
            'permission_callback' => array( __CLASS__, 'check_api_key' ),
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
        register_rest_route( 'btranslate/v1', '/pages/search-by-url', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'search_by_url' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );
        register_rest_route( 'btranslate/v1', '/front-page', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'get_front_page' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );
        register_rest_route( 'btranslate/v1', '/translations/lookup', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'lookup_translations' ),
            'permission_callback' => array( __CLASS__, 'check_auth' ),
        ) );
    }

    // ── Post types ──────────────────────────────────────────────────────────

    public static function get_post_types( $request ) {
        global $wpdb;
        $post_types = get_post_types( array( 'public' => true ), 'objects' );
        unset( $post_types['attachment'] );
        $type_slugs   = array_keys( $post_types );
        $placeholders = implode( ',', array_fill( 0, count( $type_slugs ), '%s' ) );
        $count_rows   = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT post_type, COUNT(*) as cnt FROM {$wpdb->posts}
                 WHERE post_status = 'publish' AND post_type IN ({$placeholders})
                 GROUP BY post_type",
                ...$type_slugs
            ),
            ARRAY_A
        );
        $count_map = array_column( $count_rows, 'cnt', 'post_type' );
        $result    = array();
        foreach ( $post_types as $slug => $obj ) {
            $count = (int) ( $count_map[ $slug ] ?? 0 );
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
        // ── Execute query: title + slug (URL) search support ───────────────
        if ( ! empty( $search ) ) {
            // 1. Title matches via WP native search
            $title_args               = array_merge( $args, array( 's' => $search, 'fields' => 'ids', 'posts_per_page' => -1, 'offset' => 0 ) );
            $title_ids                = array_map( 'intval', get_posts( $title_args ) );

            // 2. Slug / URL matches via direct SQL
            $like              = '%' . $wpdb->esc_like( $search ) . '%';
            $type_placeholders = implode( ',', array_fill( 0, count( $type_list ), '%s' ) );
            $slug_ids          = array_map( 'intval', (array) $wpdb->get_col(
                $wpdb->prepare(
                    "SELECT ID FROM {$wpdb->posts} WHERE post_type IN ($type_placeholders) AND post_status = 'publish' AND post_name LIKE %s",
                    array_merge( $type_list, array( $like ) )
                )
            ) );

            // 3. Merge: title matches first, then slug-only matches (preserves relevance order)
            $slug_only = array_values( array_diff( $slug_ids, $title_ids ) );
            $all_ids   = array_values( array_unique( array_merge( $title_ids, $slug_only ) ) );

            $total       = count( $all_ids );
            $total_pages = max( 1, (int) ceil( $total / $per_page ) );
            $paged_ids   = array_slice( $all_ids, $offset, $per_page );

            if ( empty( $paged_ids ) ) {
                return rest_ensure_response( array(
                    'page' => $page, 'per_page' => $per_page,
                    'total' => 0, 'total_pages' => 0,
                    'post_type' => $post_type, 'data' => array(),
                ) );
            }

            $posts = get_posts( array(
                'post_type'      => $type_list,
                'post_status'    => 'publish',
                'post__in'       => $paged_ids,
                'orderby'        => 'post__in',
                'posts_per_page' => $per_page,
                'no_found_rows'  => true,
            ) );
        } else {
            $posts = get_posts( $args );

            $type_ph     = implode( ',', array_fill( 0, count( $type_list ), '%s' ) );
            $total       = (int) $wpdb->get_var(
                $wpdb->prepare(
                    "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_type IN ({$type_ph})",
                    ...$type_list
                )
            );
            $total_pages = (int) ceil( $total / $per_page );
        }

        $table    = BT_Database::table();
        $data     = array();
        $post_ids = wp_list_pluck( $posts, 'ID' );

        // Batch-fetch all translated languages for all posts in one query
        $langs_by_post = array();
        if ( ! empty( $post_ids ) ) {
            $id_ph     = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
            $lang_rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT DISTINCT post_id, language_code FROM {$table}
                     WHERE post_id IN ({$id_ph}) AND status = 'done'",
                    ...$post_ids
                ),
                ARRAY_A
            );
            foreach ( $lang_rows as $r ) {
                $langs_by_post[ (int) $r['post_id'] ][] = $r['language_code'];
            }
        }

        foreach ( $posts as $post ) {
            $translated_languages = $langs_by_post[ $post->ID ] ?? array();
            $data[] = array(
                'id'                   => $post->ID,
                'post_id'              => $post->ID,
                'post_type'            => $post->post_type,
                'title'                => $post->post_title ?: '(no title)',
                'slug'                 => $post->post_name,
                'url'                  => get_permalink( $post->ID ),
                'modified'             => $post->post_modified,
                'translated_languages' => $translated_languages,
                'status'               => count( $translated_languages ) >= 10 ? 'complete'
                                          : ( count( $translated_languages ) > 0 ? 'partial' : 'not_started' ),
            );
        }

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
            'url'        => get_permalink( $post_id ),
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
                'url'     => get_permalink( $post_id ),
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

        // Extract placeholder attributes from inputs/textareas
        preg_match_all( '/\\bplaceholder=[\"\']([^\"\']{3,})[\"\']/', $html, $ph_matches );
        // Extract value from submit/button inputs
        preg_match_all( '/<input[^>]+type=[\"\'](?:submit|button)[\"\'][^>]+value=[\"\']([^\"\']{3,})[\"\']/', $html, $sv1 );
        preg_match_all( '/<input[^>]+value=[\"\']([^\"\']{3,})[\"\'][^>]+type=[\"\'](?:submit|button)[\"\']/', $html, $sv2 );
        // Extract aria-label from buttons/links
        preg_match_all( '/\\baria-label=[\"\']([^\"\']{3,})[\"\']/', $html, $al_matches );

        // Extract text content between tags
        preg_match_all( '/>([^<]{3,})</u', $html, $matches );

        // Merge: attribute texts first, then text nodes
        $all_texts = array_merge( $ph_matches[1], $sv1[1], $sv2[1], $al_matches[1], $matches[1] );

        $fields = array();
        $seen   = array();
        $i      = 0;

        foreach ( $all_texts as $raw ) {
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

        $batch = array();
        foreach ( $fields as $field_key => $translated_text ) {
            if ( isset( $extracted[ $field_key ] ) ) {
                $orig_data = $extracted[ $field_key ];
                $original  = is_array( $orig_data ) ? ( $orig_data['value'] ?? '' ) : (string) $orig_data;
                $ftype     = is_array( $orig_data ) ? ( $orig_data['type']  ?? 'text' ) : 'text';
            } elseif ( $field_key === 'post_title' && $post ) {
                $original = $post->post_title;
                $ftype    = 'text';
            } elseif ( str_starts_with( $field_key, 'html:' ) ) {
                $original = $body['originals'][ $field_key ] ?? '';
                $ftype    = 'text';
            } else {
                $original = '';
                $ftype    = 'text';
            }
            $batch[] = array(
                'post_id'    => $post_id,
                'field_key'  => sanitize_text_field( $field_key ),
                'field_type' => sanitize_text_field( $ftype ),
                'lang'       => $lang,
                'original'   => $original,
                'translated' => wp_kses_post( $translated_text ),
                'by'         => $by,
            );
        }

        BT_Database::save_translations_batch( $batch );
        $saved = count( $batch );

        return rest_ensure_response( array( 'saved' => $saved, 'failed' => 0, 'status' => 'success' ) );
    }


    // ── Cross-page translation lookup ────────────────────────────────────────

    public static function lookup_translations( $request ) {
        global $wpdb;
        $body  = $request->get_json_params();
        $lang  = sanitize_text_field( $body['lang'] ?? '' );
        $texts = isset( $body['texts'] ) ? (array) $body['texts'] : array();

        if ( ! $lang || empty( $texts ) ) {
            return rest_ensure_response( (object) array() );
        }

        $table    = BT_Database::table();
        // Use hash index for fast LONGTEXT lookup instead of scanning original_text
        $hashes      = array_map( 'md5', $texts );
        $hash_to_text = array_combine( $hashes, $texts );
        $placeholders = implode( ',', array_fill( 0, count( $hashes ), '%s' ) );
        $query_args   = array_merge( array( $lang ), $hashes );
        $rows         = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT hash, translated_text FROM {$table}
                 WHERE language_code = %s AND hash IN ({$placeholders}) AND status = 'done'",
                ...$query_args
            ),
            ARRAY_A
        );

        $result = array();
        foreach ( $rows as $row ) {
            $original = $hash_to_text[ $row['hash'] ] ?? null;
            if ( $original !== null && ! isset( $result[ $original ] ) ) {
                $result[ $original ] = $row['translated_text'];
            }
        }
        return rest_ensure_response( $result );
    }

    // ── Translations for a post ──────────────────────────────────────────────

    public static function get_translations( $request ) {
        global $wpdb;
        $post_id = (int) $request['id'];
        $lang    = sanitize_text_field( $request->get_param( 'lang' ) ?: 'ar' );
        $table   = BT_Database::table();

        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT field_key, translated_text FROM {$table} WHERE post_id = %d AND language_code = %s AND status = 'done'",
            $post_id, $lang
        ), ARRAY_A );

        $result = array();
        foreach ( $rows as $row ) {
            $result[ $row['field_key'] ] = $row['translated_text'];
        }
        return rest_ensure_response( $result );
    }

    // ── Stats ────────────────────────────────────────────────────────────────



    public static function get_front_page( $request ) {
        global $wpdb;
        $front_id = (int) get_option( 'page_on_front' );
        if ( ! $front_id ) {
            return rest_ensure_response( array( 'data' => array() ) );
        }
        $post = get_post( $front_id );
        if ( ! $post ) {
            return rest_ensure_response( array( 'data' => array() ) );
        }
        $table = BT_Database::table();
        $translated_languages = $wpdb->get_col( $wpdb->prepare(
            "SELECT DISTINCT language_code FROM {$table} WHERE post_id = %d AND status = 'done'",
            $post->ID
        ) );
        return rest_ensure_response( array(
            'data' => array( array(
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
            ) ),
        ) );
    }

    public static function search_by_url( $request ) {
        global $wpdb;
        $url    = sanitize_text_field( $request->get_param( 'url' ) ?: '' );
        $parsed = wp_parse_url( $url );
        $path   = isset( $parsed['path'] ) ? trim( $parsed['path'], '/' ) : '';
        $parts  = explode( '/', $path );
        if ( count( $parts ) > 1 && preg_match( '/^[a-z]{2,3}$/', $parts[0] ) ) {
            array_shift( $parts );
            $path = implode( '/', $parts );
        }
        $uris         = get_option( 'permalink-manager-uris', array() );
        $matching_ids = array();
        foreach ( $uris as $post_id => $uri ) {
            if ( trim( $uri, '/' ) === $path ) { $matching_ids[] = (int) $post_id; }
        }
        if ( empty( $matching_ids ) && ! empty( $path ) ) {
            $path_parts   = explode( '/', $path );
            $last_segment = end( $path_parts );
            foreach ( $uris as $post_id => $uri ) {
                $uri_parts = explode( '/', trim( $uri, '/' ) );
                if ( end( $uri_parts ) === $last_segment ) { $matching_ids[] = (int) $post_id; }
            }
        }
        if ( empty( $matching_ids ) ) {
            return rest_ensure_response( array( 'page' => 1, 'per_page' => 50, 'total' => 0, 'total_pages' => 0, 'post_type' => 'all', 'data' => array() ) );
        }
        $posts = get_posts( array( 'post_type' => 'any', 'post_status' => 'publish', 'post__in' => $matching_ids, 'orderby' => 'post__in', 'posts_per_page' => 50, 'no_found_rows' => true ) );
        $table    = BT_Database::table();
        $data     = array();
        $post_ids = wp_list_pluck( $posts, 'ID' );
        $langs_by_post = array();
        if ( ! empty( $post_ids ) ) {
            $id_ph = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
            $lang_rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT DISTINCT post_id, language_code FROM {$table} WHERE post_id IN ({$id_ph}) AND status = 'done'",
                    ...$post_ids
                ),
                ARRAY_A
            );
            foreach ( $lang_rows as $r ) {
                $langs_by_post[ (int) $r['post_id'] ][] = $r['language_code'];
            }
        }
        foreach ( $posts as $post ) {
            $translated_languages = $langs_by_post[ $post->ID ] ?? array();
            $data[] = array( 'id' => $post->ID, 'post_id' => $post->ID, 'post_type' => $post->post_type, 'title' => $post->post_title ?: '(no title)', 'slug' => $post->post_name, 'url' => get_permalink( $post->ID ), 'modified' => $post->post_modified, 'translated_languages' => $translated_languages, 'status' => count( $translated_languages ) >= 10 ? 'complete' : ( count( $translated_languages ) > 0 ? 'partial' : 'not_started' ) );
        }
        return rest_ensure_response( array( 'page' => 1, 'per_page' => 50, 'total' => count( $data ), 'total_pages' => 1, 'post_type' => 'all', 'data' => $data ) );
    }

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

    public static function get_page_language_urls( $request ) {
        $post_id  = (int) $request['id'];
        $post     = get_post( $post_id );
        if ( ! $post ) return new WP_Error( 'not_found', 'Post not found', array( 'status' => 404 ) );

        $base_url = get_permalink( $post_id );
        $urls     = array( 'default' => $base_url );

        // Try WPML
        if ( function_exists( 'apply_filters' ) && has_filter( 'wpml_active_languages' ) ) {
            $active_langs = apply_filters( 'wpml_active_languages', null, array() );
            if ( is_array( $active_langs ) ) {
                foreach ( $active_langs as $lang_code => $lang_data ) {
                    $translated_id = apply_filters( 'wpml_object_id', $post_id, $post->post_type, false, $lang_code );
                    if ( $translated_id ) {
                        $urls[ $lang_code ] = get_permalink( $translated_id );
                    }
                }
            }
        }

        // Try Polylang
        if ( function_exists( 'pll_languages_list' ) ) {
            $langs = pll_languages_list( array( 'fields' => 'slug' ) );
            foreach ( $langs as $lang_code ) {
                $translated_id = pll_get_post( $post_id, $lang_code );
                if ( $translated_id ) {
                    $urls[ $lang_code ] = get_permalink( $translated_id );
                }
            }
        }

        return rest_ensure_response( array( 'post_id' => $post_id, 'base_url' => $base_url, 'urls' => $urls ) );
    }

}