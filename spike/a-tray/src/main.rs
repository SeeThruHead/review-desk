use std::{
    env,
    io::{BufRead, BufReader},
    process::Command,
    thread,
    time::Duration,
};

use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tray_icon::{
    Icon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem},
};

enum TrayEvent {
    Count(usize),
    Menu(MenuEvent),
}

const WATCH: &str = "{\"_tag\":\"Request\",\"id\":\"1\",\"tag\":\"Watch\",\"payload\":null,\"headers\":[]}\n";

fn supervise(server: String) {
    loop {
        let status = Command::new(&server).status();
        eprintln!("server exited: {status:?}, restarting");
        thread::sleep(Duration::from_secs(2));
    }
}

fn pulls_in(line: &str) -> Option<usize> {
    let message: serde_json::Value = serde_json::from_str(line).ok()?;
    message["values"].as_array()?.last()?["pulls"].as_array().map(Vec::len)
}

fn watch(url: String, proxy: EventLoopProxy<TrayEvent>) {
    loop {
        let response = ureq::post(&url).header("content-type", "application/ndjson").send(WATCH);
        if let Ok(response) = response {
            BufReader::new(response.into_body().into_reader())
                .lines()
                .map_while(Result::ok)
                .filter_map(|line| pulls_in(&line))
                .for_each(|count| {
                    let _ = proxy.send_event(TrayEvent::Count(count));
                });
        }
        thread::sleep(Duration::from_secs(2));
    }
}

fn icon() -> Icon {
    let pixels = [0x2a_u8, 0x8a, 0x5c, 0xff].repeat(16 * 16);
    Icon::from_rgba(pixels, 16, 16).expect("icon is 16 by 16")
}

fn main() {
    let server = env::var("REVIEW_DESK_SERVER").expect("REVIEW_DESK_SERVER is set");
    let port = env::var("PORT").unwrap_or_else(|_| "4710".to_string());
    let event_loop = EventLoopBuilder::<TrayEvent>::with_user_event().build();
    let watch_proxy = event_loop.create_proxy();
    let menu_proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = menu_proxy.send_event(TrayEvent::Menu(event));
    }));
    thread::spawn(move || supervise(server));
    let rpc = format!("http://127.0.0.1:{port}/rpc");
    thread::spawn(move || watch(rpc, watch_proxy));

    let open = MenuItem::new("Open Review Desk", true, None);
    let quit = MenuItem::new("Quit", true, None);
    let menu = Menu::new();
    menu.append_items(&[&open, &quit]).expect("menu builds");
    let open_id = open.id().clone();
    let quit_id = quit.id().clone();
    let page = format!("http://127.0.0.1:{port}/");
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_icon(icon())
        .with_title("RD")
        .build()
        .expect("tray builds");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            tao::event::Event::UserEvent(TrayEvent::Count(count)) => tray.set_title(Some(format!("RD {count}"))),
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == quit_id => *control_flow = ControlFlow::Exit,
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == open_id => {
                let _ = Command::new("open").arg(&page).spawn();
            }
            _ => {}
        }
    });
}
