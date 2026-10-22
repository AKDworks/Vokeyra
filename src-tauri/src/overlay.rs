//! Native recording indicator.
//!
//! A normal `xdg_toplevel` is owned by the compositor: tiling compositors are
//! free to resize it and `set_position` is only a hint.  On Wayland we attach
//! the indicator to `zwlr_layer_shell_v1` through a runtime-loaded
//! `gtk-layer-shell`, so it is a compact overlay and never becomes a tile.
//! The indicator is drawn with Cairo instead of a WebView: that keeps text and
//! the level meter crisp at fractional scale, makes transparency predictable
//! and avoids WebKitGTK flicker on transparent surfaces.

use std::cell::RefCell;
use std::ffi::{c_char, c_int, c_void, CString};
use std::sync::{Mutex, OnceLock};

use gtk::prelude::*;
use serde_json::{json, Value};
use tauri::Manager;

pub const WIDTH: f64 = 248.0;
pub const HEIGHT: f64 = 58.0;
/// Logical distance from the screen edge, identical to the previous layout.
pub const EDGE_MARGIN: c_int = 20;
const PILL_X: f64 = 6.0;
const PILL_Y: f64 = 7.0;
const PILL_W: f64 = 236.0;
const PILL_H: f64 = 44.0;
const CANCEL_X: f64 = 218.0;
const CANCEL_Y: f64 = 29.0;
const CANCEL_R: f64 = 13.0;
const BAR_COUNT: usize = 12;

const LAYER_OVERLAY: c_int = 3;
const EDGE_LEFT: c_int = 0;
const EDGE_RIGHT: c_int = 1;
const EDGE_TOP: c_int = 2;
const EDGE_BOTTOM: c_int = 3;
const KEYBOARD_NONE: c_int = 0;

type InitForWindow = unsafe extern "C" fn(*mut c_void);
type SetNamespace = unsafe extern "C" fn(*mut c_void, *const c_char);
type SetLayer = unsafe extern "C" fn(*mut c_void, c_int);
type SetAnchor = unsafe extern "C" fn(*mut c_void, c_int, c_int);
type SetMargin = unsafe extern "C" fn(*mut c_void, c_int, c_int);
type SetExclusiveZone = unsafe extern "C" fn(*mut c_void, c_int);
type SetKeyboardMode = unsafe extern "C" fn(*mut c_void, c_int);
type SetMonitor = unsafe extern "C" fn(*mut c_void, *mut c_void);
type IsSupported = unsafe extern "C" fn() -> c_int;

struct LayerShell {
    _library: libloading::Library,
    init_for_window: InitForWindow,
    set_namespace: SetNamespace,
    set_layer: SetLayer,
    set_anchor: SetAnchor,
    set_margin: SetMargin,
    set_exclusive_zone: SetExclusiveZone,
    set_keyboard_mode: SetKeyboardMode,
    set_monitor: SetMonitor,
}

unsafe impl Send for LayerShell {}
unsafe impl Sync for LayerShell {}

#[derive(Clone)]
struct IndicatorState {
    phase: String,
    level: f64,
    seconds: f64,
    mode: String,
    language: String,
    top: bool,
    levels: [f64; BAR_COUNT],
}

impl Default for IndicatorState {
    fn default() -> Self {
        Self {
            phase: "starting".into(),
            level: 0.0,
            seconds: 0.0,
            mode: "realtime".into(),
            language: "ru".into(),
            top: false,
            levels: [0.0; BAR_COUNT],
        }
    }
}

impl IndicatorState {
    fn update(&mut self, value: &Value) {
        if let Some(phase) = value["phase"].as_str() {
            self.phase = phase.to_string();
        }
        if let Some(level) = value["level"].as_f64() {
            self.level = level.clamp(0.0, 1.0);
            if self.phase == "recording" {
                self.levels.rotate_left(1);
                self.levels[BAR_COUNT - 1] = self.level;
            } else {
                self.levels = [0.0; BAR_COUNT];
            }
        }
        if let Some(seconds) = value["seconds"].as_f64() {
            self.seconds = seconds.max(0.0);
        }
        if let Some(mode) = value["overlayMode"].as_str() {
            self.mode = mode.to_string();
        }
        if let Some(language) = value["appLanguage"].as_str() {
            self.language = language.to_string();
        }
    }

