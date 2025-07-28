//src/routes/graphql/graphql.rs
use std::sync::Arc;
use actix_web::web;
use async_graphql::{Schema, EmptySubscription};
use async_graphql_actix_web::{GraphQLRequest, GraphQLResponse};
use crate::routes::graphql::{QueryRoot, MutationRoot};
use crate::state::AppState; // importa AppState

pub fn create_schema(app_state: Arc<AppState>) -> Arc<Schema<QueryRoot, MutationRoot, EmptySubscription>> {
    Arc::new(
        Schema::build(QueryRoot, MutationRoot, EmptySubscription)
            // Inyecta AppState en el contexto GraphQL para queries/mutaciones
            .data(app_state)
            .finish()
    )
}

pub async fn graphql_handler(
    schema: web::Data<Arc<Schema<QueryRoot, MutationRoot, EmptySubscription>>>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}