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
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339, macros::format_description};
use tray_icon::{
    Icon, TrayIcon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem},
};

const WATCH: &str = "{\"_tag\":\"Request\",\"id\":\"1\",\"tag\":\"WatchSummary\",\"payload\":null,\"headers\":[]}\n";

const LONGEST_LINE: usize = 90;

#[derive(Deserialize, Clone, Copy, Default, PartialEq, Debug)]
#[serde(default, rename_all = "camelCase")]
struct SectionCount {
    total: u32,
    needs_you: u32,
}

#[derive(Deserialize, Clone, Copy, Default, PartialEq, Debug)]
#[serde(default)]
struct Agents {
    working: u32,
    talking: u32,
}

#[derive(Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(default)]
struct Need {
    key: String,
    title: String,
    url: String,
    why: String,
}

#[derive(Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(default, rename_all = "camelCase")]
struct Health {
    state: String,
    reason: Option<String>,
    last_good: Option<String>,
    until: Option<String>,
}

#[derive(Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
struct Routing {
    on: bool,
    reason: Option<String>,
}

impl Default for Routing {
    fn default() -> Self {
        Routing { on: true, reason: None }
    }
}

#[derive(Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(default, rename_all = "camelCase")]
struct Summary {
    needs_you: u32,
    reviewing: SectionCount,
    mine: SectionCount,
    mentions: SectionCount,
    agents: Agents,
    top: Vec<Need>,
    health: Health,
    routing: Routing,
}

#[derive(Deserialize)]
struct Chunk {
    values: Vec<Summary>,
}

enum TrayEvent {
    Summary(Box<Summary>),
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
    serde_json::from_str::<Chunk>(line).ok()?.values.last().cloned()
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
                    let _ = proxy.send_event(TrayEvent::Summary(Box::new(summary)));
                });
        }
        let _ = proxy.send_event(TrayEvent::Offline);
        thread::sleep(Duration::from_secs(3));
    });
}

fn is_current(summary: &Summary) -> bool {
    summary.health.state.is_empty() || summary.health.state == "live"
}

fn title(summary: &Summary) -> String {
    let count = if summary.needs_you == 0 { String::new() } else { format!(" {}", summary.needs_you) };
    let warning = if is_current(summary) { "" } else { " ⚠" };
    format!("RD{count}{warning}")
}

fn tooltip(summary: &Summary) -> String {
    let need = if summary.needs_you == 1 { "1 thing needs you".to_string() } else { format!("{} things need you", summary.needs_you) };
    format!("Review Desk: {need}")
}

fn clock(iso: &str, offset: UtcOffset) -> String {
    OffsetDateTime::parse(iso, &Rfc3339)
        .ok()
        .and_then(|time| time.to_offset(offset).format(format_description!("[hour]:[minute]")).ok())
        .unwrap_or_else(|| iso.to_string())
}

fn status_line(summary: &Summary, offset: UtcOffset) -> String {
    let health = &summary.health;
    let read = health.last_good.as_deref().map(|at| clock(at, offset));
    let reason = health.reason.as_deref().map(|why| format!(": {why}")).unwrap_or_default();
    match health.state.as_str() {
        "paused" => {
            let until = health.until.as_deref().map(|at| format!(" until {}", clock(at, offset))).unwrap_or_default();
            format!("Paused{until}{reason}")
        }
        "stale" => match read {
            Some(at) => format!("Stale, last read at {at}{reason}"),
            None => format!("Nothing read yet{reason}"),
        },
        _ => match read {
            Some(at) => format!("Live, read at {at}"),
            None => "Live, not read yet".to_string(),
        },
    }
}

fn routing_line(summary: &Summary) -> Option<String> {
    let reason = summary.routing.reason.as_deref()?;
    Some(if summary.routing.on { format!("Routing: {reason}") } else { format!("Routing off: {reason}") })
}

fn shortened(text: &str) -> String {
    if text.chars().count() <= LONGEST_LINE {
        return text.to_string();
    }
    let kept: String = text.chars().take(LONGEST_LINE - 1).collect();
    format!("{kept}…")
}

fn need_line(need: &Need) -> String {
    let place = need.key.split_once(':').map(|(_, rest)| rest).unwrap_or(&need.key);
    shortened(&format!("{place} {}: {}", need.title, need.why))
}

fn section_line(name: &str, count: SectionCount) -> String {
    if count.needs_you == 0 {
        return format!("{name}: {}", count.total);
    }
    format!("{name}: {}, {} need you", count.total, count.needs_you)
}

fn agents_line(agents: Agents) -> String {
    let working = if agents.working == 1 { "1 agent working".to_string() } else { format!("{} agents working", agents.working) };
    format!("{working}, {} talking", agents.talking)
}