    fn timer(&self) -> String {
        let seconds = self.seconds.floor() as u64;
        format!("{}:{:02}", seconds / 60, seconds % 60)
    }

    fn label(&self) -> String {
        let english = self.language == "en";
        match self.phase.as_str() {
            "starting" => {
                if english {
                    "Microphone…".into()
                } else {
                    "Микрофон…".into()
                }
            }
            "transcribing" => {
                if english {
                    "Processing".into()
                } else {
                    "Обработка".into()
                }
            }
            _ => self.timer(),
        }
    }
}

struct Info {
    layer_shell: bool,
    reason: Option<String>,
}

static INFO: OnceLock<Mutex<Info>> = OnceLock::new();
thread_local! {
    static INDICATOR: RefCell<Option<Indicator>> = const { RefCell::new(None) };
}

struct Indicator {
    window: gtk::Window,
    area: gtk::DrawingArea,
    state: std::rc::Rc<RefCell<IndicatorState>>,
    layer_shell: Option<LayerShell>,
}

impl Indicator {
    fn place(&self) {
        let Some(layer) = &self.layer_shell else {
            return;
        };
        let raw = self.window.as_ptr() as *mut c_void;
        let (monitor, left_margin) = monitor_under_pointer(&self.window);
        let top = self.state.borrow().top;
        unsafe {
            (layer.set_anchor)(raw, EDGE_LEFT, 1);
            (layer.set_anchor)(raw, EDGE_RIGHT, 0);
            (layer.set_anchor)(raw, EDGE_TOP, i32::from(top));
            (layer.set_anchor)(raw, EDGE_BOTTOM, i32::from(!top));
            (layer.set_margin)(raw, EDGE_LEFT, left_margin);
            (layer.set_margin)(raw, EDGE_RIGHT, 0);
            (layer.set_margin)(raw, EDGE_TOP, EDGE_MARGIN);
            (layer.set_margin)(raw, EDGE_BOTTOM, EDGE_MARGIN);
            if let Some(monitor) = monitor {
                (layer.set_monitor)(raw, monitor.as_ptr() as *mut c_void);
            }
        }
    }

    fn place_fallback(&self) {
        let (monitor, _) = monitor_under_pointer(&self.window);
        let top = self.state.borrow().top;
        if let Some(monitor) = monitor {
            let geometry = monitor.workarea();
            let x = geometry.x() + centered_margin(geometry.width(), WIDTH);
            let y = if top {
                geometry.y() + EDGE_MARGIN
            } else {
                geometry.y() + geometry.height() - HEIGHT as i32 - EDGE_MARGIN
            };
            self.window.move_(x, y);
        }
    }

    fn show(&mut self) {
        if self.layer_shell.is_some() {
            self.place();
        } else {
            self.place_fallback();
        }
        self.window.show_all();
        self.area.queue_draw();
    }

    fn hide(&self) {
        self.window.hide();
    }

    fn redraw(&self) {
        self.area.queue_draw();
    }
}

