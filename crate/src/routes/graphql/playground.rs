//src/routes/graphql/playground.rs
use actix_web::HttpResponse;
use async_graphql::http::GraphiQLSource;

pub async fn playground_handler() -> HttpResponse {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(GraphiQLSource::build().endpoint("/graphql").finish())
}
