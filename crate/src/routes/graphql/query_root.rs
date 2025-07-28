// --- Module-level comment ---
// This file defines the GraphQL QueryRoot for the Monad.AI daemon.
// It provides queries to list all available `Me` instances, fetch details of a specific `Me`,
// and get the current daemon status.
use async_graphql::{Object, SimpleObject, Context};
use this_me::list_us as list_us_me;
use crate::state::AppState;
// Root of all GraphQL queries. Each method inside `impl QueryRoot`
// represents a query that clients can execute.
pub struct QueryRoot;
// Represents a simplified summary of a `Me` instance,
// including only its alias and the filesystem path.
#[derive(SimpleObject)]
pub struct GqlMeSummary {
    pub alias: String,
    pub path: String,
}
// Implementation of all queries exposed in the GraphQL schema.
#[Object]
impl QueryRoot {
    // Query: Returns a list of all available `Me` instances registered in the daemon.
    // It converts the internal `Me` structures into `GqlMeSummary` objects for GraphQL.
    async fn list_us(&self) -> Vec<GqlMeSummary> {
        list_us_me()
            .unwrap_or_default()
            .into_iter()
            .map(|m| GqlMeSummary {
                alias: m.alias,
                path: m.path.to_string_lossy().to_string(),
            })
            .collect()
    }
    // Query: Fetches detailed information about a specific `Me` instance by alias.
    // It looks up the in-memory `mes` map from the global AppState and returns its public data.
    async fn me(&self, ctx: &Context<'_>, alias: String) -> Option<GqlMe> {
        let state = ctx.data::<AppState>().unwrap();
        let mes = state.mes.lock().unwrap();
        mes.get(&alias).map(|me| GqlMe {
            alias: me.alias.clone(),
            public_key: me.public_key.clone(),
        })
    }
    // Query: Returns the current status of the daemon.
    // Currently returns mock data; should later be replaced with real daemon state.
    async fn status(&self) -> GqlStatus {
        // Aquí luego puedes reemplazar con la lógica real de tu daemon.
        // Esto es solo un mock inicial para verificar que responde.
        GqlStatus {
            active: true,
            port: 7777,
            username: "suiGn".into(),
            version: "0.1.0".into(),
        }
    }
}
// Represents the detailed public information of a `Me` instance,
// currently exposing only alias and public key.
#[derive(SimpleObject)]
pub struct GqlMe {
    pub alias: String,
    pub public_key: String,
}
// Represents the daemon status, including whether it is active, its port, the username,
// and the daemon version. This is useful for health-checking from external clients.
#[derive(SimpleObject)]
pub struct GqlStatus {
    pub active: bool,
    pub port: i32,
    pub username: String,
    pub version: String,
}