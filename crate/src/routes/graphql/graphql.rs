//src/routes/graphql/graphql.rs
use std::sync::Arc;
use async_graphql::{Schema, EmptyMutation, EmptySubscription};
use async_graphql_actix_web::{GraphQLRequest, GraphQLResponse};
use crate::routes::graphql::QueryRoot;

pub fn create_schema() -> Arc<Schema<QueryRoot, EmptyMutation, EmptySubscription>> {
    Arc::new(Schema::build(QueryRoot, EmptyMutation, EmptySubscription).finish())
}

pub async fn graphql_handler(
    schema: Arc<Schema<QueryRoot, EmptyMutation, EmptySubscription>>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    GraphQLResponse::from(schema.execute(req.into_inner()).await)
}