use std::env;
use actix_web::{App, HttpServer};
use actix_files::Files;
use crate::routes::router;
// Import this.env middleware for actix
use this_env::actixMiddleware;
use this_env::middleware::actix::ActixMwConfig;
fn cors_permissive() -> actix_cors::Cors {
    actix_cors::Cors::default()
        .allow_any_origin()
        .allow_any_method()
        .allow_any_header()
        .supports_credentials()
}

pub async fn run_daemon() -> std::io::Result<()> {
let port = env::var("PORT").unwrap_or_else(|_| "7778".to_string());
let instance = env::var("INSTANCE_NAME").unwrap_or_else(|_| "default".to_string());
// Clones para mover dentro del closure
let port_clone = port.clone();
let instance_clone = instance.clone();
println!("⊙ Starting monad.ai ({}) at http://localhost:{}...", instance, port);
HttpServer::new(move || {
    App::new()
        .wrap(cors_permissive())
        .wrap(actixMiddleware::new(ActixMwConfig {
            port: port_clone.clone(),
            instance: instance_clone.clone(),
            ..Default::default()
        }))
        .service(Files::new("/", "./static").index_file("html/index.html"))
        .configure(router::config)
})
.bind(format!("0.0.0.0:{}", port))? // Accepts connections from any host, including local.monad
.run()
.await
}