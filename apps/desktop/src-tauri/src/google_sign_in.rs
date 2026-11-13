// Adapted from TaskMint apps/desktop/src-tauri/src/google_sign_in.rs @ ebe0b78.
//! Google sign-in on the desktop, the way Google has
//! installed apps do it: the system browser opens Google's sign-in page, and
//! Google sends the browser back to a one-time listener on 127.0.0.1 with a
//! code, which is exchanged (with the PKCE verifier only this process knows)
//! for an ID token. The webview signs in to Firebase with that token. The
//! webview can't do it itself: Google refuses sign-in inside embedded
//! webviews, and Firebase's popup can't open from one.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

use crate::platform::Platform;

/// How long the browser has to come back.
pub const TIMEOUT: Duration = Duration::from_secs(300);

/// The app's "Desktop app" OAuth client (Google Cloud console → Credentials).
/// Google treats an installed app's secret as public; PKCE protects the flow.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleClient {
    pub client_id: String,
    pub client_secret: String,
}

/// Where Google's pages are, and where the browser comes back to (tests
/// use a stand-in token endpoint).
pub struct Endpoints<'a> {
    pub auth: &'a str,
    pub token: &'a str,
    /// The listener's address: a free port on this computer.
    pub listen: &'a str,
}

pub const GOOGLE: Endpoints<'static> = Endpoints {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    listen: "127.0.0.1:0",
};

/// The page the browser shows once it's back, with `{{…}}`s to fill in.
const PAGE: &str = include_str!("google_sign_in_page.html");
/// The app's wordmarks (Wordmark.tsx's) and favicon, in the page itself.
const LOGO: &[u8] = include_bytes!("../../../../packages/client/public/budgetmint-logo.png");
const LOGO_DARK: &[u8] =
    include_bytes!("../../../../packages/client/public/budgetmint-logo-dark.png");
const FAVICON: &[u8] = include_bytes!("../../../../packages/client/public/favicon.png");

const CHECK: &str = r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>"#;
const ALERT: &str = r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 6.5v7"/><path d="M12 17.5v.01"/></svg>"#;

/// A `budgetmint://` link (`budgetmint-dev://` from a dev build), which
/// brings the app forward (window.rs).
fn app_link(path: &str) -> String {
    format!("{}://{}", crate::window::scheme(), path)
}

/// What the browser shows once it's back, signed in to Google or not. (The
/// app finishes signing in after it, so the page promises nothing more.)
/// Signed in, it opens the app as it loads: the browser asks first, then
/// the app comes forward, which it can't do by itself from behind the
/// browser (macOS). Its button opens the app again, for when the browser's
/// question was turned down. Failed, it doesn't open the app, which stays
/// where it was; its button goes back there.
fn done_page(signed_in: bool) -> String {
    let (outcome, mark, title, message, button, link) = if signed_in {
        (
            "done",
            CHECK,
            "Google's part is done",
            "BudgetMint is finishing signing you in. You can close this tab.",
            "Open BudgetMint",
            app_link("signed-in"),
        )
    } else {
        (
            "failed",
            ALERT,
            "Signing in didn't finish",
            "Close this tab and try again from BudgetMint.",
            "Back to BudgetMint",
            app_link("sign-in"),
        )
    };
    let script = if signed_in {
        format!("<script>location.href = \"{}\";</script>", link)
    } else {
        String::new()
    };
    [
        ("outcome", outcome),
        ("mark", mark),
        ("title", title),
        ("message", message),
        ("button", button),
        ("link", &link),
        ("script", &script),
        ("logo", &STANDARD.encode(LOGO)),
        ("logo_dark", &STANDARD.encode(LOGO_DARK)),
        ("favicon", &STANDARD.encode(FAVICON)),
    ]
    .iter()
    .fold(PAGE.to_string(), |page, (key, value)| {
        page.replace(&format!("{{{{{}}}}}", key), value)
    })
}

/// done_page as the listener's reply. It isn't kept, and it may run its
/// own script but load nothing (the address has the sign-in's code in it).
fn done_reply(signed_in: bool) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    [
        "Content-Type: text/html; charset=utf-8",
        "Cache-Control: no-store",
        "Referrer-Policy: no-referrer",
        "Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; \
         script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ]
    .iter()
    .fold(
        tiny_http::Response::from_string(done_page(signed_in)),
        |reply, header| {
            reply.with_header(header.parse::<tiny_http::Header>().expect("a valid header"))
        },
    )
}