/// Draw the compact pill.  All coordinates are logical pixels; GTK3 scales the
/// Cairo surface for the monitor, so no CSS or artificial scale factor is used.
fn draw(area: &gtk::DrawingArea, cr: &gtk::cairo::Context, state: &IndicatorState) {
    use gtk::cairo::{FontSlant, FontWeight, Operator};
    let width = f64::from(area.allocated_width());
    let height = f64::from(area.allocated_height());

    cr.set_operator(Operator::Source);
    cr.set_source_rgba(0.0, 0.0, 0.0, 0.0);
    cr.paint().ok();
    cr.set_operator(Operator::Over);

    // Pill background and border.
    rounded_rect(cr, PILL_X, PILL_Y, PILL_W, PILL_H, 24.0);
    cr.set_source_rgb(0.161, 0.176, 0.157);
    cr.fill_preserve().ok();
    cr.set_source_rgb(0.275, 0.302, 0.259);
    cr.set_line_width(1.0);
    cr.stroke().ok();

    let recording = state.phase == "recording";
    let show_levels = recording && state.mode != "minimal";

    // Status dot.
    cr.set_source_rgb(0.545, 0.725, 0.604);
    cr.arc(22.0, 29.0, 3.0, 0.0, std::f64::consts::TAU);
    cr.fill().ok();

    if show_levels {
        for index in 0..BAR_COUNT {
            let bar_height = 3.0 + state.levels[index].clamp(0.0, 1.0) * 20.0;
            let x = 34.0 + index as f64 * 6.0;
            rounded_rect(cr, x, 29.0 - bar_height / 2.0, 3.0, bar_height, 1.5);
            cr.set_source_rgb(0.545, 0.725, 0.604);
            cr.fill().ok();
        }
    }

    // Timer or phase label, centered between the meter and cancel button.
    let label = state.label();
    cr.select_font_face("sans", FontSlant::Normal, FontWeight::Normal);
    cr.set_font_size(13.0);
    if let Ok(extents) = cr.text_extents(&label) {
        let left = if show_levels { 110.0 } else { 38.0 };
        let right = CANCEL_X - CANCEL_R - 3.0;
        let center = (left + right) / 2.0;
        let baseline = 29.0 - extents.y_bearing() - extents.height() / 2.0;
        cr.set_source_rgb(0.784, 0.847, 0.784);
        cr.move_to(center - extents.width() / 2.0, baseline);
        cr.show_text(&label).ok();
    }

    // Cancel button.
    cr.arc(CANCEL_X, CANCEL_Y, CANCEL_R, 0.0, std::f64::consts::TAU);
    cr.set_source_rgb(0.239, 0.267, 0.224);
    cr.fill().ok();
    cr.set_source_rgb(0.722, 0.761, 0.686);
    cr.set_line_width(1.8);
    cr.move_to(CANCEL_X - 4.0, CANCEL_Y - 4.0);
    cr.line_to(CANCEL_X + 4.0, CANCEL_Y + 4.0);
    cr.move_to(CANCEL_X + 4.0, CANCEL_Y - 4.0);
    cr.line_to(CANCEL_X - 4.0, CANCEL_Y + 4.0);
    cr.stroke().ok();

    let _ = (width, height);
}

fn rounded_rect(cr: &gtk::cairo::Context, x: f64, y: f64, width: f64, height: f64, radius: f64) {
    use std::f64::consts::{FRAC_PI_2, PI};
    let radius = radius.min(width / 2.0).min(height / 2.0);
    cr.new_sub_path();
    cr.arc(x + width - radius, y + radius, radius, -FRAC_PI_2, 0.0);
    cr.arc(
        x + width - radius,
        y + height - radius,
        radius,
        0.0,
        FRAC_PI_2,
    );
    cr.arc(x + radius, y + height - radius, radius, FRAC_PI_2, PI);
    cr.arc(x + radius, y + radius, radius, PI, PI + FRAC_PI_2);
    cr.close_path();
}

fn monitor_under_pointer(gtk_window: &gtk::Window) -> (Option<gtk::gdk::Monitor>, c_int) {
    use gtk::gdk::prelude::*;
    use gtk::prelude::WidgetExt;
    let display = gtk_window.display();
    let pointer_position = display
        .default_seat()
        .and_then(|seat| seat.pointer())
        .map(|pointer| {
            let (_, x, y) = pointer.position();
            (x, y)
        });
    let monitor = pointer_position
        .and_then(|(x, y)| display.monitor_at_point(x, y))
        .or_else(|| display.primary_monitor())
        .or_else(|| display.monitor(0));
    let left_margin = monitor
        .as_ref()
        .map(|monitor| centered_margin(monitor.geometry().width(), WIDTH))
        .unwrap_or_else(|| centered_margin(1920, WIDTH));
    (monitor, left_margin)
}

/// Horizontal offset of a fixed-width surface inside the monitor.  Layer
/// margins are logical units, so callers use the logical monitor width.
pub fn centered_margin(monitor_width: i32, surface_width: f64) -> c_int {
    ((monitor_width as f64 - surface_width) / 2.0)
        .round()
        .max(0.0) as c_int
}

