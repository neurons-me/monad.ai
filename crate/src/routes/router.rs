// src/routes/router.rs
use actix_web::web::{self, ServiceConfig};
use actix_web::guard;
use crate::routes::{rest, graphql};
use crate::routes::ws::me_ws::me_ws_handler; // ✅ Import the handler
use crate::state::AppState;
use std::sync::Arc;

pub fn config(cfg: &mut ServiceConfig) {
    // Crea el AppState e inyecta al schema
    let app_state = Arc::new(AppState::default());
    let schema = web::Data::new(graphql::create_schema(app_state));

    // --- GraphQL Routes --- 
    cfg.service(
        web::resource("/graphql")
            .guard(guard::Post())
            .to({
                let schema = schema.clone();
                move |req| graphql::graphql_handler(schema.clone(), req)
            }),
    );

    cfg.service(
        web::resource("/playground")
            .route(web::get().to(graphql::playground_handler))
    );

    // --- REST Routes ---
    cfg.service(rest::status);
    cfg.service(rest::request_history_logs);

    // --- this.me Routes ---
    cfg.service(rest::list_us);

    // --- WebSocket Routes ---
    cfg.service(
        web::resource("/ws/me").route(web::get().to(me_ws_handler)) // ✅ Properly register WebSocket
    );
}