/// A random URL-safe text: 32 bytes of the system's randomness (v4 UUIDs).
fn random_text() -> String {
    let bytes: Vec<u8> = (0..2)
        .flat_map(|_| *uuid::Uuid::new_v4().as_bytes())
        .collect();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE's S256 challenge for `verifier` (RFC 7636 §4.2): the URL-safe
/// base64 of its SHA-256, unpadded.
fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// The browser's request: the code, or Google's error, once the state matches.
fn read_redirect(path: &str, state: &str) -> Option<Result<String, String>> {
    let url = url::Url::parse(&format!("http://127.0.0.1{}", path)).ok()?;
    let mut code = None;
    let mut error = None;
    let mut returned_state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "state" => returned_state = Some(value.into_owned()),
            _ => {}
        }
    }
    if returned_state.as_deref() != Some(state) {
        return None;
    }
    match (code, error) {
        (Some(code), _) => Some(Ok(code)),
        (None, Some(error)) if error == "access_denied" => {
            Some(Err("Google sign-in was cancelled.".to_string()))
        }
        (None, error) => Some(Err(format!(
            "Google sign-in failed: {}.",
            error.unwrap_or_else(|| "no code".to_string())
        ))),
    }
}

#[derive(Deserialize)]
struct TokenReply {
    id_token: String,
}

/// google_sign_in: signs in with Google in the system browser, waiting up
/// to TIMEOUT for it to come back.
pub fn sign_in_with_google(
    platform: &dyn Platform,
    client: &GoogleClient,
) -> Result<Value, String> {
    sign_in(platform, client, &GOOGLE, TIMEOUT)
}

