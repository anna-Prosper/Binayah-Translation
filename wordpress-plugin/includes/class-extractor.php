<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BT_Extractor {

    // Main function — detects which builder was used and extracts all text.
    // $allow_render: permit a rendered-page HTTP fallback for template-based
    // pages with no DB content. Only the REST /content endpoint passes true —
    // frontend map building must never make HTTP self-requests mid page view.
    public static function extract( $post, $allow_render = false ) {
        $fields = array();

        // 1. Always extract post title
        $fields['post_title'] = array(
            'value' => $post->post_title,
            'type'  => 'text',
        );

        // 2. Always extract post excerpt
        if ( ! empty( $post->post_excerpt ) ) {
            $fields['post_excerpt'] = array(
                'value' => $post->post_excerpt,
                'type'  => 'textarea',
            );
        }

        // 3. Check if page was built with Elementor
        $elementor_data = get_post_meta( $post->ID, '_elementor_data', true );
        $has_elementor  = ! empty( $elementor_data );
        if ( $has_elementor ) {
            $elementor_fields = self::extract_elementor( $elementor_data );
            $fields = array_merge( $fields, $elementor_fields );
        }

        // 4. Check if page was built with WP Bakery
        if ( ! empty( $post->post_content ) && strpos( $post->post_content, '[vc_' ) !== false ) {
            $wpbakery_fields = self::extract_wpbakery( $post->post_content );
            $fields = array_merge( $fields, $wpbakery_fields );
        }

        // 5. Extract ACF fields if ACF plugin is active
        if ( function_exists( 'get_fields' ) ) {
            $acf_fields = self::extract_acf( $post->ID );
            $fields = array_merge( $fields, $acf_fields );
        }

        // 6. Extract Houzez theme post meta (property descriptions, labels etc.)
        $houzez_fields = self::extract_houzez_meta( $post );
        $fields = array_merge( $fields, $houzez_fields );

        // 6b. Extract the main post_content body (classic-editor blog posts, Houzez
        // property descriptions, plain pages). Skip Elementor pages entirely — their
        // content is in _elementor_data (handled above), and running the_content on
        // them re-renders the builder (heavy / re-entrant during the page's own
        // output buffer → could blank the page). Keys are content-hashed (stable).
        if ( ! $has_elementor ) {
            $content_fields = self::extract_post_content( $post );
            $fields = array_merge( $fields, $content_fields );
        }

        // 6c. Coverage-guarded rendered fallback. The structured extractors above
        // only see content stored in post_content / builder meta / ACF / Houzez
        // meta. They miss pages whose body is hardcoded in a theme template
        // (Houzez templates/pages/*.php) and mixed pages (a builder hero + a
        // template body). When structured extraction is thin, render the page and
        // MERGE its main-content text nodes, deduped against what we already have,
        // so a new page translates regardless of how it was built. Guarded to REST
        // /content ($allow_render) — never a visitor page view (would self-HTTP mid
        // render). See should_render_fallback() for the type/template restrictions.
        if ( $allow_render && self::should_render_fallback( $post, $fields ) ) {
            $seen = self::structured_text_index( $fields );
            foreach ( self::extract_rendered( $post ) as $key => $field ) {
                $val  = is_array( $field ) ? ( $field['value'] ?? '' ) : $field;
                $norm = self::normalize_for_dedupe( $val );
                if ( $norm === '' || isset( $seen[ $norm ] ) ) continue;
                $seen[ $norm ]  = true;
                $fields[ $key ] = $field;
            }
        }

        // 7. Extract Yoast SEO fields if Yoast is active
        $seo_title = get_post_meta( $post->ID, '_yoast_wpseo_title', true );
        $seo_desc  = get_post_meta( $post->ID, '_yoast_wpseo_metadesc', true );
        if ( $seo_title ) $fields['seo:_yoast_wpseo_title']   = array( 'value' => $seo_title, 'type' => 'text' );
        if ( $seo_desc )  $fields['seo:_yoast_wpseo_metadesc'] = array( 'value' => $seo_desc,  'type' => 'text' );

        // Remove any empty fields
        return array_filter( $fields, fn( $f ) => ! empty( $f['value'] ) );
    }

    // ── Elementor ─────────────────────────────────────────────────────────

    /**
     * Simple widgets: widget_type => array of setting keys that contain text.
     */
    private static $elementor_text_keys = array(
        // Core / Pro widgets
        'heading'               => array( 'title' ),
        'text-editor'           => array( 'editor' ),
        'button'                => array( 'text', 'button_text' ),
        'icon-box'              => array( 'title_text', 'description_text' ),
        'image-box'             => array( 'title_text', 'description' ),
        'counter'               => array( 'title', 'prefix', 'suffix' ),
        'testimonial'           => array( 'testimonial_content', 'testimonial_name', 'testimonial_job' ),
        'call-to-action'        => array( 'heading', 'description', 'button', 'button_text', 'bg_text' ),
        'alert'                 => array( 'alert_title', 'alert_description' ),
        'image'                 => array( 'caption' ),
        'wp-widget-media_image' => array( 'caption' ),
        'video'                 => array( 'title' ),
        'text-path'             => array( 'text' ),
        'blockquote'            => array( 'blockquote_content', 'author_name', 'author_details' ),
        'price-table'           => array( 'heading', 'sub_heading', 'period', 'button_text', 'ribbon_title' ),
        'flip-box'              => array( 'title_text_a', 'description_text_a', 'title_text_b', 'description_text_b', 'button_text' ),
        'countdown'             => array( 'label_days', 'label_hours', 'label_minutes', 'label_seconds' ),
        'progress'              => array( 'title' ),
        'search-form'           => array( 'placeholder', 'button_text' ),
        'star-rating'           => array( 'title' ),
        'post-title'            => array( 'prefix_text', 'suffix_text' ),
        'post-excerpt'          => array( 'more_text' ),
        'breadcrumbs'           => array( 'prefix' ),
        'form'                  => array( 'submit_value', 'form_name', 'button_text' ),
        // Houzez theme Elementor widgets
        'houzez-heading'             => array( 'title', 'heading', 'sub_heading', 'description', 'sub_title', 'content' ),
        'houzez-hero-banner'         => array( 'heading', 'sub_heading', 'btn_text', 'btn_two_text', 'description', 'sub_title' ),
        'houzez-cta'                 => array( 'heading', 'sub_heading', 'btn_text', 'description', 'sub_title' ),
        'houzez-property-slider'     => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-agents'              => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-agencies'            => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-half-map-listings'   => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-text-with-image'     => array( 'heading', 'sub_heading', 'description', 'btn_text', 'title', 'content', 'sub_title' ),
        'houzez-property-types'      => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-testimonials'        => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-blog'                => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-featured-properties' => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-advanced-search'     => array( 'btn_text', 'placeholder', 'heading', 'sub_heading', 'sub_title' ),
        'houzez-counters'            => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-banner'              => array( 'heading', 'sub_heading', 'btn_text', 'description', 'sub_title' ),
        'houzez-team'                => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-partners'            => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-search'              => array( 'heading', 'btn_text', 'placeholder', 'sub_heading' ),
        'houzez-locations'           => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-steps'               => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez-mortgage-calculator' => array( 'title', 'heading', 'btn_text', 'sub_heading' ),
        'houzez-properties-carousel' => array( 'heading', 'sub_heading', 'title', 'sub_title' ),
        // Houzez custom Elementor widgets (non-standard naming)
        'Houzez_elementor_grid_builder'   => array( 'grid_title', 'grid_subtitle', 'more_text', 'more_text_d', 'properties_text', 'property_text', 'heading', 'sub_heading', 'title', 'sub_title' ),
        'houzez_elementor_section_title'  => array( 'hz_section_title', 'hz_section_subtitle', 'heading', 'title', 'sub_heading', 'sub_title' ),
        'houzez_elementor_search_builder' => array( 'tabs_all_text', 'collapse_button_text', 'heading', 'sub_heading', 'btn_text', 'placeholder', 'title', 'sub_title' ),
        'houzez_elementor_blog_posts'     => array( 'heading', 'sub_heading', 'btn_text', 'title', 'sub_title', 'read_more_text' ),
        'houzez_elementor_space'          => array( 'heading', 'title' ),
        'houzez_elementor_property-card-v6' => array( 'heading', 'sub_heading', 'btn_text', 'title', 'sub_title', 'read_more_text', 'more_text' ),
    );

    /**
     * Repeater widgets: widget_type => array( repeater_setting_key => array( item_text_keys ) )
     */
    private static $elementor_repeater_keys = array(
        'form'                 => array( 'form_fields' => array( 'field_label', 'placeholder', 'acceptance_text' ) ),
        'accordion'            => array( 'tabs'           => array( 'tab_title', 'tab_content' ) ),
        'toggle'               => array( 'tabs'           => array( 'tab_title', 'tab_content' ) ),
        'tabs'                 => array( 'tabs'           => array( 'tab_title', 'tab_content' ) ),
        'icon-list'            => array( 'icon_list'      => array( 'text' ) ),
        'slides'               => array( 'slides'         => array( 'heading', 'description', 'button_text', 'button_text_2' ) ),
        'testimonial-carousel' => array( 'slides'         => array( 'content', 'name', 'job' ) ),
        'image-carousel'       => array( 'carousel'       => array( 'caption' ) ),
        'price-table'          => array( 'features_list'  => array( 'item_text' ) ),
        'nested-tabs'          => array( 'tabs'           => array( 'tab_title', 'tab_description' ) ),
        'nested-accordion'     => array( 'items'          => array( 'item_title', 'item_description' ) ),
        // Houzez repeaters
        'houzez-testimonials'  => array(
            'testimonials_list' => array( 'name', 'position', 'content', 'text', 'title' ),
            'slides'            => array( 'name', 'content', 'position', 'title' ),
        ),
        'houzez-counters'      => array( 'counters_list'  => array( 'title', 'prefix', 'suffix' ) ),
        'houzez-team'          => array( 'members'        => array( 'name', 'position', 'bio', 'description' ) ),
        'houzez-steps'         => array( 'steps_list'     => array( 'title', 'description', 'content' ) ),
        'houzez-locations'     => array( 'locations_list' => array( 'title', 'description' ) ),
        'houzez-property-types' => array( 'property_types' => array( 'title', 'description' ) ),
    );

    /**
     * Setting keys that are always layout/design — never translatable text.
     * Used by the generic catch-all sweep.
     */
    private static $generic_skip_keys = array(
        '_id', '__globals__', '__fa4_migrated', '__dynamic__',
        'css', '_css', 'css_classes', '_css_classes', 'custom_css',
        'animation', 'entrance_animation', 'hover_animation', '_animation',
        'animation_duration', 'animation_delay', 'animation_duration',
        'link', 'url', '_url', 'button_url', 'anchor', 'href',
        'selected_icon', 'icon', 'icon_type', 'icon_value', 'icon_svg',
        'id', 'post_id', 'taxonomy', 'post_type', 'tax_type', 'tax_city',
        'grid_taxonomy', 'grid_type', 'grid_image_size', 'pagination_type', 'sort_by',
        'image', '_image', 'background_image', 'bg_image', 'background_background',
        'align', 'text_align', 'content_align', 'alignment', 'h_align', 'v_align',
        'font_family', 'font_size', 'font_weight', 'font_style', 'font_variant',
        'letter_spacing', 'line_height', 'word_spacing', 'text_transform',
        'margin', 'padding', 'border_radius', 'border_width', 'border_style',
        'width', 'height', 'min_height', 'max_height', 'min_width', 'max_width',
        'opacity', 'z_index', 'overflow', 'display',
        'color', 'background_color', 'bg_color', 'text_color', 'border_color',
        'hover_color', 'active_color', 'overlay_color',
        'effect', 'speed', 'autoplay', 'autoplay_speed', 'loop', 'pause_on_hover',
        'slides_per_view', 'slides_to_scroll', 'space_between', 'columns',
        'breakpoint', 'direction', 'easing', 'duration', 'delay',
        'hide_desktop', 'hide_tablet', 'hide_mobile',
        'property_ids', 'post_ids', 'category', 'tag', 'order', 'orderby',
        'number', 'limit', 'offset', 'per_page',
        '_background_background', '_background_position', '_background_size',
    );

    /**
     * Returns true if $str looks like actual human-readable content (not a CSS
     * value, slug, URL, number, color code, etc.).
     */
    private static function looks_like_real_text( $str ) {
        $v = trim( wp_strip_all_tags( (string) $str ) );
        if ( strlen( $v ) < 3 )                                                                      return false;
        if ( is_numeric( $v ) )                                                                      return false;
        if ( filter_var( $v, FILTER_VALIDATE_URL ) )                                                 return false;
        if ( preg_match( '/^#[0-9a-fA-F]{3,8}$/', $v ) )                                           return false; // hex color
        if ( preg_match( '/^\d+(\.\d+)?(px|em|rem|%|vh|vw|pt|deg|ms|s)\s*$/i', $v ) )              return false; // CSS unit
        if ( preg_match( '/^rgba?\s*\(/i', $v ) )                                                   return false; // CSS color fn
        if ( preg_match( '/^[a-z][a-z0-9_\-]*$/', $v ) )                                           return false; // all-lowercase slug
        if ( strpos( $v, '{' ) !== false )                                                           return false; // CSS/JSON block
        if ( preg_match( '/^[\d\s,.\-+()%\/]+$/', $v ) )                                           return false; // only numbers
        if ( ! preg_match( '/\p{L}/u', $v ) )                                                      return false; // no letters at all
        // Must start with uppercase, OR contain a space, OR contain non-ASCII (Arabic, CJK, etc.)
        $starts_upper  = (bool) preg_match( '/^\p{Lu}/u', $v );
        $has_space     = strpos( $v, ' ' ) !== false;
        $has_non_ascii = (bool) preg_match( '/[^\x00-\x7F]/', $v );
        if ( ! $starts_upper && ! $has_space && ! $has_non_ascii )                                  return false;
        return true;
    }

    /**
     * Decide the stored value + type for a raw setting string.
     * If the raw value contains inline formatting/link tags, preserve those tags
     * (keeping only a safe inline whitelist) so the stored original matches the
     * rendered HTML for str_replace. Otherwise store plain stripped text.
     * Only affects fields that actually contain inline HTML — plain fields are
     * unchanged, so existing translations are not invalidated.
     */
    private static function value_and_type( $raw ) {
        $raw      = (string) $raw;
        // WordPress collapses runs of whitespace (incl. inside attributes) when it
        // renders, so normalise multi-space/newline/tab runs to a single space —
        // otherwise the stored original won't match the rendered HTML for str_replace.
        $stripped = trim( preg_replace( '/[ \t\r\n]{2,}/', ' ', wp_strip_all_tags( $raw ) ) );
        // Preserve inline formatting/link tags AND list/paragraph structure, because the
        // rendered HTML keeps them and str_replace needs an exact substring match.
        // (e.g. text-editor widgets holding <ul><li> bullet lists were being flattened to
        //  newline text that never matched the rendered <ul><li> markup, so lists never
        //  translated in ANY language.)
        if ( preg_match( '/<(a|strong|em|b|i|u|span|mark|sup|sub|br|ul|ol|li)\b/i', $raw ) ) {
            $html = strip_tags( $raw, '<a><strong><em><b><i><u><span><mark><sup><sub><br><ul><ol><li>' );
            // Normalise whitespace runs the same way WordPress does when rendering.
            $html = trim( preg_replace( '/[ \t\r\n]{2,}/', ' ', $html ) );
            if ( $html !== '' ) return array( 'value' => $html, 'type' => 'html' );
        }
        return array( 'value' => $stripped, 'type' => 'text' );
    }

    /**
     * Add a text field to $fields. If the raw value contains a <li> list, emit ONE
     * field per list item (keyed :li:N) instead of the whole <ul> blob — matching a
     * whole list is brittle because WordPress renders inter-tag whitespace
     * inconsistently (</li>\n<li> in source becomes </li><li> when rendered). Each
     * item's inner text is a clean contiguous substring of the rendered HTML, so
     * str_replace matches reliably.
     */
    private static function add_text_field( &$fields, $field_key, $raw ) {
        $raw = (string) $raw;
        if ( preg_match( '/<li\b/i', $raw ) && preg_match_all( '/<li\b[^>]*>(.*?)<\/li>/is', $raw, $m ) ) {
            foreach ( $m[1] as $i => $item ) {
                $clean = trim( wp_strip_all_tags( $item ) );
                if ( self::looks_like_real_text( $clean ) ) {
                    $fields[ $field_key . ':li:' . $i ] = self::value_and_type( $item );
                }
            }
            return;
        }
        $clean = trim( wp_strip_all_tags( $raw ) );
        if ( self::looks_like_real_text( $clean ) ) {
            $fields[ $field_key ] = self::value_and_type( $raw );
        }
    }

    /**
     * Generic sweep of ALL settings of a widget to catch text in widget types
     * that are not in the hardcoded whitelist.
     * Only adds keys that haven't already been extracted by the whitelist step.
     */
    private static function extract_generic_text( $el_id, $widget_type, $settings, &$fields ) {
        foreach ( $settings as $skey => $sval ) {
            // Skip known design/layout keys
            if ( in_array( $skey, self::$generic_skip_keys, true ) ) continue;
            // Skip keys that are typography/font/design settings
            if ( preg_match( '/(^|_)typography|(^|_)font_|(^|_)family$|_color$|_size$|_weight$|_transform$|_spacing$|_height$|_decoration$|_style$|_variant$/', $skey ) ) continue;

            if ( is_string( $sval ) ) {
                $fkey = 'elementor:' . $el_id . ':' . $widget_type . ':' . $skey;
                if ( isset( $fields[ $fkey ] ) ) continue; // already extracted by whitelist
                $clean = trim( wp_strip_all_tags( $sval ) );
                if ( self::looks_like_real_text( $clean ) ) {
                    $fields[ $fkey ] = array( 'value' => $clean, 'type' => 'text' );
                }
            } elseif ( is_array( $sval ) ) {
                // Possible repeater — walk items one level deep
                foreach ( $sval as $idx => $item ) {
                    if ( ! is_array( $item ) ) continue;
                    $item_id = isset( $item['_id'] ) ? $item['_id'] : $idx;
                    foreach ( $item as $ikey => $ival ) {
                        if ( $ikey === '_id' ) continue;
                        if ( in_array( $ikey, self::$generic_skip_keys, true ) ) continue;
                        if ( preg_match( '/(^|_)typography|(^|_)font_|(^|_)family$|_color$|_size$|_weight$|_transform$|_spacing$|_height$|_decoration$|_style$/', $ikey ) ) continue;
                        $ifkey = 'elementor:' . $el_id . ':' . $widget_type . ':' . $skey . ':' . $item_id . ':' . $ikey;
                        if ( isset( $fields[ $ifkey ] ) ) continue;
                        if ( is_string( $ival ) ) {
                            $clean = trim( wp_strip_all_tags( $ival ) );
                            if ( self::looks_like_real_text( $clean ) ) {
                                $fields[ $ifkey ] = array( 'value' => $clean, 'type' => 'text' );
                            }
                        }
                    }
                }
            }
        }
    }

    private static function extract_elementor( $data ) {
        if ( is_string( $data ) ) {
            $data = json_decode( $data, true );
        }
        if ( ! is_array( $data ) ) return array();

        $fields = array();
        self::walk_elementor( $data, $fields );
        return $fields;
    }

    private static function walk_elementor( $elements, &$fields ) {
        if ( ! is_array( $elements ) ) return;

        foreach ( $elements as $element ) {
            if ( ! is_array( $element ) ) continue;

            if ( isset( $element['elType'] ) && $element['elType'] === 'widget' ) {
                $widget_type = $element['widgetType'] ?? '';
                $settings    = $element['settings']   ?? array();
                $el_id       = $element['id']          ?? uniqid();

                // Pure design/structural widgets — no translatable text
                $design_only_widgets = array( 'divider', 'spacer', 'google_maps', 'html', 'shortcode' );

                // 1. Extract simple text settings (whitelist)
                if ( isset( self::$elementor_text_keys[ $widget_type ] ) ) {
                    foreach ( self::$elementor_text_keys[ $widget_type ] as $key ) {
                        if ( ! empty( $settings[ $key ] ) && is_string( $settings[ $key ] ) ) {
                            $field_key = 'elementor:' . $el_id . ':' . $widget_type . ':' . $key;
                            self::add_text_field( $fields, $field_key, $settings[ $key ] );
                        }
                    }
                }

                // 2. Extract repeater items (whitelist)
                if ( isset( self::$elementor_repeater_keys[ $widget_type ] ) ) {
                    foreach ( self::$elementor_repeater_keys[ $widget_type ] as $repeater_key => $item_keys ) {
                        if ( empty( $settings[ $repeater_key ] ) || ! is_array( $settings[ $repeater_key ] ) ) continue;
                        foreach ( $settings[ $repeater_key ] as $idx => $item ) {
                            if ( ! is_array( $item ) ) continue;
                            $item_id = isset( $item['_id'] ) ? $item['_id'] : $idx;
                            foreach ( $item_keys as $ikey ) {
                                if ( ! empty( $item[ $ikey ] ) && is_string( $item[ $ikey ] ) ) {
                                    $clean = trim( wp_strip_all_tags( $item[ $ikey ] ) );
                                    if ( self::looks_like_real_text( $clean ) ) {
                                        $fkey = 'elementor:' . $el_id . ':' . $widget_type . ':' . $repeater_key . ':' . $item_id . ':' . $ikey;
                                        $fields[ $fkey ] = array(
                                            'value' => $clean,
                                            'type'  => 'text',
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // 3. Generic catch-all — sweeps ALL string settings.
                //    Skip pure design/structural widgets (no user-visible text).
                if ( ! in_array( $widget_type, $design_only_widgets, true ) ) {
                    self::extract_generic_text( $el_id, $widget_type, $settings, $fields );
                }
            }

            // Recurse into child elements (columns, sections, containers)
            if ( ! empty( $element['elements'] ) ) {
                self::walk_elementor( $element['elements'], $fields );
            }
        }
    }

    // ── Nav Menus (global strings) ────────────────────────────────────────

    /**
     * Extract all registered nav menu item titles as translatable fields.
     * Stored under post_id=0 ("global") so they apply to every page.
     * Field key format: nav:{location}:{item_id}:title
     */
    public static function extract_nav_menus() {
        $fields = array();
        $seen   = array();

        // 1. Menus assigned to theme locations (keeps existing key format for stability)
        $locations = get_nav_menu_locations();
        foreach ( $locations as $location => $menu_id ) {
            if ( ! $menu_id ) continue;
            $items = wp_get_nav_menu_items( $menu_id, array( 'update_post_term_cache' => false ) );
            if ( ! $items || is_wp_error( $items ) ) continue;
            foreach ( $items as $item ) {
                $title = trim( $item->title );
                if ( $title === '' || strlen( $title ) < 2 || ! preg_match( '/\p{L}/u', $title ) ) continue;
                $fields[ 'nav:' . $location . ':' . $item->ID . ':title' ] = array( 'value' => $title, 'type' => 'text' );
                $seen[ $item->ID ] = true;
            }
        }

        // 2. ALL registered menus — catches footer/utility menus attached via widget or
        //    block (not a theme location), which location-only scanning would miss.
        $menus = function_exists( 'wp_get_nav_menus' ) ? wp_get_nav_menus() : array();
        if ( $menus && ! is_wp_error( $menus ) ) {
            foreach ( $menus as $menu ) {
                $items = wp_get_nav_menu_items( $menu->term_id, array( 'update_post_term_cache' => false ) );
                if ( ! $items || is_wp_error( $items ) ) continue;
                foreach ( $items as $item ) {
                    if ( isset( $seen[ $item->ID ] ) ) continue;
                    $title = trim( $item->title );
                    if ( $title === '' || strlen( $title ) < 2 || ! preg_match( '/\p{L}/u', $title ) ) continue;
                    $fields[ 'nav:menu' . $menu->term_id . ':' . $item->ID . ':title' ] = array( 'value' => $title, 'type' => 'text' );
                    $seen[ $item->ID ] = true;
                }
            }
        }

        // 3. Site-wide theme-hardcoded strings (newsletter, copyright, footer headings
        //    output by the theme, not stored in page/menu data). Editable via the
        //    'bt_global_strings' option (one string per line).
        foreach ( self::theme_strings() as $s ) {
            $s = trim( $s );
            if ( strlen( $s ) < 2 || ! preg_match( '/\p{L}/u', $s ) ) continue;
            $fields[ 'theme:' . md5( $s ) ] = array( 'value' => $s, 'type' => 'text' );
        }

        return $fields;
    }

    /**
     * Curated list of site-wide theme-hardcoded strings, editable via the
     * 'bt_global_strings' option (newline-separated). Seeded with the strings
     * the Houzez theme prints outside Elementor/menu data.
     */
    private static function theme_strings() {
        $opt = get_option( 'bt_global_strings', '' );
        $list = array_filter( array_map( 'trim', preg_split( '/\r\n|\r|\n/', (string) $opt ) ) );
        $seed = array(
            'Subscribe To Our Newsletter!',
            'Stay Informed! Subscribe to our email newsletter for the latest UAE real estate updates.',
            'Enter Your Email Address',
            'Subscribe Now',
            'Browse Properties by Dubai Areas',
            'All rights reserved',
            'Real Estate Marketing',
            'Sellers Guide',
            'Submit Testimonial',
            'Tenant Management',
            'Latest Dubai Projects:',
            'Latest Dubai Projects',
        );
        return array_values( array_unique( array_merge( $seed, $list ) ) );
    }

    // ── WP Bakery ─────────────────────────────────────────────────────────

    private static function extract_wpbakery( $content ) {
        $fields = array();

        // vc_custom_heading text="..."
        preg_match_all( '/\[vc_custom_heading\s[^\]]*text=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:custom_heading:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        // vc_btn title="..."
        preg_match_all( '/\[vc_btn\s[^\]]*title=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:btn:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        // vc_column_text inner content
        preg_match_all( '/\[vc_column_text[^\]]*\](.*?)\[\/vc_column_text\]/s', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $clean = wp_strip_all_tags( $text );
            if ( strlen( trim( $clean ) ) > 3 ) {
                $fields[ 'wpbakery:column_text:' . $i ] = array( 'value' => trim( $clean ), 'type' => 'html' );
            }
        }

        // vc_cta h2="..." heading
        preg_match_all( '/\[vc_cta\s[^\]]*h2=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:cta_h2:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        // vc_cta h4="..." sub-heading
        preg_match_all( '/\[vc_cta\s[^\]]*h4=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:cta_h4:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        // vc_toggle title="..."
        preg_match_all( '/\[vc_toggle\s[^\]]*title=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:toggle_title:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        // vc_toggle inner content
        preg_match_all( '/\[vc_toggle[^\]]*\](.*?)\[\/vc_toggle\]/s', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $clean = trim( wp_strip_all_tags( $text ) );
            if ( strlen( $clean ) > 3 ) {
                $fields[ 'wpbakery:toggle_body:' . $i ] = array( 'value' => $clean, 'type' => 'text' );
            }
        }

        // vc_tta_section title="..."
        preg_match_all( '/\[vc_tta_section\s[^\]]*title=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:tta_section:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        // vc_message inner content
        preg_match_all( '/\[vc_message[^\]]*\](.*?)\[\/vc_message\]/s', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $clean = trim( wp_strip_all_tags( $text ) );
            if ( strlen( $clean ) > 3 ) {
                $fields[ 'wpbakery:message:' . $i ] = array( 'value' => $clean, 'type' => 'text' );
            }
        }

        // vc_tab title="..."
        preg_match_all( '/\[vc_tab\s[^\]]*title=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:tab_title:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        // Houzez shortcode title="..."
        preg_match_all( '/\[houzez_[a-z_]+\s[^\]]*title=["\']([^"\']+)["\']/', $content, $matches );
        foreach ( $matches[1] as $i => $text ) {
            $fields[ 'wpbakery:hz_title:' . $i ] = array( 'value' => $text, 'type' => 'text' );
        }

        return $fields;
    }

    // ── Houzez Theme Post Meta ─────────────────────────────────────────────

    /**
     * Extract the rendered post_content body as translatable block-level nodes,
     * keyed by a content hash (stable across renders — unlike positional html:N).
     * Covers classic-editor blog posts, plain pages, and Houzez property
     * descriptions (which live in post_content). Each node keeps its inline HTML
     * so the frontend str-replaces it inside the rendered page unchanged.
     */
    private static function extract_post_content( $post ) {
        $fields = array();
        $raw = isset( $post->post_content ) ? (string) $post->post_content : '';
        if ( trim( $raw ) === '' ) return $fields;

        // Mirror WordPress's core the_content TEXT transforms WITHOUT executing
        // shortcodes/page-builders. Running apply_filters('the_content') here is
        // dangerous: this runs inside the page's own output buffer, so on a WP
        // Bakery / shortcode-heavy page it re-renders the builder → memory blow-up /
        // blank page. strip_shortcodes drops the [vc_*] wrappers but keeps their
        // inner text (which still appears verbatim in the rendered page, so the
        // frontend str-replace still matches).
        $html = wptexturize( wpautop( strip_shortcodes( $raw ) ) );
        if ( ! is_string( $html ) || $html === '' ) return $fields;

        return self::extract_block_nodes( $html );
    }

    /**
     * Extract the inner content of common block-level text containers from an
     * HTML fragment as content-hashed fields (stable keys, unlike positional
     * html:N). Shared by post_content extraction and the rendered-page fallback.
     */
    private static function extract_block_nodes( $html ) {
        $fields = array();
        if ( preg_match_all( '#<(p|li|h[1-6]|td|th|blockquote|figcaption|dd|dt|button)\b[^>]*>(.*?)</\1>#is', $html, $m ) ) {
            $seen = array();
            foreach ( $m[2] as $inner ) {
                $inner = trim( preg_replace( '/[ \t\r\n]{2,}/', ' ', $inner ) );
                if ( $inner === '' || isset( $seen[ $inner ] ) ) continue;
                // Skip containers that still hold nested block/structural markup —
                // their leaf nodes are captured as their own matches.
                if ( preg_match( '/<(div|section|ul|ol|table|p|h[1-6]|article|aside|form|nav|img|svg|iframe|script|style)\b/i', $inner ) ) continue;
                $clean = trim( wp_strip_all_tags( $inner ) );
                if ( ! self::looks_like_real_text( $clean ) ) continue;
                $seen[ $inner ] = true;
                // Keep inline tags → 'html'; plain text → 'text'.
                $type = ( $inner !== $clean && preg_match( '/<(a|strong|em|b|i|u|span|br)\b/i', $inner ) ) ? 'html' : 'text';
                $fields[ 'content:' . md5( $inner ) ] = array( 'value' => ( $type === 'html' ? $inner : $clean ), 'type' => $type );
            }
        }
        return $fields;
    }

    /**
     * Decide whether to run the rendered fallback for this post. Keeps it cheap
     * and safe:
     *  - Only 'page'/'post' types. The Houzez CPTs (property, project, area,
     *    residentialbuilding…) — which are the vast majority of the ~21k objects —
     *    always carry structured meta, and rendering them would pull in dynamic
     *    listing chrome (prices, cards, agents) that churns and shouldn't be
     *    per-page translated. So they never take this path.
     *  - Skip templates whose body is dynamic inventory (search/archive/results).
     *  - Fire only when structured extraction found little body content — catches
     *    fully template-driven pages (0 fields) and mixed builder+template pages,
     *    while a normally-built page (many fields) skips the render entirely.
     */
    private static function should_render_fallback( $post, $fields ) {
        if ( ! in_array( $post->post_type, array( 'page', 'post' ), true ) ) return false;

        $tpl  = (string) get_page_template_slug( $post->ID );
        $skip = apply_filters( 'bt_no_render_templates', '/(search|archive|result|listing|grid|map)/i' );
        if ( $tpl !== '' && @preg_match( $skip, $tpl ) ) return false;

        $body = array_diff_key( $fields, array( 'post_title' => 1, 'post_excerpt' => 1 ) );
        return count( $body ) < 10;
    }

    /** Index of normalized text already captured by structured extraction. */
    private static function structured_text_index( $fields ) {
        $idx = array();
        foreach ( $fields as $f ) {
            $v = is_array( $f ) ? ( $f['value'] ?? '' ) : $f;
            $n = self::normalize_for_dedupe( $v );
            if ( $n !== '' ) $idx[ $n ] = true;
        }
        return $idx;
    }

    /** Tag-stripped, whitespace-collapsed, lowercased form for dedupe matching. */
    private static function normalize_for_dedupe( $text ) {
        $t = wp_strip_all_tags( (string) $text );
        $t = preg_replace( '/\s+/', ' ', $t );
        return strtolower( trim( $t ) );
    }

    /**
     * Last-resort extraction for pages whose content lives in a hardcoded PHP
     * theme template (empty post_content, no builder meta — e.g. Houzez's
     * templates/pages/*.php): render the page over HTTP and extract text nodes
     * from the area between the site header and footer. The X-BT-Render header
     * makes our own frontend skip translation/buffering on the inner request,
     * so this cannot recurse. Only called from the REST /content endpoint
     * (never during a visitor page view — see BT_API::get_page_content).
     */
    public static function extract_rendered( $post ) {
        $url = get_permalink( $post->ID );
        if ( ! $url ) return array();

        $key  = get_option( 'bt_api_key', '' );
        $resp = wp_remote_get( $url, array(
            'timeout'   => 30,
            'sslverify' => false,
            'headers'   => array( 'X-BT-Render' => $key, 'X-Binayah-API-Key' => $key ),
        ) );
        if ( is_wp_error( $resp ) || 200 !== wp_remote_retrieve_response_code( $resp ) ) return array();
        $html = (string) wp_remote_retrieve_body( $resp );
        if ( $html === '' ) return array();

        // Walk the DOM and capture text from leaf elements REGARDLESS of tag —
        // theme templates put real content in <div>/<span>/<a> just as often as
        // <p>/<h*>, and a fixed tag list misses it. DOMDocument also lets us skip
        // the <header>/<footer>/<nav> SUBTREES precisely (byte-offset stripping
        // fails when a template wraps most of the page in <header>), so shared
        // chrome stays in the global (post_id=0) bucket, not duplicated per page.
        if ( class_exists( 'DOMDocument' ) ) {
            $prev = libxml_use_internal_errors( true );
            $doc  = new DOMDocument();
            $doc->loadHTML( '<?xml encoding="utf-8"?>' . $html, LIBXML_NOWARNING | LIBXML_NOERROR );
            libxml_clear_errors();
            libxml_use_internal_errors( $prev );
            $body = $doc->getElementsByTagName( 'body' )->item( 0 );
            if ( ! $body ) return array();
            // Template-fallback pages are hardcoded top-to-bottom — their custom
            // header/nav/footer ARE page-specific content (a bespoke landing page,
            // not the shared Houzez chrome), so capture the WHOLE body and only
            // prune genuinely non-content subtrees. Standard pages never reach
            // here (they have structured fields), so shared chrome isn't
            // duplicated across the 21k catalog. nav:*-handled menu items that do
            // appear are harmless: single words replace node-bounded, multi-word
            // via strtr, both idempotent once the nav filter has run.
            // NOTE: <form> is NOT skipped — its <label>/<button> text is
            // user-facing UI ("Send Inquiry", "Email Address"). Only the actual
            // input controls (select/textarea/option) are skipped.
            $skip = array( 'script','style','noscript','svg','select','textarea',
                           'option','template','iframe','head','link','meta','picture','source' );
            $fields = array();
            $seen   = array();
            self::walk_leaves( $body, $fields, $seen, $skip );
            self::sweep_text_nodes( $doc, $body, $fields, $seen, $skip );
            self::sweep_attributes( $doc, $body, $fields );
            self::sweep_options( $doc, $body, $fields );
            return $fields;
        }

        // Fallback (no DOM ext): crude region scope + block-node regex.
        $h = stripos( $html, '</header>' );
        if ( $h !== false ) $html = substr( $html, $h + 9 );
        $f = stripos( $html, '<footer' );
        if ( $f !== false ) $html = substr( $html, 0, $f );
        $html = preg_replace( '#<(script|style|noscript|svg|form|nav|template|select)\b[^>]*>.*?</\1>#is', '', $html );
        return is_string( $html ) && $html !== '' ? self::extract_block_nodes( $html ) : array();
    }

    // Inline elements that can appear inside a translation unit without splitting
    // it. An element whose child elements are ALL inline is a leaf text unit.
    private static $inline_tags = array(
        'a','span','strong','em','b','i','u','s','small','sup','sub','mark','abbr',
        'time','label','font','strike','del','ins','q','cite','bdi','bdo','wbr','br',
        'code','kbd','var','samp','big','tt',
    );
    // Subtrees never extracted here: non-content, or chrome that belongs in the
    // global bucket (header/footer/nav) rather than duplicated on every page.
    private static $skip_tags = array(
        'script','style','noscript','svg','form','select','textarea','option',
        'nav','header','footer','template','iframe','head','link','meta','picture','source',
    );

    /**
     * Recursively capture leaf text units. An element is a leaf when all of its
     * child elements are inline (so its text is one contiguous unit); otherwise
     * we recurse so each block child becomes its own unit. Skip-tag subtrees are
     * pruned entirely. Plain-text leaves store clean text (byte-matches the raw
     * HTML the frontend replaces against); leaves with inline markup store inner
     * HTML (type 'html').
     */
    private static function walk_leaves( $node, &$fields, &$seen, $skip = null ) {
        if ( $skip === null ) $skip = self::$skip_tags;
        foreach ( $node->childNodes as $child ) {
            if ( $child->nodeType !== XML_ELEMENT_NODE ) continue;
            $tag = strtolower( $child->nodeName );
            if ( in_array( $tag, $skip, true ) ) continue;

            $has_block_child = false;
            foreach ( $child->childNodes as $g ) {
                if ( $g->nodeType !== XML_ELEMENT_NODE ) continue;
                $gt = strtolower( $g->nodeName );
                if ( in_array( $gt, $skip, true ) ) continue;
                if ( ! in_array( $gt, self::$inline_tags, true ) ) { $has_block_child = true; break; }
            }

            if ( $has_block_child ) {
                self::walk_leaves( $child, $fields, $seen, $skip );
                continue;
            }

            // Count discrete inline-element children (ignore <br> and skip-tag
            // icons) and whether bare text flows between them.
            $inline_children = 0;
            $has_direct_text = false;
            foreach ( $child->childNodes as $g ) {
                if ( $g->nodeType === XML_TEXT_NODE ) { if ( trim( $g->textContent ) !== '' ) $has_direct_text = true; continue; }
                if ( $g->nodeType !== XML_ELEMENT_NODE ) continue;
                $gt = strtolower( $g->nodeName );
                if ( $gt === 'br' || in_array( $gt, $skip, true ) ) continue;
                $inline_children++;
            }
            $has_inline = $inline_children > 0;

            // Multiple discrete inline labels with NO flowing text between them
            // (an eyebrow <span> next to a phone <a>, two stacked <span>s) are
            // SEPARATE units — recurse so each is captured on its own and can
            // byte-match the element-separated rendered HTML. A single wrapper, or
            // text flowing around inline tags, stays one unit.
            if ( $inline_children >= 2 && ! $has_direct_text ) {
                self::walk_leaves( $child, $fields, $seen, $skip );
                continue;
            }

            if ( $has_inline ) {
                // Serialize inline children, DROPPING skip-tag siblings (icons:
                // <svg>, etc.). Including them poisons the stored original —
                // DOMDocument lowercases SVG's camelCase attrs (viewBox→viewbox),
                // so it could never byte-match the rendered HTML.
                $inner = '';
                foreach ( $child->childNodes as $g ) {
                    if ( $g->nodeType === XML_ELEMENT_NODE && in_array( strtolower( $g->nodeName ), $skip, true ) ) continue;
                    $inner .= $child->ownerDocument->saveHTML( $g );
                }
            } else {
                $inner = $child->textContent;
            }
            $inner = trim( preg_replace( '/[ \t\r\n]+/', ' ', (string) $inner ) );
            if ( $inner === '' || strlen( $inner ) > 800 ) continue;
            $clean = trim( wp_strip_all_tags( $inner ) );
            if ( ! self::looks_like_real_text( $clean ) ) continue;

            // Keep inline HTML ONLY when formatting is INTERSPERSED with bare text
            // ("A legacy <span>measured</span> in trust") — there the tags sit
            // mid-text and clean text wouldn't be a contiguous substring. When the
            // inline tag merely WRAPS the whole text (<h4>/<span>/<a> around a
            // label), store CLEAN TEXT: it matches the string under ANY wrapper,
            // so responsive duplicates (<h4> desktop vs <span> mobile accordion)
            // both translate from one field.
            $keep_html = $has_inline && $has_direct_text;
            $value = $keep_html ? $inner : $clean;
            if ( isset( $seen[ $value ] ) ) continue;
            $seen[ $value ] = true;
            $fields[ 'content:' . md5( $value ) ] = array( 'value' => $value, 'type' => ( $keep_html ? 'html' : 'text' ) );
        }
    }

    /** True if $el contains any descendant element that is block-level (not inline, not skip). */
    private static function has_block_descendant( $el, $skip ) {
        foreach ( $el->getElementsByTagName( '*' ) as $d ) {
            $t = strtolower( $d->nodeName );
            if ( in_array( $t, $skip, true ) || in_array( $t, self::$inline_tags, true ) ) continue;
            return true;
        }
        return false;
    }

    /**
     * Safety net for 100% coverage: the block-vs-inline walk can still miss text
     * in odd nestings (e.g. an all-inline action bar where a sibling icon-only
     * <a> made the container look non-leaf). Sweep every visible text node and,
     * for any not already captured, store its NEAREST inline-only ancestor's
     * clean text — so a stray label is captured as a whole unit, and fragments of
     * an already-captured unit dedup away (their ancestor's text is in $seen).
     */
    private static function sweep_text_nodes( $doc, $body, &$fields, &$seen, $skip ) {
        $xpath = new DOMXPath( $doc );
        $nodes = $xpath->query( './/text()[normalize-space()]', $body );
        if ( ! $nodes ) return;

        // Dedup by CLEAN text of everything already captured — a leaf stored as
        // inline HTML ("A legacy <span>measured</span> in trust") is keyed by its
        // markup in $seen, so without this the sweep would re-add its clean-text
        // twin as a near-duplicate field.
        $captured = array();
        foreach ( $fields as $fld ) {
            $c = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( is_array( $fld ) ? ( $fld['value'] ?? '' ) : $fld ) ) );
            if ( $c !== '' ) $captured[ $c ] = true;
        }
        foreach ( $nodes as $tn ) {
            // Reject text inside a skip subtree (script/style/svg/nav-select…).
            $skipped = false;
            for ( $a = $tn->parentNode; $a && $a->nodeType === XML_ELEMENT_NODE; $a = $a->parentNode ) {
                if ( in_array( strtolower( $a->nodeName ), $skip, true ) ) { $skipped = true; break; }
            }
            if ( $skipped || ! $tn->parentNode ) continue;

            // Climb to the largest ancestor that still has NO block-level
            // descendant — that is the whole text unit this node belongs to.
            $unit = $tn->parentNode;
            while ( $unit->parentNode
                    && $unit->parentNode->nodeType === XML_ELEMENT_NODE
                    && strtolower( $unit->parentNode->nodeName ) !== 'body'
                    && ! self::has_block_descendant( $unit->parentNode, $skip ) ) {
                $unit = $unit->parentNode;
            }
            $clean = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( $unit->textContent ) ) );
            if ( $clean === '' || strlen( $clean ) > 800 || isset( $captured[ $clean ] ) ) continue;
            if ( ! self::looks_like_real_text( $clean ) ) continue;
            $captured[ $clean ] = true;
            $fields[ 'content:' . md5( $clean ) ] = array( 'value' => $clean, 'type' => 'text' );
        }
    }

    /**
     * Capture user-facing ATTRIBUTE strings (search-box placeholder, aria-labels,
     * submit-button value). These render verbatim in the HTML (placeholder="…"),
     * so the frontend strtr pass replaces them in the output buffer just like
     * text. Only genuinely user-visible attrs — not alt/title (proper-noun heavy).
     */
    private static function sweep_attributes( $doc, $body, &$fields ) {
        $xpath = new DOMXPath( $doc );
        $nodes = $xpath->query( './/*[@placeholder or @aria-label or (@type="submit" and @value)]', $body );
        if ( ! $nodes ) return;
        foreach ( $nodes as $el ) {
            foreach ( array( 'placeholder', 'aria-label', 'value' ) as $attr ) {
                if ( $attr === 'value' && strtolower( $el->getAttribute( 'type' ) ) !== 'submit' ) continue;
                $val = trim( $el->getAttribute( $attr ) );
                if ( $val === '' || strlen( $val ) > 400 ) continue;
                if ( ! self::looks_like_real_text( $val ) ) continue;
                $fields[ 'content:' . md5( $val ) ] = array( 'value' => $val, 'type' => 'text' );
            }
        }
    }

    /**
     * Capture <select><option> DISPLAY text (property-type / inquiry filters).
     * Keyed opt:<md5> so the frontend replaces it NODE-BOUNDED (>text<) only —
     * an option's text usually equals its value="" (what the form submits), and
     * a plain strtr would rewrite the value too and break the search backend.
     */
    private static function sweep_options( $doc, $body, &$fields ) {
        $xpath = new DOMXPath( $doc );
        $nodes = $xpath->query( './/option', $body );
        if ( ! $nodes ) return;
        foreach ( $nodes as $opt ) {
            $txt = trim( preg_replace( '/\s+/', ' ', $opt->textContent ) );
            if ( $txt === '' || strlen( $txt ) > 200 ) continue;
            if ( ! self::looks_like_real_text( $txt ) ) continue;
            $fields[ 'opt:' . md5( $txt ) ] = array( 'value' => $txt, 'type' => 'text' );
        }
    }

    private static function extract_houzez_meta( $post ) {
        $fields = array();

        $translatable_meta = array(
            'fave_property_note'        => 'textarea',
            'fave_property_address'     => 'text',
            'fave_property_description' => 'textarea',
        );

        foreach ( $translatable_meta as $meta_key => $type ) {
            $val = get_post_meta( $post->ID, $meta_key, true );
            if ( empty( $val ) || ! is_string( $val ) ) continue;
            $clean = trim( wp_strip_all_tags( $val ) );
            if ( strlen( $clean ) < 3 ) continue;
            if ( is_numeric( $clean ) ) continue;
            if ( filter_var( $clean, FILTER_VALIDATE_URL ) ) continue;
            $fields[ 'houzez_meta:' . $meta_key ] = array( 'value' => $clean, 'type' => $type );
        }

        return $fields;
    }

    // ── ACF ───────────────────────────────────────────────────────────────

    // ACF field types that contain real text (skip numbers, images, urls etc)
    private static $acf_text_types = array( 'text', 'textarea', 'wysiwyg', 'email' );

    // ACF field keys to SKIP (prices, GPS, IDs — these must not be translated)
    private static $acf_skip_keys = array(
        'fave_property_price', 'fave_property_price_postfix',
        'fave_property_size',  'fave_property_bedrooms',
        'fave_property_bathrooms', 'fave_property_garage',
        'fave_property_id',    'fave_property_map_address',
        'fave_property_location', 'fave_video_url',
        'fave_property_zip',   'fave_property_year',
        'fave_property_price_prefix', 'fave_property_size_prefix',
        'fave_property_garage_size',  'fave_lot_size',
        'fave_agent_mobile',   'fave_agent_whatsapp',
        'fave_agent_license',  'fave_agent_tax_number',
    );

    private static function extract_acf( $post_id ) {
        $fields   = array();
        $acf_data = get_fields( $post_id );

        if ( empty( $acf_data ) || ! is_array( $acf_data ) ) return $fields;

        self::walk_acf( $acf_data, $fields, 'acf' );
        return $fields;
    }

    // Recursively walk ACF fields (handles repeaters and groups)
    private static function walk_acf( $data, &$fields, $prefix ) {
        foreach ( $data as $key => $value ) {

            // Skip fields in our skip list (prices, GPS etc)
            if ( in_array( $key, self::$acf_skip_keys ) ) continue;

            $full_key = $prefix . ':' . $key;

            if ( is_string( $value ) && strlen( trim( $value ) ) > 1 ) {
                // Skip if it looks like a number, URL, or file path
                if ( is_numeric( $value ) )             continue;
                if ( filter_var( $value, FILTER_VALIDATE_URL ) ) continue;
                if ( strpos( $value, '/' ) === 0 )      continue;

                $fields[ $full_key ] = array( 'value' => $value, 'type' => 'text' );

            } elseif ( is_array( $value ) ) {
                // Repeater field — loop through each row
                foreach ( $value as $i => $row ) {
                    if ( is_array( $row ) ) {
                        self::walk_acf( $row, $fields, $full_key . ':' . $i );
                    } elseif ( is_string( $row ) && strlen( trim( $row ) ) > 1 ) {
                        $fields[ $full_key . ':' . $i ] = array( 'value' => $row, 'type' => 'text' );
                    }
                }
            }
        }
    }
}
