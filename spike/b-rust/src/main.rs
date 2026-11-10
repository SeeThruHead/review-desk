use std::{convert::Infallible, env, net::SocketAddr, time::Duration};

use axum::{
    Router,
    extract::State,
    http::header,
    response::{Html, IntoResponse, Sse, sse::Event},
    routing::get,
};
use futures_util::{Stream, StreamExt};
use serde::Deserialize;
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tokio::sync::watch;
use tokio_stream::wrappers::WatchStream;
use tray_icon::{
    Icon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem},
};

const QUERY: &str = include_str!("../../query.graphql");
const HTMX: &str = include_str!("../assets/htmx.min.js");
const SSE: &str = include_str!("../assets/sse.js");
const CSS: &str = include_str!("../assets/sth-ui.css");

#[derive(Deserialize)]
struct Response {
    data: Data,
}

#[derive(Deserialize)]
struct Data {
    search: Nodes<SearchNode>,
}

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SearchNode {
    Pull(Box<Pull>),
    Other(serde::de::IgnoredAny),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct Pull {
    id: String,
    number: u64,
    title: String,
    url: String,
    head_ref_name: String,
    is_draft: bool,
    updated_at: String,
    repository: Repository,
    author: Option<Login>,
    reviews: Nodes<Review>,
    comments: Nodes<Comment>,
    review_threads: Nodes<Thread>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name_with_owner: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Review {
    id: String,
    state: String,
    body: String,
    url: String,
    author: Option<Login>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct Comment {
    id: String,
    created_at: String,
    body: String,
    url: String,
    author: Option<Login>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct Thread {
    path: String,
    is_resolved: bool,
    comments: Nodes<Comment>,
}

#[derive(Clone, Default)]
struct PullSummary {
    repo: String,
    number: u64,
    title: String,
    threads: usize,
}

#[derive(Clone, Default)]
struct Snapshot {
    polls: u64,
    pulls: Vec<PullSummary>,
}

fn summary(pull: &Pull) -> PullSummary {
    PullSummary {
        repo: pull.repository.name_with_owner.clone(),
        number: pull.number,
        title: pull.title.clone(),
        threads: pull.comments.nodes.len() + pull.review_threads.nodes.len(),
    }
}

fn pulls_of(response: Response) -> Vec<PullSummary> {
    response
        .data
        .search
        .nodes
        .iter()
        .filter_map(|node| match node {
            SearchNode::Pull(pull) => Some(summary(pull)),
            SearchNode::Other(_) => None,
        })
        .collect()
}

async fn fetch(client: &reqwest::Client, endpoint: &str, token: &str) -> Result<Vec<PullSummary>, reqwest::Error> {
    client
        .post(endpoint)
        .bearer_auth(token)
        .header("user-agent", "review-desk-spike")
        .json(&serde_json::json!({ "query": QUERY }))
        .timeout(Duration::from_secs(30))
        .send()
        .await?
        .json::<Response>()
        .await
        .map(pulls_of)
}

async fn poll_forever(state: watch::Sender<Snapshot>, endpoint: String, token: String, every: Duration) {
    let client = reqwest::Client::new();
    let mut ticks = tokio::time::interval(every);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        match fetch(&client, &endpoint, &token).await {
            Ok(pulls) => state.send_modify(|snapshot| {
                snapshot.polls += 1;
                snapshot.pulls = pulls;
            }),
            Err(error) => eprintln!("poll failed: {error}"),
        }
    }
}

fn escape(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '&' => "&amp;".to_string(),
            '"' => "&quot;".to_string(),
            other => other.to_string(),
        })
        .collect()
}

const CARD: &str = "x9f619 x15hzdyd x1n2onr6 xb3r6kr x78zum5 xdt5ytf x1k85t8e xrs19h0 x1jdg80w xfw6i0p x1i10hfl x1hl2dhg xmkeg23 x1y0btm7 x9b21tv";
const GROUP: &str = "x9f619 xg1cdky x78zum5 x1q0g3np x18xx5bt xa74sl x1b2jk9k x18ofcd";
const TEXT: &str = "x9f619 x1i10hfl x1hl2dhg xim6ygv xo5yrzh xxrf7rh x1ghz6dp x1717udv";
const BADGE_LIGHT: &str = "x9f619 x1i10hfl xcrqdmw x1hq9b1d xrwpqlp x1lys3pr x1hl2dhg xt970qd x5zq534 xwz0xwf x6s0dn4 xl56j7k xeq5yr9 xtvhhri xlnsoc6 xf4yft xt0e3qv xlyipyv xb3r6kr xmkeg23 x1y0btm7 x9r1u3d x1gavhfw x1lflsxr x1y6fwsi";
const BADGE_FILLED: &str = "x9f619 x1ib2uwa xl31d9f x1i10hfl xcrqdmw x1hq9b1d xrwpqlp x1lys3pr x1hl2dhg xt970qd x5zq534 xwz0xwf x6s0dn4 xl56j7k xeq5yr9 xtvhhri xlnsoc6 xf4yft xt0e3qv xlyipyv xb3r6kr xmkeg23 x1y0btm7 x9r1u3d xlwu9qf x1ugd0q5 x1y6fwsi";
const BADGE_LABEL: &str = "x9f619 xuxw1ft xb3r6kr xlyipyv x2b8uid xmper1u";
const THEME: &str = "x9f619 xu4bbqh xim6ygv xo5yrzh xrs19h0 x11cbgwx xvmahel xlh3980 x108lcm5";
const STACK: &str = "x9f619 x1gbs8n1 x78zum5 xdt5ytf xc27b8u x11f3hxu x142yj7l";
const TITLE: &str = "x9f619 x1ghz6dp x4z584g x1lxefqd x2ocpw3 x1fymfe0 xy44j51";

fn card(pull: &PullSummary) -> String {
    format!(
        r#"<div data-with-border class="{CARD}"><div class="{GROUP}"><p class="{TEXT}" style="font-weight:600">{title}</p><div data-variant="light" class="{BADGE_LIGHT}"><span class="{BADGE_LABEL}">{repo}#{number}</span></div><div data-variant="filled" class="{BADGE_FILLED}"><span class="{BADGE_LABEL}">{threads} threads</span></div></div></div>"#,
        title = escape(&pull.title),
        repo = escape(&pull.repo),
        number = pull.number,
        threads = pull.threads,
    )
}

fn list(snapshot: &Snapshot) -> String {
    format!(
        r#"<p class="{TEXT}" style="color:var(--x1x3pyya)">{count} pull requests, {polls} polls</p>{cards}"#,
        count = snapshot.pulls.len(),
        polls = snapshot.polls,
        cards = snapshot.pulls.iter().map(card).collect::<String>(),
    )
}

async fn page(State(state): State<watch::Receiver<Snapshot>>) -> Html<String> {
    Html(format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>Review Desk spike B</title><link rel="stylesheet" href="/app.css"><script src="/htmx.js"></script><script src="/sse.js"></script></head><body><div class="{THEME}" style="color-scheme:light dark"><div class="{STACK}" style="padding:var(--xe4thxz);max-width:56.25rem"><h2 class="{TITLE}">Ready for you</h2><div hx-ext="sse" sse-connect="/events" sse-swap="snapshot">{list}</div></div></div></body></html>"#,
        list = list(&state.borrow())
    ))
}

