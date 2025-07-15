// src/router.rs
use actix_web::web::{self, ServiceConfig};
use actix_web::guard;
use crate::routes::{rest, graphql};
// Main server setup to attach all routes at once.
pub fn config(cfg: &mut ServiceConfig) {
    let schema = graphql::create_schema(); // Create a shared GraphQL schema instance
    // --- GraphQL Routes --- 
    cfg.service(
        web::resource("/graphql") // Route to handle GraphQL POST requests
            .guard(guard::Post())
            .to({
                let schema = schema.clone();
                move |req| graphql::graphql_handler(schema.clone(), req)
            }),
    );

    cfg.service(
        web::resource("/playground") // Route to serve the GraphQL Playground UI (a browser IDE for GraphQL)
            .route(web::get().to(graphql::playground_handler))
    );

    // --- REST Routes ---
    // Service to expose a basic REST status check
    
    cfg.service(rest::status); //. GET /status
    cfg.service(rest::request_history_logs); //. GET /request_history_logs
}