//monad.ai/crate/src/routes/graphql/mutation_root.rs
use std::sync::Arc;
use async_graphql::{Context, Object};
use crate::state::AppState;
use this_me::Me;

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    async fn load_me(&self, ctx: &Context<'_>, alias: String, hash: String) -> bool {
        match Me::load(&alias, &hash) {
            Ok(me_instance) => {
                if let Ok(state) = ctx.data::<Arc<AppState>>() {
                    if let Ok(mut mes) = state.mes.lock() {
                        mes.insert(alias, me_instance);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    }
    async fn be(&self, ctx: &Context<'_>, alias: String, key: String, value: String) -> bool {
        if let Ok(state) = ctx.data::<Arc<AppState>>() {
            if let Ok(mut mes) = state.mes.lock() {
                if let Some(me) = mes.get_mut(&alias) {
                    return me.be(&key, &value).is_ok();
                }
            }
        }
        false
    }

    async fn have(&self, ctx: &Context<'_>, alias: String, key: String, value: String) -> bool {
        if let Ok(state) = ctx.data::<Arc<AppState>>() {
            if let Ok(mut mes) = state.mes.lock() {
                if let Some(me) = mes.get_mut(&alias) {
                    return me.have(&key, &value).is_ok();
                }
            }
        }
        false
    }

    async fn do_(&self, ctx: &Context<'_>, alias: String, key: String, value: String) -> bool {
        if let Ok(state) = ctx.data::<Arc<AppState>>() {
            if let Ok(mut mes) = state.mes.lock() {
                if let Some(me) = mes.get_mut(&alias) {
                    return me.do_(&key, &value).is_ok();
                }
            }
        }
        false
    }

    async fn at(&self, ctx: &Context<'_>, alias: String, key: String, value: String) -> bool {
        if let Ok(state) = ctx.data::<Arc<AppState>>() {
            if let Ok(mut mes) = state.mes.lock() {
                if let Some(me) = mes.get_mut(&alias) {
                    return me.at(&key, &value).is_ok();
                }
            }
        }
        false
    }

    async fn relate(&self, ctx: &Context<'_>, alias: String, key: String, value: String) -> bool {
        if let Ok(state) = ctx.data::<Arc<AppState>>() {
            if let Ok(mut mes) = state.mes.lock() {
                if let Some(me) = mes.get_mut(&alias) {
                    return me.relate(&key, &value).is_ok();
                }
            }
        }
        false
    }

    async fn react(&self, ctx: &Context<'_>, alias: String, key: String, value: String) -> bool {
        if let Ok(state) = ctx.data::<Arc<AppState>>() {
            if let Ok(mut mes) = state.mes.lock() {
                if let Some(me) = mes.get_mut(&alias) {
                    return me.react(&key, &value).is_ok();
                }
            }
        }
        false
    }

    async fn communication(&self, ctx: &Context<'_>, alias: String, key: String, value: String) -> bool {
        if let Ok(state) = ctx.data::<Arc<AppState>>() {
            if let Ok(mut mes) = state.mes.lock() {
                if let Some(me) = mes.get_mut(&alias) {
                    return me.communication(&key, &value).is_ok();
                }
            }
        }
        false
    }
}