async fn events(State(state): State<watch::Receiver<Snapshot>>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = WatchStream::new(state).map(|snapshot| Ok(Event::default().event("snapshot").data(list(&snapshot))));
    Sse::new(stream)
}

fn asset(content_type: &'static str, body: &'static str) -> impl IntoResponse + Clone {
    ([(header::CONTENT_TYPE, content_type)], body)
}

async fn serve(state: watch::Receiver<Snapshot>, port: u16) {
    let router = Router::new()
        .route("/", get(page))
        .route("/events", get(events))
        .route("/app.css", get(|| async { asset("text/css", CSS) }))
        .route("/htmx.js", get(|| async { asset("text/javascript", HTMX) }))
        .route("/sse.js", get(|| async { asset("text/javascript", SSE) }))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
        .await
        .expect("port is free");
    axum::serve(listener, router).await.expect("server runs");
}

enum TrayEvent {
    Snapshot(usize),
    Menu(MenuEvent),
}

fn run_server(proxy: EventLoopProxy<TrayEvent>) {
    let token = env::var("GITHUB_TOKEN").expect("GITHUB_TOKEN is set");
    let endpoint = env::var("GITHUB_GRAPHQL_URL").unwrap_or_else(|_| "https://api.github.com/graphql".to_string());
    let every = Duration::from_millis(env::var("POLL_MS").ok().and_then(|ms| ms.parse().ok()).unwrap_or(60_000));
    let port = env::var("PORT").ok().and_then(|port| port.parse().ok()).unwrap_or(4720);
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("runtime builds");
    let (sender, receiver) = watch::channel(Snapshot::default());
    let tray_updates = WatchStream::new(receiver.clone()).for_each(move |snapshot| {
        let _ = proxy.send_event(TrayEvent::Snapshot(snapshot.pulls.len()));
        async {}
    });
    runtime.block_on(async move {
        tokio::join!(poll_forever(sender, endpoint, token, every), serve(receiver, port), tray_updates);
    });
}

fn icon() -> Icon {
    let pixels = [0x2a_u8, 0x8a, 0x5c, 0xff].repeat(16 * 16);
    Icon::from_rgba(pixels, 16, 16).expect("icon is 16 by 16")
}

fn main() {
    let event_loop = EventLoopBuilder::<TrayEvent>::with_user_event().build();
    let server_proxy = event_loop.create_proxy();
    let menu_proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = menu_proxy.send_event(TrayEvent::Menu(event));
    }));
    std::thread::spawn(move || run_server(server_proxy));

    let open = MenuItem::new("Open Review Desk", true, None);
    let quit = MenuItem::new("Quit", true, None);
    let menu = Menu::new();
    menu.append_items(&[&open, &quit]).expect("menu builds");
    let open_id = open.id().clone();
    let quit_id = quit.id().clone();
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_icon(icon())
        .with_title("RD")
        .build()
        .expect("tray builds");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            tao::event::Event::UserEvent(TrayEvent::Snapshot(count)) => tray.set_title(Some(format!("RD {count}"))),
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == quit_id => *control_flow = ControlFlow::Exit,
            tao::event::Event::UserEvent(TrayEvent::Menu(menu_event)) if menu_event.id == open_id => {
                let _ = std::process::Command::new("open").arg("http://127.0.0.1:4720/").spawn();
            }
            _ => {}
        }
    });
}