fn load_layer_shell() -> Result<LayerShell, String> {
    let library = ["libgtk-layer-shell.so.0", "libgtk-layer-shell.so"]
        .iter()
        .find_map(|name| {
            // SAFETY: the library is a normal shared object with the GTK
            // layer-shell ABI; all symbols are looked up with explicit types.
            unsafe { libloading::Library::new(name).ok() }
        })
        .ok_or_else(|| "Библиотека gtk-layer-shell не найдена.".to_string())?;
    unsafe {
        let is_supported: IsSupported = *library
            .get(b"gtk_layer_is_supported\0")
            .map_err(|_| "gtk-layer-shell не предоставляет gtk_layer_is_supported.".to_string())?;
        if is_supported() == 0 {
            return Err("Композитор не поддерживает протокол layer-shell.".to_string());
        }
        let get = |name: &[u8]| library.get::<*const c_void>(name).map(|symbol| *symbol);
        macro_rules! symbol {
            ($name:literal, $ty:ty) => {{
                let pointer = get(concat!($name, "\0").as_bytes())
                    .map_err(|_| format!("gtk-layer-shell: отсутствует {}.", $name))?;
                std::mem::transmute::<*const c_void, $ty>(pointer)
            }};
        }
        let layer = LayerShell {
            init_for_window: symbol!("gtk_layer_init_for_window", InitForWindow),
            set_namespace: symbol!("gtk_layer_set_namespace", SetNamespace),
            set_layer: symbol!("gtk_layer_set_layer", SetLayer),
            set_anchor: symbol!("gtk_layer_set_anchor", SetAnchor),
            set_margin: symbol!("gtk_layer_set_margin", SetMargin),
            set_exclusive_zone: symbol!("gtk_layer_set_exclusive_zone", SetExclusiveZone),
            set_keyboard_mode: symbol!("gtk_layer_set_keyboard_mode", SetKeyboardMode),
            set_monitor: symbol!("gtk_layer_set_monitor", SetMonitor),
            _library: library,
        };
        Ok(layer)
    }
}

/// Create the native indicator on the GTK main thread.  Must be called from
/// Tauri's `setup`, before the window is shown for the first time.
pub fn create(app: &tauri::AppHandle) -> Result<(), String> {
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("Vokeyra Indicator");
    window.set_decorated(false);
    window.set_resizable(false);
    window.set_skip_taskbar_hint(true);
    window.set_skip_pager_hint(true);
    window.set_keep_above(true);
    window.set_accept_focus(false);
    window.set_focus_on_map(false);
    window.set_focus_on_click(false);
    window.set_can_focus(false);
    window.set_type_hint(gtk::gdk::WindowTypeHint::Utility);
    window.set_app_paintable(true);
    window.set_default_size(WIDTH as i32, HEIGHT as i32);
    window.set_size_request(WIDTH as i32, HEIGHT as i32);
    if let Some(screen) = gtk::prelude::GtkWindowExt::screen(&window) {
        if let Some(visual) = screen.rgba_visual() {
            window.set_visual(Some(&visual));
        }
    }

    let area = gtk::DrawingArea::new();
    area.set_size_request(WIDTH as i32, HEIGHT as i32);
    area.add_events(gtk::gdk::EventMask::BUTTON_PRESS_MASK);
    window.add(&area);
    // Fixed-size hints make tiling compositors (including niri) treat the
    // fallback as a floating utility window even without a parent window.
    let geometry = gtk::gdk::Geometry::new(
        WIDTH as i32,
        HEIGHT as i32,
        WIDTH as i32,
        HEIGHT as i32,
        0,
        0,
        0,
        0,
        0.0,
        0.0,
        gtk::gdk::Gravity::NorthWest,
    );
    window.set_geometry_hints(
        Some(&area),
        Some(&geometry),
        gtk::gdk::WindowHints::MIN_SIZE | gtk::gdk::WindowHints::MAX_SIZE,
    );

    let mut layer_shell = None;
    let mut reason = None;
    let layer_disabled = std::env::var_os("VOKEYRA_DISABLE_LAYER_SHELL").is_some();
    if crate::linux_wayland() && !layer_disabled {
        match load_layer_shell() {
            Ok(layer) => {
                let raw = window.as_ptr() as *mut c_void;
                let namespace = CString::new("vokeyra-indicator").expect("static namespace");
                unsafe {
                    (layer.init_for_window)(raw);
                    (layer.set_namespace)(raw, namespace.as_ptr());
                    (layer.set_layer)(raw, LAYER_OVERLAY);
                    (layer.set_exclusive_zone)(raw, 0);
                    (layer.set_keyboard_mode)(raw, KEYBOARD_NONE);
                    (layer.set_anchor)(raw, EDGE_LEFT, 1);
                    (layer.set_anchor)(raw, EDGE_BOTTOM, 1);
                    (layer.set_margin)(raw, EDGE_TOP, EDGE_MARGIN);
                    (layer.set_margin)(raw, EDGE_BOTTOM, EDGE_MARGIN);
                }
                eprintln!("Vokeyra overlay: native layer-shell indicator");
                layer_shell = Some(layer);
            }
            Err(error) => {
                eprintln!("Vokeyra overlay: layer-shell unavailable: {error}");
                reason = Some(error);
            }
        }
        if layer_shell.is_none() {
            if let Some(main) = app.get_webview_window("main") {
                if let Ok(main) = main.gtk_window() {
                    window.set_transient_for(Some(main.upcast_ref::<gtk::Window>()));
                }
            }
        }
    } else {
        reason = Some(if layer_disabled {
            "Layer-shell отключён переменной VOKEYRA_DISABLE_LAYER_SHELL.".to_string()
        } else {
            "Сеанс не является native Wayland.".to_string()
        });
        if let Some(main) = app.get_webview_window("main") {
            if let Ok(main) = main.gtk_window() {
                window.set_transient_for(Some(main.upcast_ref::<gtk::Window>()));
            }
        }
    }

    let draw_state = std::rc::Rc::new(RefCell::new(IndicatorState::default()));
    let draw_state_clone = draw_state.clone();
    area.connect_draw(move |area, cr| {
        draw(area, cr, &draw_state_clone.borrow());
        gtk::glib::Propagation::Proceed
    });

    let click_app = app.clone();
    area.connect_button_press_event(move |_, event| {
        if event.button() == 1 {
            let (x, y) = event.position();
            if (x - CANCEL_X).powi(2) + (y - CANCEL_Y).powi(2) <= CANCEL_R.powi(2) {
                hide_now();
                if let Some(state) = click_app.try_state::<crate::Desktop>() {
                    state.service.event("shortcut:cancel", Value::Null);
                }
            }
        }
        gtk::glib::Propagation::Proceed
    });

    let info = Info {
        layer_shell: layer_shell.is_some(),
        reason,
    };
    let _ = INFO.get_or_init(|| Mutex::new(info));

    let indicator = Indicator {
        window,
        area,
        state: draw_state,
        layer_shell,
    };
    INDICATOR.with(|slot| *slot.borrow_mut() = Some(indicator));
    Ok(())
}

