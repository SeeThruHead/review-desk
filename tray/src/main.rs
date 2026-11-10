use std::{
    env,
    io::{BufRead, BufReader},
    process::{Child, Command},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use serde::Deserialize;
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tray_icon::{
    Icon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem},
};

const WATCH: &str = "{\"_tag\":\"Request\",\"id\":\"1\",\"tag\":\"WatchSummary\",\"payload\":null,\"headers\":[]}\n";

#[derive(Deserialize, Clone, Copy, Default, PartialEq)]
struct Summary {
    ready: u32,
    working: u32,
    talking: u32,
}

#[derive(Deserialize)]
struct Chunk {
    values: Vec<Summary>,
}

enum TrayEvent {
    Summary(Summary),
    Offline,
    Menu(MenuEvent),
}

struct Settings {
    url: String,
    server: Option<String>,
}

fn settings() -> Settings {
    Settings {
        url: env::var("REVIEW_DESK_URL").unwrap_or_else(|_| "http://127.0.0.1:4790".to_string()),
        server: env::var("REVIEW_DESK_SERVER").ok(),
    }
}

fn spawn_server(server: &str) -> Option<Child> {
    Command::new(server).arg("serve").spawn().ok()
}

fn supervise(server: String, current: Arc<Mutex<Option<Child>>>) {
    std::iter::repeat(()).for_each(|_| {
        let child = spawn_server(&server);
        let pid = child.as_ref().map(Child::id);
        if let Ok(mut slot) = current.lock() {
            *slot = child;
        }
        let exited = pid.is_some() && wait_for(&current);
        eprintln!("review-desk server stopped (exited: {exited}); starting it again");
        thread::sleep(Duration::from_secs(2));
    });
}

fn wait_for(current: &Arc<Mutex<Option<Child>>>) -> bool {
    std::iter::repeat(())
        .map(|_| {
            thread::sleep(Duration::from_millis(500));
            current
                .lock()
                .ok()
                .and_then(|mut slot| slot.as_mut().map(|child| child.try_wait().ok().flatten().is_some()))
                .unwrap_or(true)
        })
        .find(|done| *done)
        .unwrap_or(true)
}

fn summaries_in(line: &str) -> Option<Summary> {
    serde_json::from_str::<Chunk>(line).ok()?.values.last().copied()
}

fn watch(url: String, proxy: EventLoopProxy<TrayEvent>) {
    std::iter::repeat(()).for_each(|_| {
        let response = ureq::post(format!("{url}/rpc")).header("content-type", "application/ndjson").send(WATCH);
        if let Ok(response) = response {
            BufReader::new(response.into_body().into_reader())
                .lines()
                .map_while(Result::ok)
                .filter_map(|line| summaries_in(&line))
                .for_each(|summary| {
                    let _ = proxy.send_event(TrayEvent::Summary(summary));
                });
        }
        let _ = proxy.send_event(TrayEvent::Offline);
        thread::sleep(Duration::from_secs(3));
    });
}

fn title(summary: Summary) -> String {
    if summary.ready == 0 {
        return "RD".to_string();
    }
    format!("RD {}", summary.ready)
}

fn tooltip(summary: Summary) -> String {
    format!(
        "Review Desk: {} ready for you, {} agents working, {} talking",
        summary.ready, summary.working, summary.talking
    )
}

fn icon(working: bool) -> Icon {
    let colour = if working { [0x2f_u8, 0x9e, 0x44, 0xff] } else { [0x86_u8, 0x8e, 0x96, 0xff] };
    let pixels = (0..16 * 16)
        .flat_map(|index| {
            let (x, y) = (index % 16, index / 16);
            let inside = (x as i32 - 8).pow(2) + (y as i32 - 8).pow(2) <= 36;
            if inside { colour } else { [0, 0, 0, 0] }
        })
        .collect();
    Icon::from_rgba(pixels, 16, 16).expect("icon is 16 by 16")
}

#[cfg(target_os = "macos")]
fn stay_out_of_the_dock(event_loop: &mut tao::event_loop::EventLoop<TrayEvent>) {
    use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
    event_loop.set_activation_policy(ActivationPolicy::Accessory);
}

#[cfg(not(target_os = "macos"))]
fn stay_out_of_the_dock(_event_loop: &mut tao::event_loop::EventLoop<TrayEvent>) {}

fn stop_server(server: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut slot) = server.lock() {
        if let Some(child) = slot.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn open(url: &str) {
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    let _ = Command::new(opener).arg(url).spawn();
}

fn main() {
    let settings = settings();
    let mut event_loop = EventLoopBuilder::<TrayEvent>::with_user_event().build();
    stay_out_of_the_dock(&mut event_loop);
    let watch_proxy = event_loop.create_proxy();
    let menu_proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = menu_proxy.send_event(TrayEvent::Menu(event));
    }));

    let server: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    if let Some(path) = settings.server.clone() {
        let slot = Arc::clone(&server);
        thread::spawn(move || supervise(path, slot));
    }
    let url = settings.url.clone();
    thread::spawn(move || watch(url, watch_proxy));
    let on_signal = Arc::clone(&server);
    let _ = ctrlc::set_handler(move || {
        stop_server(&on_signal);
        std::process::exit(0);
    });

    let status = MenuItem::new("Connecting to your desk", false, None);
    let open_item = MenuItem::new("Open Review Desk", true, None);
    let quit = MenuItem::new("Quit Review Desk", true, None);
    let menu = Menu::new();
    menu.append_items(&[&status, &open_item, &quit]).expect("menu builds");
    let open_id = open_item.id().clone();
    let quit_id = quit.id().clone();
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_icon(icon(false))
        .with_title("RD")
        .with_tooltip("Review Desk")
        .build()
        .expect("tray builds");
    let page = format!("{}/", settings.url);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            tao::event::Event::UserEvent(TrayEvent::Summary(summary)) => {
                tray.set_title(Some(title(summary)));
                let _ = tray.set_tooltip(Some(tooltip(summary)));
                let _ = tray.set_icon(Some(icon(summary.working > 0)));
                status.set_text(tooltip(summary).replace("Review Desk: ", ""));
            }
            tao::event::Event::UserEvent(TrayEvent::Offline) => {
                tray.set_title(Some("RD ?"));
                status.set_text("Desk not answering");
            }
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == open_id => open(&page),
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == quit_id => {
                stop_server(&server);
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_latest_summary_from_a_stream_chunk() {
        let line = "{\"_tag\":\"Chunk\",\"requestId\":\"1\",\"values\":[{\"ready\":1,\"working\":0,\"talking\":0},{\"ready\":2,\"working\":1,\"talking\":3}]}";
        assert!(summaries_in(line) == Some(Summary { ready: 2, working: 1, talking: 3 }));
        assert!(summaries_in("{\"_tag\":\"Exit\"}").is_none());
    }

    #[test]
    fn shows_the_ready_count_only_when_something_is_ready() {
        assert_eq!(title(Summary::default()), "RD");
        assert_eq!(title(Summary { ready: 3, working: 0, talking: 0 }), "RD 3");
        assert_eq!(tooltip(Summary { ready: 1, working: 2, talking: 0 }), "Review Desk: 1 ready for you, 2 agents working, 0 talking");
    }
}