fn lines(summary: &Summary, offset: UtcOffset) -> Vec<String> {
    let head = std::iter::once(status_line(summary, offset)).chain(routing_line(summary));
    let needs = std::iter::once(format!("Needs you ({})", summary.needs_you)).chain(summary.top.iter().map(need_line));
    let counts = [
        section_line("Reviewing", summary.reviewing),
        section_line("Your pull requests", summary.mine),
        section_line("Mentions", summary.mentions),
        agents_line(summary.agents),
    ];
    head.chain(needs).chain(counts).collect()
}

fn icon(colour: [u8; 4]) -> Icon {
    let pixels = (0..16 * 16)
        .flat_map(|index| {
            let (x, y) = (index % 16, index / 16);
            let inside = (x as i32 - 8).pow(2) + (y as i32 - 8).pow(2) <= 36;
            if inside { colour } else { [0, 0, 0, 0] }
        })
        .collect();
    Icon::from_rgba(pixels, 16, 16).expect("icon is 16 by 16")
}

const GREEN: [u8; 4] = [0x2f, 0x9e, 0x44, 0xff];
const GREY: [u8; 4] = [0x86, 0x8e, 0x96, 0xff];
const AMBER: [u8; 4] = [0xe8, 0x9a, 0x2c, 0xff];

fn colour_of(summary: &Summary) -> [u8; 4] {
    if !is_current(summary) {
        return AMBER;
    }
    if summary.agents.working > 0 { GREEN } else { GREY }
}

struct Built {
    menu: Menu,
    links: Vec<(MenuId, String)>,
}

fn text_item(text: &str) -> MenuItem {
    MenuItem::new(text, false, None)
}

fn build_menu(summary: Option<&Summary>, offset: UtcOffset, open_item: &MenuItem, quit: &MenuItem) -> Built {
    let menu = Menu::new();
    let links: Vec<(MenuItem, String)> = summary
        .map(|summary| summary.top.iter().map(|need| (MenuItem::new(need_line(need), true, None), need.url.clone())).collect())
        .unwrap_or_default();
    match summary {
        None => {
            let _ = menu.append(&text_item("Desk not answering"));
        }
        Some(summary) => {
            let all = lines(summary, offset);
            let head_count = 1 + usize::from(routing_line(summary).is_some());
            all.iter().take(head_count).for_each(|line| {
                let _ = menu.append(&text_item(line));
            });
            let _ = menu.append(&PredefinedMenuItem::separator());
            let _ = menu.append(&text_item(&all[head_count]));
            links.iter().for_each(|(item, _)| {
                let _ = menu.append(item);
            });
            let _ = menu.append(&PredefinedMenuItem::separator());
            all.iter().skip(head_count + 1 + summary.top.len()).for_each(|line| {
                let _ = menu.append(&text_item(line));
            });
        }
    }
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append_items(&[open_item, quit]);
    Built { menu, links: links.into_iter().map(|(item, url)| (item.id().clone(), url)).collect() }
}