pub fn status() -> Value {
    let (layer_shell, reason) = INFO
        .get()
        .and_then(|info| info.lock().ok())
        .map(|info| (info.layer_shell, info.reason.clone()))
        .unwrap_or((false, Some("Индикатор ещё не инициализирован.".to_string())));
    json!({
        "mode": if layer_shell { "layer-shell" } else { "window" },
        "layerShell": layer_shell,
        "reason": reason,
        "title": "Vokeyra Indicator",
        "width": WIDTH,
        "height": HEIGHT,
    })
}

/// Schedule a change on the GTK main thread.  Host requests arrive from the
/// Node service thread, while all GTK calls must stay on the main thread.
pub fn show(app: &tauri::AppHandle, top: bool) {
    let _ = app.run_on_main_thread(move || {
        INDICATOR.with(|slot| {
            if let Some(indicator) = slot.borrow_mut().as_mut() {
                indicator.state.borrow_mut().top = top;
                indicator.show();
            }
        });
    });
}

pub fn hide(app: &tauri::AppHandle) {
    // Host requests and service-error handling can run on worker threads.
    let _ = app.run_on_main_thread(hide_now);
}

fn hide_now() {
    INDICATOR.with(|slot| {
        if let Some(indicator) = slot.borrow().as_ref() {
            indicator.hide();
        }
    });
}

pub fn update(app: &tauri::AppHandle, value: Value) {
    let _ = app.run_on_main_thread(move || {
        INDICATOR.with(|slot| {
            if let Some(indicator) = slot.borrow_mut().as_mut() {
                indicator.state.borrow_mut().update(&value);
                indicator.redraw();
                if indicator.state.borrow().mode == "none" {
                    indicator.hide();
                }
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::centered_margin;

    #[test]
    fn centers_the_pill_on_logical_monitor_widths() {
        assert_eq!(centered_margin(1920, 248.0), 836);
        assert_eq!(centered_margin(2560, 248.0), 1156);
        // Fractional logical widths must not produce a negative or overflowing margin.
        assert_eq!(centered_margin(1707, 248.0), 730);
        assert_eq!(centered_margin(200, 248.0), 0);
    }
}
