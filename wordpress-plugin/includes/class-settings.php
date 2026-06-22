<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BT_Settings {

    public static function init() {
        add_action( 'admin_menu',  array( __CLASS__, 'add_menu' ) );
        add_action( 'admin_init',  array( __CLASS__, 'register_settings' ) );
        add_action( 'wp_ajax_bt_connect_server', array( __CLASS__, 'ajax_connect' ) );
    }

    public static function add_menu() {
        add_menu_page(
            'Binayah Translate',
            'Binayah Translate',
            'manage_options',
            'binayah-translate',
            array( __CLASS__, 'render_page' ),
            'dashicons-translation',
            80
        );
    }

    public static function register_settings() {
        register_setting( 'bt_settings_group', 'bt_api_url',    array( 'sanitize_callback' => 'esc_url_raw' ) );
        register_setting( 'bt_settings_group', 'bt_api_key',    array( 'sanitize_callback' => 'sanitize_text_field' ) );
        register_setting( 'bt_settings_group', 'bt_server_url', array( 'sanitize_callback' => 'esc_url_raw' ) );
    }

    public static function ajax_connect() {
        check_ajax_referer( 'bt_connect_nonce', 'nonce' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( 'Unauthorized' );
        }

        $server_url   = esc_url_raw( $_POST['server_url'] ?? '' );
        $admin_secret = sanitize_text_field( $_POST['admin_secret'] ?? '' );

        if ( empty( $server_url ) || empty( $admin_secret ) ) {
            wp_send_json_error( 'Server URL and Admin Secret are required.' );
        }

        // Ensure plugin has an API key
        $api_key = get_option( 'bt_api_key', '' );
        if ( empty( $api_key ) ) {
            $api_key = wp_generate_password( 40, false );
            update_option( 'bt_api_key', $api_key );
        }

        $site_url  = get_site_url();
        $site_name = get_bloginfo( 'name' );

        $response = wp_remote_post( trailingslashit( $server_url ) . 'api/sites/register', array(
            'timeout' => 15,
            'headers' => array( 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array(
                'site_url'     => $site_url,
                'site_name'    => $site_name,
                'wp_api_key'   => $api_key,
                'admin_secret' => $admin_secret,
            ) ),
        ) );

        if ( is_wp_error( $response ) ) {
            wp_send_json_error( 'Connection failed: ' . $response->get_error_message() );
        }

        $body = json_decode( wp_remote_retrieve_body( $response ), true );
        $code = wp_remote_retrieve_response_code( $response );

        if ( $code !== 200 || empty( $body['success'] ) ) {
            wp_send_json_error( $body['error'] ?? 'Server returned error ' . $code );
        }

        // Save server URL
        update_option( 'bt_server_url', $server_url );
        update_option( 'bt_api_url', trailingslashit( $server_url ) . 'api' );

        wp_send_json_success( array(
            'message' => 'Connected successfully! Site ID: ' . ( $body['site_id'] ?? '' ),
            'site_id' => $body['site_id'] ?? '',
        ) );
    }

    public static function render_page() {
        $api_key    = get_option( 'bt_api_key', '' );
        $server_url = get_option( 'bt_server_url', '' );
        $connected  = ! empty( $server_url );

        // Auto-generate API key if empty
        if ( empty( $api_key ) ) {
            $api_key = wp_generate_password( 40, false );
            update_option( 'bt_api_key', $api_key );
        }
        ?>
        <div class="wrap">
            <h1>Binayah Translate</h1>

            <div id="bt-status" style="margin: 16px 0;">
                <?php if ( $connected ) : ?>
                    <div style="padding: 10px 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-weight: 500;">
                        Connected to: <strong><?php echo esc_html( $server_url ); ?></strong>
                    </div>
                <?php else : ?>
                    <div style="padding: 10px 16px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; color: #9a3412; font-weight: 500;">
                        Not connected to any translation server.
                    </div>
                <?php endif; ?>
            </div>

            <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:24px; max-width:600px;">
                <h2 style="margin-top:0; font-size:16px;">Connect to Translation Server</h2>

                <table class="form-table" style="margin-top:0;">
                    <tr>
                        <th><label>Server URL</label></th>
                        <td>
                            <input type="url" id="bt_server_url" value="<?php echo esc_attr( $server_url ?: 'https://translation.binayahhub.com' ); ?>"
                                class="regular-text" placeholder="https://translation.binayahhub.com" />
                            <p class="description">URL of your Binayah Translate server (no trailing slash)</p>
                        </td>
                    </tr>
                    <tr>
                        <th><label>Admin Secret</label></th>
                        <td>
                            <input type="text" id="bt_admin_secret" value="" class="regular-text" placeholder="Enter admin secret key" />
                            <p class="description">The ADMIN_SECRET from your translation server</p>
                        </td>
                    </tr>
                </table>

                <button id="bt_connect_btn" class="button button-primary" style="margin-top:8px;">
                    <?php echo $connected ? 'Reconnect' : 'Connect Server'; ?>
                </button>
                <span id="bt_connect_msg" style="margin-left:12px; font-weight:500;"></span>
            </div>

            <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:24px; max-width:600px; margin-top:20px;">
                <h2 style="margin-top:0; font-size:16px;">Plugin API Key</h2>
                <p style="color:#555; font-size:13px;">This key authenticates requests from the translation server to this WordPress site.</p>
                <div style="display:flex; gap:10px; align-items:center;">
                    <code style="background:#f1f5f9; padding:8px 14px; border-radius:6px; font-size:13px; flex:1; word-break:break-all;">
                        <?php echo esc_html( $api_key ); ?>
                    </code>
                    <button type="button" class="button" onclick="navigator.clipboard.writeText('<?php echo esc_js( $api_key ); ?>').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>
                </div>
                <p style="color:#888; font-size:12px; margin-top:8px;">
                    Use this key when manually adding this site in the admin panel (Sites page).
                </p>
            </div>
        </div>

        <script>
        document.getElementById('bt_connect_btn').addEventListener('click', function() {
            var btn      = this;
            var serverUrl = document.getElementById('bt_server_url').value.trim().replace(/\/$/, '');
            var secret   = document.getElementById('bt_admin_secret').value.trim();
            var msgEl    = document.getElementById('bt_connect_msg');

            if ( ! serverUrl || ! secret ) {
                msgEl.style.color = '#dc2626';
                msgEl.textContent = 'Server URL and Admin Secret are required.';
                return;
            }

            btn.disabled   = true;
            btn.textContent = 'Connecting…';
            msgEl.textContent = '';

            var formData = new FormData();
            formData.append('action',       'bt_connect_server');
            formData.append('nonce',        '<?php echo wp_create_nonce( 'bt_connect_nonce' ); ?>');
            formData.append('server_url',   serverUrl);
            formData.append('admin_secret', secret);

            fetch(ajaxurl, { method: 'POST', body: formData })
                .then(r => r.json())
                .then(data => {
                    if ( data.success ) {
                        msgEl.style.color   = '#059669';
                        msgEl.textContent   = data.data.message;
                        document.getElementById('bt-status').innerHTML =
                            '<div style="padding:10px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;color:#166534;font-weight:500;">Connected to: <strong>' + serverUrl + '</strong></div>';
                    } else {
                        msgEl.style.color = '#dc2626';
                        msgEl.textContent = data.data || 'Connection failed.';
                    }
                })
                .catch(e => {
                    msgEl.style.color = '#dc2626';
                    msgEl.textContent = 'Error: ' + e.message;
                })
                .finally(() => {
                    btn.disabled    = false;
                    btn.textContent = 'Connect Server';
                });
        });
        </script>
        <?php
    }
}