fn show(tray: &TrayIcon, summary: &Summary) {
    tray.set_title(Some(title(summary)));
    let _ = tray.set_tooltip(Some(tooltip(summary)));
    let _ = tray.set_icon(Some(icon(colour_of(summary))));
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
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
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

    let open_item = MenuItem::new("Open Review Desk", true, None);
    let quit = MenuItem::new("Quit Review Desk", true, None);
    let open_id = open_item.id().clone();
    let quit_id = quit.id().clone();
    let first = build_menu(None, offset, &open_item, &quit);
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(first.menu))
        .with_icon(icon(GREY))
        .with_title("RD")
        .with_tooltip("Review Desk")
        .build()
        .expect("tray builds");
    let page = format!("{}/", settings.url);
    let mut links = first.links;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            tao::event::Event::UserEvent(TrayEvent::Summary(summary)) => {
                show(&tray, &summary);
                let built = build_menu(Some(&summary), offset, &open_item, &quit);
                tray.set_menu(Some(Box::new(built.menu)));
                links = built.links;
            }
            tao::event::Event::UserEvent(TrayEvent::Offline) => {
                tray.set_title(Some("RD ?"));
                let _ = tray.set_icon(Some(icon(AMBER)));
                let built = build_menu(None, offset, &open_item, &quit);
                tray.set_menu(Some(Box::new(built.menu)));
                links = built.links;
            }
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == open_id => open(&page),
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == quit_id => {
                stop_server(&server);
                *control_flow = ControlFlow::Exit;
            }
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) => {
                if let Some((_, url)) = links.iter().find(|(id, _)| *id == menu_event.id) {
                    open(url);
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: &str = r#"{"_tag":"Chunk","requestId":"1","values":[{"needsYou":0},{"needsYou":3,"reviewing":{"total":10,"needsYou":2},"mine":{"total":2,"needsYou":0},"mentions":{"total":1,"needsYou":1},"agents":{"working":2,"talking":1},"top":[{"key":"github:acme/api#12","title":"Cache the plan lookups","url":"https://github.com/acme/api/pull/12","section":"mine","why":"Approved with CI passed: ready to merge"}],"health":{"state":"live","reason":null,"lastGood":"2026-11-05T15:42:00Z","until":null},"routing":{"on":true,"reason":null}}]}"#;

    fn live() -> Summary {
        summaries_in(LIVE).expect("reads the chunk")
    }

    fn paused() -> Summary {
        Summary {
            health: Health {
                state: "paused".to_string(),
                reason: Some("GitHub's rate limit for this account is spent".to_string()),
                last_good: Some("2026-11-05T19:45:00Z".to_string()),
                until: Some("2026-11-05T20:12:00Z".to_string()),
            },
            routing: Routing { on: false, reason: Some("No areas configured, so review requests stay with you".to_string()) },
            ..live()
        }
    }

    #[test]
    fn reads_the_latest_summary_from_a_stream_chunk() {
        let summary = live();
        assert_eq!(summary.needs_you, 3);
        assert_eq!(summary.reviewing, SectionCount { total: 10, needs_you: 2 });
        assert_eq!(summary.agents, Agents { working: 2, talking: 1 });
        assert_eq!(summary.top[0].title, "Cache the plan lookups");
        assert!(summaries_in("{\"_tag\":\"Exit\"}").is_none());
    }

    #[test]
    fn reads_an_older_desk_that_sends_only_its_old_counts() {
        let old = summaries_in(r#"{"_tag":"Chunk","values":[{"ready":2,"working":1,"talking":3}]}"#).expect("reads it");
        assert_eq!(old.needs_you, 0);
        assert!(is_current(&old));
        assert_eq!(title(&old), "RD");
    }

    #[test]
    fn shows_what_needs_you_and_warns_when_the_data_is_old() {
        assert_eq!(title(&Summary::default()), "RD");
        assert_eq!(title(&live()), "RD 3");
        assert_eq!(title(&paused()), "RD 3 ⚠");
        assert_eq!(title(&Summary { health: Health { state: "stale".to_string(), ..Health::default() }, ..Summary::default() }), "RD ⚠");
        assert_eq!(tooltip(&live()), "Review Desk: 3 things need you");
        assert_eq!(tooltip(&Summary { needs_you: 1, ..Summary::default() }), "Review Desk: 1 thing needs you");
    }

    #[test]
    fn colours_the_dot_for_working_agents_and_old_data() {
        assert_eq!(colour_of(&live()), GREEN);
        assert_eq!(colour_of(&Summary::default()), GREY);
        assert_eq!(colour_of(&paused()), AMBER);
    }

    #[test]
    fn lists_the_menu_lines_in_order() {
        assert_eq!(
            lines(&live(), UtcOffset::UTC),
            vec![
                "Live, read at 15:42",
                "Needs you (3)",
                "acme/api#12 Cache the plan lookups: Approved with CI passed: ready to merge",
                "Reviewing: 10, 2 need you",
                "Your pull requests: 2",
                "Mentions: 1, 1 need you",
                "2 agents working, 1 talking",
            ]
        );
    }

    #[test]
    fn says_when_it_paused_or_went_stale_and_when_routing_is_off() {
        let offset = UtcOffset::from_hms(-5, 0, 0).expect("offset");
        assert_eq!(status_line(&paused(), offset), "Paused until 15:12: GitHub's rate limit for this account is spent");
        assert_eq!(routing_line(&paused()).as_deref(), Some("Routing off: No areas configured, so review requests stay with you"));
        let stale = |last_good: Option<&str>| Summary {
            health: Health { state: "stale".to_string(), reason: Some("github did not answer".to_string()), last_good: last_good.map(str::to_string), until: None },
            ..Summary::default()
        };
        assert_eq!(status_line(&stale(Some("2026-11-05T19:45:00Z")), UtcOffset::UTC), "Stale, last read at 19:45: github did not answer");
        assert_eq!(status_line(&stale(None), UtcOffset::UTC), "Nothing read yet: github did not answer");
        assert_eq!(status_line(&Summary::default(), UtcOffset::UTC), "Live, not read yet");
        assert_eq!(routing_line(&Summary { routing: Routing { on: true, reason: Some("No area covers acme/web".to_string()) }, ..Summary::default() }).as_deref(), Some("Routing: No area covers acme/web"));
        assert_eq!(routing_line(&live()), None);
        assert_eq!(clock("not a time", UtcOffset::UTC), "not a time");
    }

    #[test]
    fn keeps_menu_lines_short() {
        let long = Need { key: "github:acme/api#1".to_string(), title: "x".repeat(100), url: String::new(), why: "why".to_string() };
        assert_eq!(need_line(&long).chars().count(), LONGEST_LINE);
        assert!(need_line(&long).ends_with('…'));
        assert_eq!(agents_line(Agents { working: 1, talking: 0 }), "1 agent working, 0 talking");
    }
}
