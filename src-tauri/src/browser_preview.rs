use tauri::{webview::Color, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, WebviewWindow};

/// Solid background used while the preview page is loading or fails to paint,
/// so the child webview never shows the dark app window behind it.
const BROWSER_PREVIEW_BACKGROUND: Color = Color(255, 255, 255, 255);

fn parse_browser_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported browser preview scheme: {scheme}")),
    }
}

fn logical_position(x: f64, y: f64) -> LogicalPosition<f64> {
    LogicalPosition::new(x.max(0.0), y.max(0.0))
}

fn logical_size(width: f64, height: f64) -> LogicalSize<f64> {
    LogicalSize::new(width.max(1.0), height.max(1.0))
}

fn hidden_position() -> LogicalPosition<f64> {
    LogicalPosition::new(0.0, 0.0)
}

fn hidden_size() -> LogicalSize<f64> {
    LogicalSize::new(1.0, 1.0)
}

fn close_browser_webview(webview: tauri::Webview) -> Result<(), String> {
    let _ = webview.set_position(hidden_position());
    let _ = webview.set_size(hidden_size());
    let _ = webview.hide();
    webview.close().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_preview_open(
    webview_window: WebviewWindow,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let url = parse_browser_url(&url)?;
    let window = webview_window.as_ref().window();
    let position = logical_position(x, y);
    let size = logical_size(width, height);
    eprintln!("[bp_open] label={label} url={url} x={x} y={y} w={width} h={height}");

    if let Some(webview) = window.get_webview(&label) {
        webview.navigate(url.clone()).map_err(|error| error.to_string())?;
        webview
            .set_position(position)
            .and_then(|_| webview.set_size(size))
            .map_err(|error| error.to_string())?;
        if width <= 1.0 || height <= 1.0 {
            webview.hide().map_err(|error| error.to_string())?;
        } else {
            webview.show().map_err(|error| error.to_string())?;
        }
        eprintln!("[bp_open] -> navigated existing webview");
        return Ok(());
    }

    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(url.clone()))
        .focused(false)
        .accept_first_mouse(true)
        .background_color(BROWSER_PREVIEW_BACKGROUND);
    // `add_child` can fail with "a webview with label ... already exists" when a
    // previous webview with this label is still tearing down (rapid open/close,
    // hot-reload, React strict-mode double mount). Fall back to reusing it.
    let webview = match window.add_child(builder, position, size) {
        Ok(webview) => {
            eprintln!("[bp_open] -> created new webview");
            webview
        }
        Err(error) => match window.get_webview(&label) {
            Some(webview) => {
                eprintln!("[bp_open] -> add_child failed ({error}), reusing existing");
                let _ = webview.navigate(url);
                let _ = webview.set_position(position);
                let _ = webview.set_size(size);
                if width <= 1.0 || height <= 1.0 {
                    let _ = webview.hide();
                } else {
                    let _ = webview.show();
                }
                webview
            }
            None => {
                eprintln!("[bp_open] -> add_child failed ({error}), no existing to reuse");
                return Err(error.to_string());
            }
        },
    };

    if width <= 1.0 || height <= 1.0 {
        webview.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn browser_preview_set_bounds(
    webview_window: WebviewWindow,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = webview_window.as_ref().window();
    let Some(webview) = window.get_webview(&label) else {
        return Ok(());
    };
    eprintln!("[bp_set_bounds] label={label} x={x} y={y} w={width} h={height}");

    webview
        .set_position(logical_position(x, y))
        .and_then(|_| webview.set_size(logical_size(width, height)))
        .map_err(|error| error.to_string())?;

    if width <= 1.0 || height <= 1.0 {
        webview.hide().map_err(|error| error.to_string())?;
    } else {
        webview.show().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn browser_preview_hide(
    webview_window: WebviewWindow,
    label: String,
) -> Result<(), String> {
    let window = webview_window.as_ref().window();
    let Some(webview) = window.get_webview(&label) else {
        return Ok(());
    };

    close_browser_webview(webview)
}

#[tauri::command]
pub async fn browser_preview_close(
    webview_window: WebviewWindow,
    label: String,
) -> Result<(), String> {
    let window = webview_window.as_ref().window();
    if let Some(webview) = window.get_webview(&label) {
        close_browser_webview(webview)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_preview_close_with_prefix(
    webview_window: WebviewWindow,
    label_prefix: String,
) -> Result<(), String> {
    let window = webview_window.as_ref().window();
    let webviews = window.webviews();
    let mut last_error: Option<String> = None;

    for webview in webviews {
        if !webview.label().starts_with(&label_prefix) {
            continue;
        }
        if let Err(error) = close_browser_webview(webview) {
            last_error = Some(error);
        }
    }

    last_error.map_or(Ok(()), Err)
}