/// Signs in with Google in the system browser: `{ idToken }`.
pub fn sign_in(
    platform: &dyn Platform,
    client: &GoogleClient,
    endpoints: &Endpoints,
    timeout: Duration,
) -> Result<Value, String> {
    let server = tiny_http::Server::http(endpoints.listen).map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().expect("a TCP listener").port();
    let redirect = format!("http://127.0.0.1:{}", port);
    let verifier = random_text();
    let challenge = pkce_challenge(&verifier);
    let state = random_text();
    let url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&prompt=select_account",
        endpoints.auth,
        encode(&client.client_id),
        encode(&redirect),
        encode("openid email profile"),
        challenge,
        state
    );
    platform.open_url(&url)?;

    // The browser may ask for other things (a favicon) before or after
    let until = Instant::now() + timeout;
    let code = loop {
        let left = until.saturating_duration_since(Instant::now());
        // (An error waiting counts as no answer)
        let Some(request) = server.recv_timeout(left).ok().flatten() else {
            return Err("Google sign-in timed out. Try again.".to_string());
        };
        match read_redirect(request.url(), &state) {
            Some(outcome) => {
                let _ = request.respond(done_reply(outcome.is_ok()));
                break outcome?;
            }
            None => {
                let _ = request.respond(tiny_http::Response::empty(404));
            }
        }
    };
    // Google's part is done: back to the app, which finishes signing in.
    // Where the system won't let the app come forward by itself from behind
    // the browser (macOS), the page's budgetmint:// link brings it.
    platform.show_main_window();

    let reply: TokenReply = ureq::post(endpoints.token)
        .timeout(Duration::from_secs(30))
        .send_form(&[
            ("code", code.as_str()),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("code_verifier", verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect.as_str()),
        ])
        .map_err(|e| format!("Google sign-in failed: {}", e))?
        .into_json()
        .map_err(|e| format!("Google sign-in failed: {}", e))?;
    Ok(serde_json::json!({ "idToken": reply.id_token }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::fake::FakePlatform;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::Arc;

    const CLIENT: &str = "client-1.apps.googleusercontent.com";

    fn client() -> GoogleClient {
        serde_json::from_value(serde_json::json!({ "clientId": CLIENT, "clientSecret": "s3cret" }))
            .unwrap()
    }

    /// A token endpoint that answers once with `status` and `body`, and
    /// hands back the request it got.
    fn token_endpoint(
        status: u16,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut seen = Vec::new();
            let mut buffer = [0; 4096];
            // Read until the form body (the last part) has come in
            while !String::from_utf8_lossy(&seen).contains("redirect_uri=") {
                let read = stream.read(&mut buffer).unwrap();
                seen.extend_from_slice(&buffer[..read]);
            }
            let reply = format!(
                "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                body.len(),
                body
            );
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8(seen).unwrap()
        });
        (url, handle)
    }

    /// Runs sign_in on a thread, with the browser played by `browse`, which
    /// gets the sign-in page's address.
    fn signing_in(
        token: &str,
        timeout: Duration,
        browse: impl FnOnce(url::Url) + Send + 'static,
    ) -> Result<Value, String> {
        signing_in_on(&Arc::new(FakePlatform::default()), token, timeout, browse)
    }

    /// signing_in, on `platform`.
    fn signing_in_on(
        platform: &Arc<FakePlatform>,
        token: &str,
        timeout: Duration,
        browse: impl FnOnce(url::Url) + Send + 'static,
    ) -> Result<Value, String> {
        let watching = platform.clone();
        let browser = std::thread::spawn(move || {
            let opened = loop {
                if let Some(url) = watching.recorded().opened_urls.first().cloned() {
                    break url;
                }
                std::thread::sleep(Duration::from_millis(2));
            };
            browse(url::Url::parse(&opened).unwrap());
        });
        let endpoints = Endpoints {
            auth: "https://accounts.example.com/auth",
            token,
            listen: "127.0.0.1:0",
        };
        let result = sign_in(platform.as_ref(), &client(), &endpoints, timeout);
        browser.join().unwrap();
        result
    }

    fn param(url: &url::Url, name: &str) -> String {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .unwrap()
    }

    /// The browser coming back to the listener with `query`.
    fn come_back(url: &url::Url, query: &str) -> String {
        let redirect = url::Url::parse(&param(url, "redirect_uri")).unwrap();
        let mut stream = TcpStream::connect(redirect.socket_addrs(|| None).unwrap()[0]).unwrap();
        write!(
            stream,
            "GET /?{} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            query
        )
        .unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        reply
    }

    #[test]
    fn a_google_sign_in_comes_back_with_an_id_token() {
        let (token, endpoint) =
            token_endpoint(200, r#"{"id_token":"eyJ.id.token","access_token":"x"}"#);
        let platform = Arc::new(FakePlatform::default());
        let result = signing_in_on(&platform, &token, TIMEOUT, |url| {
            assert_eq!(url.path(), "/auth");
            assert_eq!(param(&url, "client_id"), CLIENT);
            assert_eq!(param(&url, "scope"), "openid email profile");
            assert_eq!(param(&url, "code_challenge_method"), "S256");
            assert!(param(&url, "redirect_uri").starts_with("http://127.0.0.1:"));
            // A favicon first, then a wrong state: neither is the answer
            assert!(come_back(&url, "x=1").starts_with("HTTP/1.1 404"));
            assert!(come_back(&url, "code=c&state=forged").starts_with("HTTP/1.1 404"));
            let state = param(&url, "state");
            let page = come_back(&url, &format!("code=the-code&state={}", state));
            assert!(page.contains("Google's part is done"));
            // It opens the app, which comes forward from behind the browser
            // (budgetmint-dev:// here: tests are a dev build)
            assert!(
                page.contains(r#"<script>location.href = "budgetmint-dev://signed-in";</script>"#)
            );
            // Not kept, and loading nothing with the code in the address
            let page = page.to_lowercase();
            assert!(page.contains("content-type: text/html; charset=utf-8"));
            assert!(page.contains("cache-control: no-store"));
            assert!(page.contains("referrer-policy: no-referrer"));
            assert!(page.contains("content-security-policy: default-src 'none';"));
        });
        assert_eq!(result, Ok(serde_json::json!({ "idToken": "eyJ.id.token" })));
        // The window came forward from behind the browser
        assert_eq!(platform.recorded().windows_shown, 1);
        let request = endpoint.join().unwrap();
        assert!(request.contains("code=the-code"));
        assert!(request.contains("client_secret=s3cret"));
        assert!(request.contains("grant_type=authorization_code"));
        // Google was given the challenge for the verifier the exchange sends
        let verifier = request
            .split("code_verifier=")
            .nth(1)
            .and_then(|rest| rest.split('&').next())
            .unwrap();
        let opened = url::Url::parse(&platform.recorded().opened_urls[0]).unwrap();
        assert_eq!(param(&opened, "code_challenge"), pkce_challenge(verifier));
    }

    #[test]
    fn the_page_back_from_google_is_the_apps() {
        for signed_in in [true, false] {
            let page = done_page(signed_in);
            // Every blank filled in
            assert!(!page.contains("{{"), "{}", page);
            // The wordmark for each theme, and the favicon, in the page itself
            for image in [LOGO, LOGO_DARK, FAVICON] {
                assert!(page.contains(&format!("data:image/png;base64,{}", STANDARD.encode(image))));
            }
        }
        let done = done_page(true);
        assert!(done.contains(r#"<div class="card done">"#));
        assert!(done.contains(
            r#"<a class="button" href="budgetmint-dev://signed-in">Open BudgetMint</a>"#
        ));
        // Failed, the button goes back to the app, which isn't opened for it
        let failed = done_page(false);
        assert!(failed.contains(r#"<div class="card failed">"#));
        assert!(failed.contains(
            r#"<a class="button" href="budgetmint-dev://sign-in">Back to BudgetMint</a>"#
        ));
        assert!(!failed.contains("<script"));
    }

    #[test]
    fn the_challenge_is_rfc_7636s_s256() {
        // RFC 7636 Appendix B's example
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_cancelled_or_failed_sign_in_says_so() {
        for (error, message) in [
            ("access_denied", "Google sign-in was cancelled."),
            ("server_error", "Google sign-in failed: server_error."),
            ("", "Google sign-in failed: no code."),
        ] {
            let platform = Arc::new(FakePlatform::default());
            let result =
                signing_in_on(&platform, "http://127.0.0.1:9/token", TIMEOUT, move |url| {
                    let state = param(&url, "state");
                    let query = match error {
                        "" => format!("state={}", state),
                        error => format!("error={}&state={}", error, state),
                    };
                    // The browser isn't told it worked, and doesn't open the app
                    let page = come_back(&url, &query);
                    assert!(page.contains("Signing in didn't finish"));
                    assert!(!page.contains("<script"));
                });
            assert_eq!(result, Err(message.to_string()));
            assert_eq!(platform.recorded().windows_shown, 0);
        }
    }

    #[test]
    fn a_refused_code_or_an_odd_reply_says_so() {
        let (token, _) = token_endpoint(400, r#"{"error":"invalid_grant"}"#);
        let result = signing_in(&token, TIMEOUT, |url| {
            come_back(&url, &format!("code=c&state={}", param(&url, "state")));
        });
        assert!(result.unwrap_err().starts_with("Google sign-in failed: "));

        let (token, _) = token_endpoint(200, r#"{"access_token":"no id token"}"#);
        let result = signing_in(&token, TIMEOUT, |url| {
            come_back(&url, &format!("code=c&state={}", param(&url, "state")));
        });
        assert!(result.unwrap_err().starts_with("Google sign-in failed: "));
    }

    #[test]
    fn a_browser_that_never_comes_back_times_out() {
        let result = signing_in(
            "http://127.0.0.1:9/token",
            Duration::from_millis(50),
            |_| {},
        );
        assert_eq!(
            result,
            Err("Google sign-in timed out. Try again.".to_string())
        );
    }

    #[test]
    fn no_port_to_listen_on_is_an_error() {
        let endpoints = Endpoints {
            listen: "not an address",
            ..GOOGLE
        };
        assert!(sign_in(&FakePlatform::default(), &client(), &endpoints, TIMEOUT).is_err());
    }

    #[test]
    fn a_browser_that_cannot_open_is_an_error() {
        let platform = FakePlatform::default();
        platform.fail("open_url");
        assert!(sign_in(&platform, &client(), &GOOGLE, TIMEOUT).is_err());
        // An address that isn't one is never the answer
        assert_eq!(read_redirect("not a path", "s"), None);
    }
}
